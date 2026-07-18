const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const MODELS_TO_ROTATE = [
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemma-4-26b-a4b-it'
];

/**
 * Call Gemini Generative AI REST API with automatic model rotation
 */
async function generateText(prompt, schema = null) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('your_gemini')) {
    console.warn('[WARNING] GEMINI_API_KEY is not configured. Returning Mock response.');
    return JSON.stringify({
      hindi: "नमस्ते! यह एक मॉक उत्तर है क्योंकि आपकी जेमिनी एपीआई की (GEMINI_API_KEY) सेट नहीं है। कृपया श्रम कानूनों की विस्तृत जानकारी के लिए पर्यावरण (.env) फाइल को कॉन्फ़िगर करें।",
      english: "Hello! This is a mock response because your GEMINI_API_KEY is not configured. Please configure the .env file to enable live RAG answers."
    });
  }

  let lastError = null;

  for (const model of MODELS_TO_ROTATE) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    
    const isGemma = model.includes('gemma');
    const payload = {
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: isGemma ? {} : {
        responseMimeType: "application/json",
        ...(schema ? { responseSchema: schema } : {})
      }
    };

    console.log(`[MODEL TRY] Attempting model: ${model}`);

    try {
      // 15s timeout to prevent indefinite hangs on Gemini API
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text();
        const isQuotaOrUnavailable = res.status === 429 || 
                                     res.status === 403 || 
                                     res.status === 404 || 
                                     errText.includes('quota') || 
                                     errText.includes('Quota') || 
                                     errText.includes('rate limit') || 
                                     errText.includes('limit exceeded') ||
                                     errText.includes('not available');

        if (isQuotaOrUnavailable) {
          console.warn(`[MODEL ROTATION] Quota or availability error on ${model} (${res.status}). Rotating to next model...`);
          lastError = new Error(`Model ${model} failed (${res.status}): ${errText}`);
          continue; // Move to next model
        } else {
          throw new Error(`Gemini API Error (${res.status}): ${errText}`);
        }
      }

      const data = await res.json();
      if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) {
        console.log(`[MODEL SUCCESS] Successfully generated response using model: ${model}`);
        return data.candidates[0].content.parts[0].text;
      } else {
        throw new Error(`Unexpected response format from model ${model}`);
      }
    } catch (error) {
      console.error(`[MODEL ERROR] Failed with model ${model}:`, error.message);
      lastError = error;
      continue; // Rotate to next model
    }
  }

  throw new Error(`All models in the rotation list failed. Last error: ${lastError ? lastError.message : 'Unknown'}`);
}

/**
 * Call Gemini Embedding REST API to generate 3072-dim vector
 */
async function getEmbedding(text) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY.includes('your_gemini')) {
    // Return dummy 3072-dim vector
    return new Array(3072).fill(0.0);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`;
  
  const payload = {
    model: "models/gemini-embedding-001",
    content: {
      parts: [{ text }]
    }
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini Embed Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return data.embedding.values;
  } catch (error) {
    console.error('Gemini getEmbedding error:', error.message);
    // fallback
    return new Array(3072).fill(0.0);
  }
}

module.exports = {
  generateText,
  getEmbedding
};
