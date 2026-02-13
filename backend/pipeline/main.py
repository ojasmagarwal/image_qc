
import os
import json
import logging
from google.cloud import bigquery
from google.events.cloud import firestore as firestore_events
from cloudevents.http import CloudEvent
import functions_framework

# Environment Variables
BQ_PROJECT = os.environ.get("BQ_PROJECT")
BQ_DATASET = os.environ.get("BQ_DATASET", "image_qc")
BQ_TABLE = os.environ.get("BQ_TABLE", "qc_event_log")

# Initialize clients outside the handler for reuse
try:
    bq_client = bigquery.Client(project=BQ_PROJECT)
except Exception as e:
    logging.error(f"Failed to initialize BQ client: {e}")
    bq_client = None

@functions_framework.cloud_event
def firestore_to_bigquery(cloud_event: CloudEvent):
    """
    Triggered by a change to a Firestore document.
    Args:
        cloud_event: The CloudEvent payload.
    """
    if not bq_client:
        logging.error("BigQuery client not initialized.")
        raise RuntimeError("BigQuery client not initialized")

    data = cloud_event.data
    
    # Check for 'value' in data - standard for firestore document events
    if "value" not in data:
        logging.warning(f"No 'value' found in event data. Event type: {cloud_event['type']}")
        return

    try:
        # 1. Parse Firestore payload
        # The data['value'] is already a dict representation of the document, but fields are typed
        # e.g., {"fields": {"key": {"stringValue": "val"}}}
        # We need to parse this Typed Dictionary into a Python Dictionary
        
        # Helper to parse typed firestore dict
        doc_data = parse_firestore_document(data["value"])
        
        if not doc_data:
            logging.warning("Parsed document data is empty.")
            return

        # 2. Transform to BigQuery Schema
        row = transform_to_bq_row(doc_data)
        
        # 3. Insert into BigQuery
        table_id = f"{BQ_PROJECT}.{BQ_DATASET}.{BQ_TABLE}"
        
        errors = bq_client.insert_rows_json(table_id, [row])
        if errors:
            logging.error(f"Encountered errors while inserting rows: {errors}")
            raise RuntimeError(f"BigQuery insert failed: {errors}")
            
        logging.info(f"Successfully inserted event {row.get('event_id')}")

    except Exception as e:
        logging.error(f"Error processing event: {e}")
        # Re-raising exception ensures Cloud Function retries the event
        raise e

def parse_firestore_document(document):
    """
    Parses a Firestore document (with 'fields' and type wrappers) into a simple dict.
    """
    fields = document.get("fields", {})
    parsed = {}
    
    for key, value in fields.items():
        parsed[key] = parse_value(value)
        
    return parsed

def parse_value(value):
    """
    Recursively parses a Firestore value type wrapper.
    """
    if "stringValue" in value:
        return value["stringValue"]
    elif "integerValue" in value:
        return int(value["integerValue"])
    elif "doubleValue" in value:
        return float(value["doubleValue"])
    elif "booleanValue" in value:
        return value["booleanValue"]
    elif "timestampValue" in value:
        return value["timestampValue"]
    elif "mapValue" in value:
        # Recursive call for maps
        return parse_firestore_document(value["mapValue"])
    elif "arrayValue" in value:
        return [parse_value(v) for v in value["arrayValue"].get("values", [])]
    elif "nullValue" in value:
        return None
    return None

def transform_to_bq_row(data):
    """
    Maps Firestore document fields to BigQuery table schema.
    """
    # Ensure all required fields exist or set defaults
    row = {
        "event_id": data.get("event_id"),
        "event_ts": data.get("event_ts"), 
        "event_type": data.get("event_type"),
        "actor": data.get("actor"),
        "product_variant_id": data.get("product_variant_id"),
        "image_index": data.get("image_index"),
        "old_status": data.get("old_status"),
        "new_status": data.get("new_status"),
        "issue_key": data.get("issue_key"),
        "old_issue_value": data.get("old_issue_value"),
        "new_issue_value": data.get("new_issue_value"),
        "source": "firestore_trigger",
    }
    
    # Handle JSON/STRUCT fields
    if "issues_snapshot" in data:
        # BigQuery JSON type expects a JSON string for insert_rows_json usually, 
        # or dict if client handles it. Safest is string.
        row["issues_snapshot"] = json.dumps(data["issues_snapshot"])
    else:
        row["issues_snapshot"] = None
        
    return row
