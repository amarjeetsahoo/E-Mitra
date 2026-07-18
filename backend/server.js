const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { z } = require('zod');

const { esClient, logQueryAudit } = require('./db');
const { generateText, getEmbedding } = require('./gemini');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// Cache fixtures at startup — avoid repeated disk reads on fallback paths
const FIXTURES = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/data_fixtures.json'), 'utf8'));

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'emitra-super-secret-key-2026';

// Users Database file for simple persistence
const USERS_FILE = path.resolve(__dirname, 'users.json');

// Ensure users database exists
if (!fs.existsSync(USERS_FILE)) {
  const initialUsers = [
    {
      email: 'admin@emitra.in',
      passwordHash: bcrypt.hashSync('mitra123', 10)
    }
  ];
  fs.writeFileSync(USERS_FILE, JSON.stringify(initialUsers, null, 2));
}

// ----------------------------------------------------
// Security Middlewares
// ----------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "media-src": ["'self'", "blob:"],
    }
  }
}));
// ponytail: CORS origin:'*' is fine for a buildathon demo. For production, restrict to your domain.
app.use(cors({ origin: '*' }));
app.use(compression());  // gzip all JSON responses (~60-70% smaller payloads)
app.use(express.json({ limit: '10kb' }));  // cap body size — no reason for large payloads

// API Rate Limiter (30 requests per 15 minutes per IP)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // relaxed for demo purposes
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

// ----------------------------------------------------
// Helper Functions
// ----------------------------------------------------
function getUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (err) {
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// JWT Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token.' });
    }
    req.user = user;
    next();
  });
}

// ----------------------------------------------------
// Auth Routes
// ----------------------------------------------------
const authSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters')
});

app.post('/api/auth/register', (req, res) => {
  try {
    const { email, password } = authSchema.parse(req.body);
    const users = getUsers();

    if (users.find(u => u.email === email)) {
      return res.status(400).json({ error: 'User already exists.' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    users.push({ email, passwordHash });
    saveUsers(users);

    res.status(201).json({ message: 'User registered successfully.' });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Registration failed.' });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = authSchema.parse(req.body);
    const users = getUsers();

    const user = users.find(u => u.email === email);
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '2h' });
    res.json({ token, email });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Login failed.' });
  }
});

// ----------------------------------------------------
// Chat & RAG Route (Multilingual Voice + Text)
// ----------------------------------------------------
const chatSchema = z.object({
  query: z.string()
    .min(2, 'Query must be at least 2 characters')
    .max(500, 'Query must not exceed 500 characters')
    .transform(s => s.trim())
    .refine(s => !/[\x00-\x08\x0e-\x1f]/.test(s), 'Query contains invalid control characters')
});

app.post('/api/chat', authenticateToken, async (req, res) => {
  const userIp = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';
  const email = req.user.email;

  try {
    const { query } = chatSchema.parse(req.body);

    // Sanitize: escape quotes to prevent prompt-template breakout
    const safeQuery = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    // 1. Use Gemini to detect language and translate query to English for Elasticsearch vector matching
    const languageDetectorPrompt = `You are a translation assistant. Identify the language of this input query and translate it into a simple, keyword-rich English search query for database lookup.
Input Query: "${safeQuery}"
Respond ONLY with a valid JSON object matching this exact schema:
{
  "detectedLanguage": "Name of the detected language (e.g. Hindi, Bengali, English, Tamil)",
  "englishQuery": "The English translation of the query"
}
Do not write any other text or markdown wrappers.`;

    const languageDetectionSchema = {
      type: "OBJECT",
      properties: {
        detectedLanguage: { type: "STRING" },
        englishQuery: { type: "STRING" }
      },
      required: ["detectedLanguage", "englishQuery"]
    };

    let langData = { detectedLanguage: 'unknown', englishQuery: query };
    try {
      const translationResponse = await generateText(languageDetectorPrompt, languageDetectionSchema);
      langData = JSON.parse(translationResponse.trim());
    } catch (e) {
      console.warn('[WARNING] Failed to parse language detection JSON. Proceeding with raw query.', e.message);
    }

    console.log(`[QUERY] Lang: ${langData.detectedLanguage} | English: "${langData.englishQuery}"`);

    // 2. Generate embedding for the English query
    const queryVector = await getEmbedding(langData.englishQuery);

    // 3. Search Elasticsearch (hybrid vector & text match)
    let contextDocs = [];
    if (esClient) {
      try {
        const esResponse = await esClient.search({
          index: 'emitra-knowledge',
          _source_excludes: ['text_vector'],  // exclude 3072-dim vector (~24KB/doc) from response
          body: {
            size: 3,
            query: {
              bool: {
                should: [
                  // Vector Similarity search
                  {
                    knn: {
                      field: "text_vector",
                      query_vector: queryVector,
                      k: 3,
                      num_candidates: 30,  // wider candidate pool → better recall
                      boost: 2.0
                    }
                  },
                  // Full-text Standard Keyword search
                  {
                    multi_match: {
                      query: langData.englishQuery,
                      fields: ["title^2", "description_english", "description_hindi", "act^1.5"],
                      boost: 1.0
                    }
                  }
                ]
              }
            }
          }
        });
        
        contextDocs = esResponse.hits.hits.map(hit => hit._source);
      } catch (esError) {
        console.error('[Elasticsearch Search Error]', esError.message);
        // Fallback to local search if index doesn't exist yet
      }
    }

    // 4. If no results found or ES client is missing, provide default static context fallback
    if (contextDocs.length === 0) {
      console.log('No context found. Using cached fixtures fallback.');
      contextDocs = [...FIXTURES.statutes, ...FIXTURES.welfare_schemes, ...FIXTURES.minimum_wages].slice(0, 3);
    }

    // 5. Construct RAG prompt for Gemini
    const contextText = contextDocs.map((doc, idx) => {
      return `Document [${idx + 1}]:
Type: ${doc.doc_type || 'info'}
Title/Act: ${doc.title || doc.act || ''} ${doc.section || ''}
Hindi description: ${doc.description_hindi || ''} ${doc.welfare_benefits_hindi || ''}
English description: ${doc.description_english || ''} ${doc.welfare_benefits_english || ''}
Wages: Daily - ${doc.wage_daily || 'N/A'}, Monthly - ${doc.wage_monthly || 'N/A'}`;
    }).join('\n\n');

    const ragPrompt = `You are "E-Mitra", an empathetic, highly knowledgeable assistant for migrant workers and labourers in Delhi.
Your job is to answer the User Query using the provided Legal/Scheme Context.

User Query (translated context: "${langData.englishQuery}"): "${safeQuery}"

Context:
${contextText}

Guidelines:
1. Explain their rights in simple, clear, conversational terms.
2. In the Hindi answer, use common words (Hindustani) that a worker can understand easily. Do not use highly complex Sanskritized Hindi.
3. You MUST cite the specific Act/Statute/Section (e.g., Minimum Wages Act 1948 Section 12 or Payment of Wages Act 1936 Section 5) in both English and Hindi.
4. Your response MUST be in valid JSON matching this schema:
{
  "hindi": "Your plain Hindi answer with statute citation here.",
  "english": "Your plain English answer with statute citation here."
}
Return ONLY the raw JSON block. No markdown, no \`\`\`json wrappers.`;

    const ragAnswerSchema = {
      type: "OBJECT",
      properties: {
        hindi: { type: "STRING" },
        english: { type: "STRING" }
      },
      required: ["hindi", "english"]
    };

    const finalAnswerText = await generateText(ragPrompt, ragAnswerSchema);
    let finalAnswer;
    try {
      finalAnswer = JSON.parse(finalAnswerText.trim());
    } catch (parseError) {
      console.warn('[WARNING] Failed to parse final answer JSON. Attempting fallback cleaner.', parseError.message);
      // clean backticks if LLM wrapped it
      let cleanText = finalAnswerText.replace(/```json/g, '').replace(/```/g, '').trim();
      finalAnswer = JSON.parse(cleanText);
    }

    // 6. Fire-and-forget audit log — never block user response for logging
    logQueryAudit({
      userId: email,
      userIp,
      query,
      translatedQuery: langData.englishQuery,
      detectedLanguage: langData.detectedLanguage,
      responseStatus: 'success'
    }).catch(err => console.error('Audit log failed:', err.message));

    res.json(finalAnswer);

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Internal server error during chat processing.' });
  }
});

// ----------------------------------------------------
// Nearest District Labour Office Routing Route
// ----------------------------------------------------
const routeOfficeSchema = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  district: z.string().max(100).optional()
}).refine(d => d.lat !== undefined || d.district !== undefined, 'Either lat/lon or district is required');

app.post('/api/route-office', authenticateToken, async (req, res) => {
  try {
    const { lat, lon, district } = routeOfficeSchema.parse(req.body);
    let offices = [];

    const defaultOffices = FIXTURES.district_offices;

    if (esClient) {
      try {
        if (lat && lon) {
          // Geo-distance sorting query in Elasticsearch
          const esResponse = await esClient.search({
            index: 'emitra-knowledge',
            body: {
              query: {
                term: { doc_type: "district_office" }
              },
              sort: [
                {
                  _geo_distance: {
                    office_location: {
                      lat: parseFloat(lat),
                      lon: parseFloat(lon)
                    },
                    order: "asc",
                    unit: "km",
                    distance_type: "plane"
                  }
                }
              ],
              size: 1
            }
          });
          
          if (esResponse.hits.hits.length > 0) {
            offices = esResponse.hits.hits.map(hit => ({
              ...hit._source,
              distance_km: hit.sort[0]
            }));
          }
        } else if (district) {
          // Search office matching district keyword
          const esResponse = await esClient.search({
            index: 'emitra-knowledge',
            body: {
              query: {
                bool: {
                  must: [
                    { term: { doc_type: "district_office" } },
                    { match: { office_district: district } }
                  ]
                }
              },
              size: 1
            }
          });
          offices = esResponse.hits.hits.map(hit => hit._source);
        }
      } catch (esError) {
        console.error('[Elasticsearch Office Query Error]', esError.message);
      }
    }

    // Fallback if no office matched or Elasticsearch query failed
    if (offices.length === 0) {
      if (district) {
        const matched = defaultOffices.find(o => 
          o.district.toLowerCase().includes(district.toLowerCase())
        );
        offices = matched ? [matched] : [defaultOffices[0]];
      } else {
        // default to first office
        offices = [defaultOffices[0]];
      }
    }

    res.json(offices[0]);
  } catch (error) {
    console.error('Office routing error:', error);
    res.status(500).json({ error: 'Failed to retrieve nearest office.' });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'active', message: 'E-Mitra backend API is running' });
});

app.listen(PORT, () => {
  console.log(`E-Mitra Server is running on port ${PORT}`);
});
