import os
import json
import sys
import urllib.request
import urllib.parse
from elasticsearch import Elasticsearch
from elasticsearch.helpers import bulk
from dotenv import load_dotenv

# Reconfigure stdout to support unicode printing in Windows terminals
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Load env variables from .env if present
load_dotenv()

ELASTIC_CLOUD_ID = os.getenv("ELASTIC_CLOUD_ID")
ELASTIC_API_KEY = os.getenv("ELASTIC_API_KEY")
ELASTIC_URL = os.getenv("ELASTIC_URL", "http://localhost:9200") # local fallback
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not GEMINI_API_KEY:
    print("[WARNING] GEMINI_API_KEY not found in env variables. Vector embeddings will fail.")

# Initialize Elasticsearch Client
is_cloud_placeholder = not ELASTIC_CLOUD_ID or "your_elastic" in ELASTIC_CLOUD_ID
is_api_key_placeholder = not ELASTIC_API_KEY or "your_api" in ELASTIC_API_KEY

if ELASTIC_CLOUD_ID and not is_cloud_placeholder and ELASTIC_API_KEY and not is_api_key_placeholder:
    es = Elasticsearch(cloud_id=ELASTIC_CLOUD_ID, api_key=ELASTIC_API_KEY)
    print("Connected to Elasticsearch Cloud.")
elif ELASTIC_API_KEY and not is_api_key_placeholder:
    es = Elasticsearch(ELASTIC_URL, api_key=ELASTIC_API_KEY)
    print(f"Connected to Elasticsearch via API key at {ELASTIC_URL}.")
else:
    es = Elasticsearch(ELASTIC_URL)
    print(f"Connected to local/unauthenticated Elasticsearch at {ELASTIC_URL}.")

INDEX_NAME = "emitra-knowledge"

def get_embedding(text):
    """
    Generates a 3072-dimension vector embedding using Google's gemini-embedding-001.
    Uses standard urllib to avoid extra dependencies.
    """
    if not GEMINI_API_KEY:
        # Fallback to zero vector for testing pipeline structure without API keys
        return [0.0] * 3072

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key={GEMINI_API_KEY}"
    data = {
        "model": "models/gemini-embedding-001",
        "content": {
            "parts": [{"text": text}]
        }
    }
    req_body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=req_body,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            return res_data["embedding"]["values"]
    except Exception as e:
        print(f"[ERROR] Embedding failed for text: {text[:30]}... Error: {e}")
        # fallback
        return [0.0] * 3072

def create_index_if_not_exists():
    """
    Creates the emitra-knowledge index with HNSW vector search mapping if not exists.
    """
    # Delete for fresh setup if required (or comment out to keep existing indices)
    if es.indices.exists(index=INDEX_NAME):
        es.indices.delete(index=INDEX_NAME)
        print(f"Deleted existing index: {INDEX_NAME}")

    mappings = {
        "mappings": {
            "properties": {
                "doc_type": {"type": "keyword"},
                "act": {"type": "text", "analyzer": "standard"},
                "section": {"type": "keyword"},
                "title": {"type": "text", "analyzer": "standard"},
                "description_hindi": {"type": "text", "analyzer": "standard"},
                "description_english": {"type": "text", "analyzer": "standard"},
                "category": {"type": "keyword"},
                "wage_monthly": {"type": "integer"},
                "wage_daily": {"type": "integer"},
                "welfare_benefits_hindi": {"type": "text", "analyzer": "standard"},
                "welfare_benefits_english": {"type": "text", "analyzer": "standard"},
                "office_district": {"type": "keyword"},
                "office_address_hindi": {"type": "text", "analyzer": "standard"},
                "office_address_english": {"type": "text", "analyzer": "standard"},
                "office_helpline": {"type": "keyword"},
                "office_location": {"type": "geo_point"},
                "office_maps_query": {"type": "keyword"},
                # 3072 dimensions for gemini-embedding-001, tuned HNSW for better recall
                "text_vector": {
                    "type": "dense_vector",
                    "dims": 3072,
                    "index": True,
                    "similarity": "cosine",
                    "index_options": {
                        "type": "hnsw",
                        "m": 16,
                        "ef_construction": 100
                    }
                }
            }
        }
    }
    
    es.indices.create(index=INDEX_NAME, body=mappings)
    print(f"Created index: {INDEX_NAME} with dense_vector maps.")

def ingest_fixtures():
    # Load fixtures
    fixtures_path = os.path.join(os.path.dirname(__file__), "..", "data", "data_fixtures.json")
    with open(fixtures_path, "r", encoding="utf-8") as f:
        fixtures = json.load(f)

    actions = []  # collect all docs for bulk ingestion

    print("Preparing minimum wage data...")
    for item in fixtures.get("minimum_wages", []):
        text_representation = f"Minimum wage scale Delhi category: {item['category']}. Monthly wage: {item['monthly_wage_inr']} INR. Daily wage: {item['daily_wage_inr']} INR. Applicable sectors: {item['applicable_sectors']}. Legal basis: {item['legal_basis']}."
        vector = get_embedding(text_representation)
        actions.append({
            "_index": INDEX_NAME,
            "_source": {
                "doc_type": "minimum_wage",
                "category": item["category"],
                "wage_monthly": item["monthly_wage_inr"],
                "wage_daily": item["daily_wage_inr"],
                "description_english": item["applicable_sectors"],
                "description_hindi": f"\u0928\u094d\u092f\u0942\u0928\u0924\u092e \u092e\u091c\u0926\u0942\u0930\u0940: \u092e\u093e\u0938\u093f\u0915 \u20b9{item['monthly_wage_inr']}, \u0926\u0948\u0928\u093f\u0915 \u20b9{item['daily_wage_inr']}",
                "act": item["legal_basis"],
                "text_vector": vector
            }
        })
        print(f"  Prepared: {item['category']}")

    print("\nPreparing labour statutes...")
    for item in fixtures.get("statutes", []):
        text_representation = f"Statute Act: {item['act']} Section: {item['section']} Title: {item['title']}. English description: {item['description_english']}. Hindi description: {item['description_hindi']}."
        vector = get_embedding(text_representation)
        actions.append({
            "_index": INDEX_NAME,
            "_source": {
                "doc_type": "statute",
                "act": item["act"],
                "section": item["section"],
                "title": item["title"],
                "description_hindi": item["description_hindi"],
                "description_english": item["description_english"],
                "welfare_benefits_hindi": item.get("penalty_hindi", "") + " " + item.get("remedy_hindi", ""),
                "welfare_benefits_english": item.get("penalty_english", "") + " " + item.get("remedy_english", ""),
                "text_vector": vector
            }
        })
        print(f"  Prepared: {item['act']} - {item['section']}")

    print("\nPreparing welfare schemes...")
    for item in fixtures.get("welfare_schemes", []):
        text_representation = f"Welfare scheme name: {item['name']}. Eligibility Hindi: {item['eligibility_hindi']}. Eligibility English: {item['eligibility_english']}. Benefits Hindi: {item['benefits_hindi']}. Benefits English: {item['benefits_english']}."
        vector = get_embedding(text_representation)
        actions.append({
            "_index": INDEX_NAME,
            "_source": {
                "doc_type": "welfare_scheme",
                "title": item["name"],
                "description_hindi": item["eligibility_hindi"],
                "description_english": item["eligibility_english"],
                "welfare_benefits_hindi": item["benefits_hindi"],
                "welfare_benefits_english": item["benefits_english"],
                "act": item.get("how_to_apply_hindi", ""),
                "text_vector": vector
            }
        })
        print(f"  Prepared: {item['name']}")

    print("\nPreparing district offices...")
    for item in fixtures.get("district_offices", []):
        text_representation = f"Delhi District Labour Commissioner office. District: {item['district']}. Office: {item['office_name']}. Address: {item['address_english']} / {item['address_hindi']}. Helpline: {item['helpline']}."
        vector = get_embedding(text_representation)
        actions.append({
            "_index": INDEX_NAME,
            "_source": {
                "doc_type": "district_office",
                "office_district": item["district"],
                "title": item["office_name"],
                "office_address_hindi": item["address_hindi"],
                "office_address_english": item["address_english"],
                "office_helpline": item["helpline"],
                "office_location": {
                    "lat": item["latitude"],
                    "lon": item["longitude"]
                },
                "office_maps_query": item["maps_query"],
                "text_vector": vector
            }
        })
        print(f"  Prepared: {item['office_name']}")

    # Bulk ingest all documents in a single batch call
    print(f"\nBulk indexing {len(actions)} documents...")
    success, errors = bulk(es, actions, raise_on_error=False)
    print(f"Bulk indexed {success} documents. Errors: {len(errors) if isinstance(errors, list) else errors}")

if __name__ == "__main__":
    create_index_if_not_exists()
    ingest_fixtures()
    print("\n[SUCCESS] Ingestion completed. Ingested all fixtures into Elasticsearch index 'emitra-knowledge'.")
