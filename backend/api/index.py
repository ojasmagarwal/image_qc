import os
import json
import uuid
import logging
from datetime import datetime
from typing import Optional, List, Any, Dict

from fastapi import FastAPI, HTTPException, Query, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, EmailStr
from google.cloud import bigquery
from google.cloud import firestore
from google.oauth2 import service_account

# --- Configuration & Setup ---

app = FastAPI(title="Image QC API", description="Backend for Image QC Module with BigQuery Read & Firestore Write")

# Environment Variables
BQ_PROJECT = os.environ.get("BQ_PROJECT", "temporary-471207")
BQ_DATASET = os.environ.get("BQ_DATASET", "image_qc")
FIRESTORE_PROJECT = os.environ.get("FIRESTORE_PROJECT", "temporary-471207")
GCP_SA_JSON = os.environ.get("GCP_SA_JSON")
# CORS: Allow specific origins or default to *
CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "*").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("image_qc_api")

# --- Clients ---

_bq_client: Optional[bigquery.Client] = None
_fs_client: Optional[firestore.Client] = None
_fs_initialized = False

def get_credentials():
    if GCP_SA_JSON:
        try:
            creds_dict = json.loads(GCP_SA_JSON)
            return service_account.Credentials.from_service_account_info(creds_dict)
        except Exception as e:
            logger.error(f"Failed to parse GCP_SA_JSON: {e}")
            return None
    return None

def get_bq_client() -> bigquery.Client:
    global _bq_client
    if _bq_client is None:
        creds = get_credentials()
        # Fallback to default auth if creds are None (e.g. locally authenticated gcloud)
        _bq_client = bigquery.Client(credentials=creds, project=BQ_PROJECT)
    return _bq_client

def get_fs_client() -> Optional[firestore.Client]:
    """
    Returns Firestore client if configured, else None (Read-Only Mode).
    """
    global _fs_client, _fs_initialized
    if not _fs_initialized:
        creds = get_credentials()
        if creds or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
            try:
                _fs_client = firestore.Client(credentials=creds, project=FIRESTORE_PROJECT)
                logger.info("Firestore client initialized successfully.")
            except Exception as e:
                logger.warning(f"Firestore initialization failed: {e}. Running in READ-ONLY mode.")
                _fs_client = None
        else:
            logger.warning("No credentials found for Firestore. Running in READ-ONLY mode.")
            _fs_client = None
        _fs_initialized = True
    return _fs_client

# --- Models ---

class ToggleRequest(BaseModel):
    product_variant_id: str
    image_index: int
    actor: EmailStr

class ToggleResponse(BaseModel):
    new_status: str
    event_id: str

class RemarkResponse(BaseModel):
    status: str
    event_id: str

class RoleResponse(BaseModel):
    email: str
    role: str
    exists: bool = False

class FilterResponse(BaseModel):
    categories: List[str]
    brands: List[str]
    created_date_buckets: List[str]


class ImageIssues(BaseModel):
    image_blur: bool = False
    cropped_image: bool = False
    mrp_present_in_image: bool = False
    image_quality: bool = False
    aspect_ratio: bool = False


class ImageItem(BaseModel):
    image_index: int
    image_url: str
    aspect_ratio_value: Optional[str] = None  # Stored as string like "1:1" in BigQuery
    meta_3x4: Optional[str] = None
    hide_padding: Optional[bool] = None
    dpi: Optional[float] = None
    white_bg: Optional[bool] = None
    review_status: str
    issues: ImageIssues
    updated_by: Optional[str] = None
    updated_at: Optional[datetime] = None


class PvidItem(BaseModel):
    product_variant_id: str
    brand_name: str
    product_name: str
    category_name: str
    subcategory_name: str
    l3_category_name: str
    created_date_bucket_label: Optional[str] = None
    pvid_review_status: str
    images: List[ImageItem]


class ImagesResponse(BaseModel):
    items: List[PvidItem]
    page: int
    page_size: int
    has_more: bool


class IssueToggleRequest(BaseModel):
    product_variant_id: str
    image_index: int
    actor: EmailStr
    issue_key: str
    value: bool


class IssueToggleResponse(BaseModel):
    status: str
    event_id: str

# --- Helpers ---

def get_bq_table_id(table_name: str) -> str:
    return f"{BQ_PROJECT}.{BQ_DATASET}.{table_name}"

def get_firestore_doc_id(pvid: str, image_index: int) -> str:
    return f"{pvid}__{image_index}"


ISSUE_KEYS = [
    "image_blur",
    "cropped_image",
    "mrp_present_in_image",
    "image_quality",
    "aspect_ratio",
]

# --- Endpoints ---

@router.get("/filters", response_model=FilterResponse)
def get_filters():
    """
    Fetch distinct values for filters from BigQuery.
    """
    bq = get_bq_client()
    table_id = get_bq_table_id("qc_image_source")
    
    # We fetch all distincts in one go or separate queries. For simplicity/speed on BQ, separate might be clearer but one is fewer round trips.
    # Let's do separate or union. Union is efficient.
    # Note: casting DATE to STRING for JSON serialization
    
    query = f"""
        SELECT 'category' AS type, category_name AS value FROM `{table_id}` GROUP BY 2
UNION ALL
SELECT 'brand' AS type, brand_name AS value FROM `{table_id}` GROUP BY 2
UNION ALL
SELECT 'created_date_bucket' AS type,
       COALESCE(created_date_bucket_label, 'More than 30 Days') AS value
FROM `{table_id}`
GROUP BY 2
    """
    
    try:
        job = bq.query(query)
        rows = list(job.result())
        
        categories = ["All"] + sorted([r['value'] for r in rows if r['type'] == 'category' and r['value']])
        brands = ["All"] + sorted([r['value'] for r in rows if r['type'] == 'brand' and r['value']])
        BUCKET_ORDER = [
            "Last 10 Days",
            "11-20 Days",
            "21-30 Days",
            "More than 30 Days",
        ]

        buckets = [
            r['value']
            for r in rows
            if r['type'] == 'created_date_bucket' and r['value']
        ]

        # Keep fixed order
        created_date_buckets = ["All"] + [
            b for b in BUCKET_ORDER if b in set(buckets)
        ]
        
        return FilterResponse(categories=categories, brands=brands, created_date_buckets=created_date_buckets)
    except Exception as e:
        logger.error(f"Error fetching filters: {e}")
        # Return empty/safe defaults if BQ fails
        return FilterResponse(categories=["All"], brands=["All"], created_date_buckets=["All"])


@router.get("/images", response_model=ImagesResponse)
def get_images(
    page: int = Query(1, ge=1),
    status: Optional[str] = None,
    brand: Optional[str] = None,
    l1: Optional[List[str]] = Query(None, alias="category_name"),
    l2: Optional[str] = Query(None, alias="subcategory_name"),
    l3: Optional[str] = Query(None, alias="l3_category_name"),
    pvid: Optional[str] = Query(None, alias="product_variant_id"),
    created_bucket: Optional[str] = None
):
    """
    Fetch PVID-level items with nested images[] and filters.
    """
    bq = get_bq_client()
    fs = get_fs_client()
    limit = 100  # PVIDs per page
    offset = (page - 1) * limit
    table_id = get_bq_table_id("qc_image_source")

    # 1. Build dynamic WHERE clause for the base rows (per product_variant_id)
    where_clauses = ["1=1"]
    params = []
    
    if brand and brand != "All":
        where_clauses.append("brand_name = @brand")
        params.append(bigquery.ScalarQueryParameter("brand", "STRING", brand))
        
    # Multi-select category
    if l1:
        # If "All" is in the list or list is empty/None, we ignore filter
        # But frontend might send specific items.
        # Clean the list: remove "All"
        valid_l1 = [c for c in l1 if c != "All"]
        if valid_l1:
             where_clauses.append("category_name IN UNNEST(@categories)")
             params.append(bigquery.ArrayQueryParameter("categories", "STRING", valid_l1))

    if l2:
        where_clauses.append("subcategory_name = @l2")
        params.append(bigquery.ScalarQueryParameter("l2", "STRING", l2))
    if l3:
        where_clauses.append("l3_category_name = @l3")
        params.append(bigquery.ScalarQueryParameter("l3", "STRING", l3))
    if pvid:
        # PVID filter (case-insensitive contains)
        where_clauses.append("LOWER(product_variant_id) LIKE LOWER(@pvid)")
        params.append(bigquery.ScalarQueryParameter("pvid", "STRING", f"%{pvid}%"))
    if created_bucket and created_bucket != "All":
        # Normalize nulls into 'More than 30 Days' bucket
        where_clauses.append("COALESCE(created_date_bucket_label, 'More than 30 Days') = @created_bucket")
        params.append(bigquery.ScalarQueryParameter("created_bucket", "STRING", created_bucket))

    where_sql = " AND ".join(where_clauses)

    # Pagination in BQ (100 PVIDs per page)
    params.append(bigquery.ScalarQueryParameter("limit", "INT64", limit))
    params.append(bigquery.ScalarQueryParameter("offset", "INT64", offset))
    
    try:
        job_config = bigquery.QueryJobConfig(query_parameters=params)
        query = f"""
        SELECT
          product_variant_id,
          brand_name,
          product_name,
          category_name,
          subcategory_name,
          l3_category_name,
          COALESCE(created_date_bucket_label, 'More than 30 Days') AS created_date_bucket_label,
          image_url1, image_url2, image_url3, image_url4, image_url5,
          image_url6, image_url7, image_url8, image_url9, image_url10,
          aspect_ratio1, aspect_ratio2, aspect_ratio3, aspect_ratio4, aspect_ratio5,
          aspect_ratio6, aspect_ratio7, aspect_ratio8, aspect_ratio9, aspect_ratio10,
          meta_3x4_1, meta_3x4_2, meta_3x4_3, meta_3x4_4, meta_3x4_5,
          meta_3x4_6, meta_3x4_7, meta_3x4_8, meta_3x4_9, meta_3x4_10,
          hide_padding1, hide_padding2, hide_padding3, hide_padding4, hide_padding5,
          hide_padding6, hide_padding7, hide_padding8, hide_padding9, hide_padding10,
          dpi_1, dpi_2, dpi_3, dpi_4, dpi_5,
          dpi_6, dpi_7, dpi_8, dpi_9, dpi_10,
          white_bg1, white_bg2, white_bg3, white_bg4, white_bg5,
          white_bg6, white_bg7, white_bg8, white_bg9, white_bg10
        FROM `{table_id}`
        WHERE {where_sql}
        ORDER BY product_variant_id
        LIMIT @limit OFFSET @offset
        """

        query_job = bq.query(query, job_config=job_config)
        bq_rows = [dict(row) for row in query_job.result()]
    except Exception as e:
        logger.error(f"BQ Query failed: {e}")
        raise HTTPException(status_code=500, detail=f"Database query failed: {str(e)}")
    
    if not bq_rows:
        return ImagesResponse(items=[], page=page, page_size=limit, has_more=False)

    # 2. Build PVID-level structure with image slots 1..10 from BQ
    pvid_items: Dict[str, Dict[str, Any]] = {}
    doc_ids: List[str] = []

    for row in bq_rows:
        pvid_val = row["product_variant_id"]
        item = pvid_items.setdefault(
            pvid_val,
            {
                "product_variant_id": pvid_val,
                "brand_name": row.get("brand_name"),
                "product_name": row.get("product_name"),
                "category_name": row.get("category_name"),
                "subcategory_name": row.get("subcategory_name"),
                "l3_category_name": row.get("l3_category_name"),
                "created_date_bucket_label": row.get("created_date_bucket_label"),
                "images": [],
            },
        )

        # Build image list from wide columns
        for idx in range(1, 11):
            url_key = f"image_url{idx}"
            url = row.get(url_key)
            if not url:
                continue

            img = {
                "image_index": idx,
                "image_url": url,
                "aspect_ratio_value": row.get(f"aspect_ratio{idx}"),
                "meta_3x4": row.get(f"meta_3x4_{idx}"),
                "hide_padding": row.get(f"hide_padding{idx}"),
                "dpi": row.get(f"dpi_{idx}"),
                "white_bg": row.get(f"white_bg{idx}"),
            }
            item["images"].append(img)

            if fs:
                doc_ids.append(get_firestore_doc_id(pvid_val, idx))

    # 3. Batch Get from Firestore (if available)
    fs_map: Dict[str, Dict[str, Any]] = {}
    if fs and doc_ids:
        try:
            doc_refs = [fs.collection("qc_current_state").document(did) for did in doc_ids]
            fs_docs = fs.get_all(doc_refs)
            for doc in fs_docs:
                if doc.exists:
                    fs_map[doc.id] = doc.to_dict()
        except Exception as e:
            logger.error(f"Firestore batch get failed: {e}")
            # Degrade gracefully -> treat all as defaults

    # 4. Merge Firestore state and apply status filter at PVID level
    result_items: List[PvidItem] = []
    for pvid_val, raw_item in pvid_items.items():
        merged_images: List[ImageItem] = []
        all_images_reviewed = True if raw_item["images"] else False

        for img in raw_item["images"]:
            did = get_firestore_doc_id(pvid_val, img["image_index"])
            state = fs_map.get(did, {})

            review_status = state.get("review_status", "NOT_REVIEWED")
            
            if review_status != "REVIEWED":
                all_images_reviewed = False

            issues_state = state.get("issues") or {}
            issues = ImageIssues(
                image_blur=bool(issues_state.get("image_blur", False)),
                cropped_image=bool(issues_state.get("cropped_image", False)),
                mrp_present_in_image=bool(issues_state.get("mrp_present_in_image", False)),
                image_quality=bool(issues_state.get("image_quality", False)),
                aspect_ratio=bool(issues_state.get("aspect_ratio", False)),
            )

            merged_images.append(
                ImageItem(
                    image_index=img["image_index"],
                    image_url=img["image_url"],
                    aspect_ratio_value=img.get("aspect_ratio_value"),
                    meta_3x4=img.get("meta_3x4"),
                    hide_padding=img.get("hide_padding"),
                    dpi=img.get("dpi"),
                    white_bg=img.get("white_bg"),
                    review_status=review_status,
                    issues=issues,
                    updated_by=state.get("updated_by"),
                    updated_at=state.get("updated_at"),
                )
            )

        # Compute PVID status
        pvid_review_status = "REVIEWED" if all_images_reviewed and merged_images else "NOT_REVIEWED"

        # Apply Status Filter at PVID level
        if status and status != "All":
            if status == "REVIEWED" and pvid_review_status != "REVIEWED":
                continue
            if status == "NOT_REVIEWED" and pvid_review_status == "REVIEWED":
                continue

        result_items.append(
            PvidItem(
                product_variant_id=raw_item["product_variant_id"],
                brand_name=raw_item["brand_name"],
                product_name=raw_item["product_name"],
                category_name=raw_item["category_name"],
                subcategory_name=raw_item["subcategory_name"],
                l3_category_name=raw_item["l3_category_name"],
                created_date_bucket_label=raw_item["created_date_bucket_label"],
                pvid_review_status=pvid_review_status,
                images=merged_images,
            )
        )

    has_more = len(bq_rows) == limit

    return ImagesResponse(
        items=result_items,
        page=page,
        page_size=limit,
        has_more=has_more,
    )

@router.post("/qc/toggle", response_model=ToggleResponse)
def toggle_status(req: ToggleRequest):
    fs = get_fs_client()
    if not fs:
        raise HTTPException(status_code=503, detail="Firestore not configured. System is Read-Only.")

    doc_id = get_firestore_doc_id(req.product_variant_id, req.image_index)
    doc_ref = fs.collection('qc_current_state').document(doc_id)
    
    event_id = str(uuid.uuid4())
    event_ts = datetime.utcnow()
    
    @firestore.transactional
    def update_in_transaction(transaction, doc_ref):
        snapshot = doc_ref.get(transaction=transaction)
        current_status = "NOT_REVIEWED"
        
        if snapshot.exists:
            data = snapshot.to_dict()
            current_status = data.get('review_status', 'NOT_REVIEWED')
            
        new_status = "REVIEWED" if current_status == "NOT_REVIEWED" else "NOT_REVIEWED"
        
        # Write to Current State
        transaction.set(
            doc_ref,
            {
                'product_variant_id': req.product_variant_id,
                'image_index': req.image_index,
                'review_status': new_status,
                'updated_by': req.actor,
                'updated_at': event_ts,
            },
            merge=True,
        )
        
        # Write to Event Log
        log_ref = fs.collection('qc_event_log').document(event_id)
        transaction.set(log_ref, {
            'event_id': event_id,
            'event_ts': event_ts,
            'event_type': 'STATUS_CHANGE',
            'product_variant_id': req.product_variant_id,
            'image_index': req.image_index,
            'old_status': current_status,
            'new_status': new_status,
            'actor': req.actor
        })
        
        return new_status

    transaction = fs.transaction()
    new_status = update_in_transaction(transaction, doc_ref)
    
    return ToggleResponse(new_status=new_status, event_id=event_id)

@router.post("/qc/issues/toggle", response_model=IssueToggleResponse)
def toggle_issue(req: IssueToggleRequest):
    """
    Toggle a specific issue flag for an image (per product_variant_id, image_index).
    """
    fs = get_fs_client()
    if not fs:
        raise HTTPException(status_code=503, detail="Firestore not configured. System is Read-Only.")

    if req.issue_key not in ISSUE_KEYS:
        raise HTTPException(status_code=400, detail=f"Invalid issue_key '{req.issue_key}'")

    doc_id = get_firestore_doc_id(req.product_variant_id, req.image_index)
    doc_ref = fs.collection("qc_current_state").document(doc_id)

    event_id = str(uuid.uuid4())
    event_ts = datetime.utcnow()

    @firestore.transactional
    def update_in_transaction(transaction, doc_ref):
        snapshot = doc_ref.get(transaction=transaction)
        current_status = "NOT_REVIEWED"
        current_issues = {}

        if snapshot.exists:
            data = snapshot.to_dict()
            current_status = data.get("review_status", "NOT_REVIEWED")
            current_issues = data.get("issues") or {}

        old_value = bool(current_issues.get(req.issue_key, False))
        new_value = bool(req.value)

        current_issues[req.issue_key] = new_value

        # Write to Current State
        transaction.set(
            doc_ref,
            {
                "product_variant_id": req.product_variant_id,
                "image_index": req.image_index,
                "review_status": current_status,
                "issues": current_issues,
                "updated_by": req.actor,
                "updated_at": event_ts,
            },
            merge=True,
        )

        # Write to Event Log
        log_ref = fs.collection("qc_event_log").document(event_id)
        transaction.set(
            log_ref,
            {
                "event_id": event_id,
                "event_ts": event_ts,
                "event_type": "ISSUE_CHANGE",
                "product_variant_id": req.product_variant_id,
                "image_index": req.image_index,
                "issue_key": req.issue_key,
                "old_issue_value": old_value,
                "new_issue_value": new_value,
                "issues_snapshot": current_issues,
                "actor": req.actor,
            },
        )

    transaction = fs.transaction()
    update_in_transaction(transaction, doc_ref)

    return IssueToggleResponse(status="ok", event_id=event_id)

@router.get("/me/role", response_model=RoleResponse)
def get_role(email: str):
    fs = get_fs_client()
    if not fs:
        # If no DB, everyone is a viewer (safest)
        return RoleResponse(email=email, role="viewer")
        
    try:
        # Check 'Reviewers' collection (email as document ID)
        doc = fs.collection('Reviewers').document(email).get()
        role = "viewer"
        exists = False
        
        if doc.exists:
            exists = True
            data = doc.to_dict()
            if data.get("role") == "reviewer":
                role = "reviewer"
            elif data.get("role") == "admin":
                 role = "admin"
                
        return RoleResponse(email=email, role=role, exists=exists)
    except Exception as e:
        logger.error(f"Error fetching role: {e}")
        return RoleResponse(email=email, role="viewer", exists=False)

def verify_reviewer_access(email: str):
    """
    Raises HTTP 403 if user is not a reviewer.
    """
    fs = get_fs_client()
    if not fs:
        raise HTTPException(status_code=503, detail="Firestore not configured (Read-Only).")
        
    try:
        doc = fs.collection('Reviewers').document(email).get()
        if not doc.exists or doc.to_dict().get("role") != "reviewer":
             raise HTTPException(status_code=403, detail="Permission denied: Reviewer role required.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error verifying access: {e}")
        raise HTTPException(status_code=500, detail="Authorization check failed.")

@router.get("/health")
def health():
    return {"status": "ok"}
app.include_router(router)

