const { Client } = require('@elastic/elasticsearch');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const ELASTIC_CLOUD_ID = process.env.ELASTIC_CLOUD_ID;
const ELASTIC_API_KEY = process.env.ELASTIC_API_KEY;
const ELASTIC_URL = process.env.ELASTIC_URL || 'http://localhost:9200';

let esClient;

try {
  if (ELASTIC_CLOUD_ID && ELASTIC_API_KEY) {
    esClient = new Client({
      cloud: { id: ELASTIC_CLOUD_ID },
      auth: { apiKey: ELASTIC_API_KEY }
    });
    console.log('Elasticsearch: Connected via Cloud ID.');
  } else if (ELASTIC_API_KEY) {
    esClient = new Client({
      node: ELASTIC_URL,
      auth: { apiKey: ELASTIC_API_KEY }
    });
    console.log(`Elasticsearch: Connected via API key at ${ELASTIC_URL}.`);
  } else {
    esClient = new Client({
      node: ELASTIC_URL
    });
    console.log(`Elasticsearch: Connected to unauthenticated node at ${ELASTIC_URL}.`);
  }
} catch (error) {
  console.error('Elasticsearch Client Initialization Failed:', error);
}

/**
 * Logs user interaction data to 'emitra-audit-logs' index for Kibana monitoring.
 */
async function logQueryAudit({ userId, userIp, query, translatedQuery, detectedLanguage, responseStatus }) {
  const auditDoc = {
    timestamp: new Date().toISOString(),
    userId: userId || 'anonymous',
    userIp: userIp || 'unknown',
    query_text: query,
    translated_query: translatedQuery || null,
    detected_language: detectedLanguage || 'unknown',
    response_status: responseStatus || 'success'
  };

  try {
    // Check if client is initialized
    if (!esClient) return;
    
    // Log to index asynchronously (don't block user response)
    await esClient.index({
      index: 'emitra-audit-logs',
      document: auditDoc
    });
  } catch (error) {
    console.error('Failed to index audit log in Elasticsearch:', error.message);
  }
}

module.exports = {
  esClient,
  logQueryAudit
};
