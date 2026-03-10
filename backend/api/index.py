import os
import json
import uuid
import time
import math
import random
import logging
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Optional, List, Any, Dict

from fastapi import FastAPI, HTTPException, Query, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, EmailStr
from google.cloud import bigquery
from google.cloud import firestore
from google.oauth2 import service_account
from google.api_core import exceptions as gapi_exceptions

# --- Configuration & Setup ---

app = FastAPI(title="Image QC API", description="Backend for Image QC Module with BigQuery Read & Firestore Write")
router = APIRouter(prefix="/api")

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
    desired_status: Optional[str] = None  # "REVIEWED" | "NOT_REVIEWED" (idempotent when set)

class ToggleResponse(BaseModel):
    new_status: str
    event_id: str

class RemarkRequest(BaseModel):
    product_variant_id: str
    image_index: int
    actor: EmailStr
    remark: Optional[str]

class RemarkResponse(BaseModel):
    status: str
    event_id: str

class FilterResponse(BaseModel):
    categories: List[str]
    brands: List[str]
    created_date_buckets: List[str]

class RoleResponse(BaseModel):
    email: str
    role: str
    exists: bool = False
# --- Constants ---
ISSUE_KEYS = {
    "image_blur",
    "cropped_image",
    "mrp_present_in_image",
    "image_quality",
    "aspect_ratio",
    "less_than_5_images",
    "sequence_incorrect",
    "duplicate_images"
}

# --- Pydantic Models ---
class ImageIssues(BaseModel):
    image_blur: bool = False
    cropped_image: bool = False
    mrp_present_in_image: bool = False
    image_quality: bool = False
    aspect_ratio: bool = False
    less_than_5_images: bool = False
    sequence_incorrect: bool = False
    duplicate_images: bool = False

class ImageItem(BaseModel):
    image_index: int
    image_url: str
    image_link_3x4: Optional[str] = None
    aspect_ratio_value: Optional[str]
    meta_3x4: Optional[str]
    hide_padding: Optional[bool]
    dpi: Optional[int]
    white_bg: Optional[bool]
    review_status: str = "NOT_REVIEWED"
    issues: ImageIssues = Field(default_factory=ImageIssues)
    remark: Optional[str] = None
    updated_by: Optional[str]
    updated_at: Optional[datetime]
    last_updated_at: Optional[datetime] = None
    last_updated_by: Optional[str] = None
    image_format: Optional[str] = None

class PvidItem(BaseModel):
    product_variant_id: str
    brand_name: str
    product_name: str
    category_name: str
    subcategory_name: str
    l3_category_name: str
    packsize: Optional[str] = None
    created_date_bucket_label: Optional[str] = None
    pvid_review_status: str
    image_count: Optional[int] = None
    image_3x4_count: Optional[int] = None
    transparent_image_exists: Optional[bool] = None
    transparent_image_link: Optional[str] = None
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
    brand: Optional[List[str]] = Query(None),
    l1: Optional[List[str]] = Query(None, alias="category_name"),
    l2: Optional[str] = Query(None, alias="subcategory_name"),
    l3: Optional[str] = Query(None, alias="l3_category_name"),
    pvid: Optional[List[str]] = Query(None, alias="product_variant_id"),
    created_bucket: Optional[List[str]] = Query(None),
    include_fs_state: bool = Query(True),
    actor_email: Optional[str] = Query(None),
):
    """
    Fetch PVID-level items with nested images[] and filters.
    For reviewer role: restricts to today's assigned PVIDs unless an explicit pvid search is provided.
    """
    bq = get_bq_client()
    fs = get_fs_client()
    limit = 100  # PVIDs per page
    offset = (page - 1) * limit
    table_id = get_bq_table_id("qc_image_source")

    # 1. Build dynamic WHERE clause for the base rows (per product_variant_id)
    where_clauses = ["1=1"]
    params = []
    
    # Filter Logic
    if status and status != "All":
        # Status filtering happens via JOIN on latest state, handled in query structure usually
        # But for 'WHERE' clause, we might need adjustments if status is in the main table or joined.
        # Assuming current logic handles status via the complex query construction below.
        pass

    # Multi-select category
    if l1:
        # If "All" is in the list or list is empty/None, we ignore filter
        # But frontend might send specific items.
        # Clean the list: remove "All"
        valid_l1 = [c for c in l1 if c != "All"]
        if valid_l1:
             where_clauses.append("category_name IN UNNEST(@categories)")
             params.append(bigquery.ArrayQueryParameter("categories", "STRING", valid_l1))

    # Multi-select brand
    if brand:
        valid_brands = [b for b in brand if b != "All"]
        if valid_brands:
            where_clauses.append("brand_name IN UNNEST(@brands)")
            params.append(bigquery.ArrayQueryParameter("brands", "STRING", valid_brands))
            
    # Multi-select created_bucket
    if created_bucket:
         valid_buckets = [b for b in created_bucket if b != "All"]
         if valid_buckets:
             # Handle NULLs in data if needed, or assume label is populated
             where_clauses.append("COALESCE(created_date_bucket_label, 'More than 30 Days') IN UNNEST(@created_buckets)")
             params.append(bigquery.ArrayQueryParameter("created_buckets", "STRING", valid_buckets))

    if l2:
        where_clauses.append("subcategory_name = @l2")
        params.append(bigquery.ScalarQueryParameter("l2", "STRING", l2))
    if l3:
        where_clauses.append("l3_category_name = @l3")
        params.append(bigquery.ScalarQueryParameter("l3", "STRING", l3))

    # --- Reviewer assignment filter ---
    # Must happen BEFORE the pvid WHERE clause so our override is picked up.
    # EXCEPTION: if the user already provided explicit pvid params, bypass the filter.
    if actor_email and fs:
        actor_role = _resolve_role(fs, actor_email)
        has_explicit_pvid_search = bool(pvid and any(p for p in pvid if p))
        if actor_role == "reviewer" and not has_explicit_pvid_search:
            assigned_pvids = _get_reviewer_assigned_pvids(fs, actor_email)
            if assigned_pvids is not None:  # None means no assignment doc yet → no filter
                pvid = assigned_pvids if assigned_pvids else ["__EMPTY_ASSIGNMENT__"]  # empty → zero results
                logger.info(
                    "role=reviewer actor=%s assignment_filter_applied=True pvids_in_scope=%d",
                    actor_email, len(assigned_pvids)
                )

    if pvid:
        # PVID filter: if list has > 1 item, use IN. If 1 item, use LIKE for partial match.
        # For reviewer assignment injection (always ≥2 PVIDs), uses IN with exact match.
        valid_pvids = [p for p in pvid if p]  # clean empty strings
        if len(valid_pvids) == 1:
            where_clauses.append("LOWER(product_variant_id) LIKE LOWER(@pvid_single)")
            params.append(bigquery.ScalarQueryParameter("pvid_single", "STRING", f"%{valid_pvids[0]}%"))
        elif len(valid_pvids) > 1:
            where_clauses.append("product_variant_id IN UNNEST(@pvid_list)")
            params.append(bigquery.ArrayQueryParameter("pvid_list", "STRING", valid_pvids))

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
          CAST(packsize AS STRING) as packsize,
          COALESCE(created_date_bucket_label, 'More than 30 Days') AS created_date_bucket_label,
          image_url1, image_url2, image_url3, image_url4, image_url5,
          image_url6, image_url7, image_url8, image_url9, image_url10,
          `3x4_image_link1`, `3x4_image_link2`, `3x4_image_link3`, `3x4_image_link4`, `3x4_image_link5`,
          `3x4_image_link6`, `3x4_image_link7`, `3x4_image_link8`, `3x4_image_link9`, `3x4_image_link10`,
          aspect_ratio1, aspect_ratio2, aspect_ratio3, aspect_ratio4, aspect_ratio5,
          aspect_ratio6, aspect_ratio7, aspect_ratio8, aspect_ratio9, aspect_ratio10,
          meta_3x4_1, meta_3x4_2, meta_3x4_3, meta_3x4_4, meta_3x4_5,
          meta_3x4_6, meta_3x4_7, meta_3x4_8, meta_3x4_9, meta_3x4_10,
          hide_padding1, hide_padding2, hide_padding3, hide_padding4, hide_padding5,
          hide_padding6, hide_padding7, hide_padding8, hide_padding9, hide_padding10,
          dpi_1, dpi_2, dpi_3, dpi_4, dpi_5,
          dpi_6, dpi_7, dpi_8, dpi_9, dpi_10,
          white_bg1, white_bg2, white_bg3, white_bg4, white_bg5,
          white_bg6, white_bg7, white_bg8, white_bg9, white_bg10,
          image1_last_updated_at, image2_last_updated_at, image3_last_updated_at, image4_last_updated_at, image5_last_updated_at,
          image6_last_updated_at, image7_last_updated_at, image8_last_updated_at, image9_last_updated_at, image10_last_updated_at,
          image1_updated_by, image2_updated_by, image3_updated_by, image4_updated_by, image5_updated_by,
          image6_updated_by, image7_updated_by, image8_updated_by, image9_updated_by, image10_updated_by,
          image_count, image_3x4_count, transparent_image_exists, transparent_image_link,
          image1_format, image2_format, image3_format, image4_format, image5_format,
          image6_format, image7_format, image8_format, image9_format, image10_format
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
                "packsize": row.get("packsize"),
                "created_date_bucket_label": row.get("created_date_bucket_label"),
                "image_count": row.get("image_count"),
                "image_3x4_count": row.get("image_3x4_count"),
                "transparent_image_exists": row.get("transparent_image_exists"),
                "transparent_image_link": row.get("transparent_image_link"),
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
                "image_link_3x4": row.get(f"3x4_image_link{idx}"),
                "aspect_ratio_value": row.get(f"aspect_ratio{idx}"),
                "meta_3x4": row.get(f"meta_3x4_{idx}"),
                "hide_padding": row.get(f"hide_padding{idx}"),
                "dpi": row.get(f"dpi_{idx}"),
                "white_bg": row.get(f"white_bg{idx}"),
                "last_updated_at": row.get(f"image{idx}_last_updated_at"),
                "last_updated_by": row.get(f"image{idx}_updated_by"),
                "image_format": row.get(f"image{idx}_format"),
            }
            item["images"].append(img)

    # 3. Batch Get from Firestore (Option B + C)
    # Option B: skip Firestore entirely for viewers (include_fs_state=False)
    # Option C: one doc per PVID instead of one per image
    fs_map: Dict[str, Dict[str, Any]] = {}
    doc_ids: List[str] = list(pvid_items.keys())  # one doc ID per PVID
    if include_fs_state and fs:
        try:
            doc_refs = [fs.collection("qc_current_state").document(pvid_id) for pvid_id in doc_ids]
            fs_docs = fs.get_all(doc_refs)
            for doc in fs_docs:
                if doc.exists:
                    fs_map[doc.id] = doc.to_dict()
            logger.info(f"FS merge mode=OptionC pvid_docs={len(doc_ids)} include_fs_state={include_fs_state}")
        except Exception as e:
            logger.error(f"Firestore batch get failed: {e}")
            # Degrade gracefully -> treat all as defaults
    else:
        logger.info(f"FS merge mode=OptionC pvid_docs={len(doc_ids)} include_fs_state={include_fs_state}")

    # 4. Merge Firestore state and apply status filter at PVID level
    result_items: List[PvidItem] = []
    for pvid_val, raw_item in pvid_items.items():
        merged_images: List[ImageItem] = []

        # Option C: one doc per PVID; images keyed by str(image_index)
        pvid_state = fs_map.get(pvid_val, {}) or {}
        images_state: Dict[str, Any] = pvid_state.get("images") or {}

        for img in raw_item["images"]:
            idx_key = str(img["image_index"])
            img_state = images_state.get(idx_key, {}) or {}

            review_status = img_state.get("review_status", "NOT_REVIEWED")

            issues_state = img_state.get("issues") or {}
            issues = ImageIssues(
                image_blur=bool(issues_state.get("image_blur", False)),
                cropped_image=bool(issues_state.get("cropped_image", False)),
                mrp_present_in_image=bool(issues_state.get("mrp_present_in_image", False)),
                image_quality=bool(issues_state.get("image_quality", False)),
                aspect_ratio=bool(issues_state.get("aspect_ratio", False)),
                less_than_5_images=bool(issues_state.get("less_than_5_images", False)),
                sequence_incorrect=bool(issues_state.get("sequence_incorrect", False)),
                duplicate_images=bool(issues_state.get("duplicate_images", False)),
            )

            merged_images.append(
                ImageItem(
                    image_index=img["image_index"],
                    image_url=img["image_url"],
                    image_link_3x4=img["image_link_3x4"],
                    aspect_ratio_value=img.get("aspect_ratio_value"),
                    meta_3x4=img.get("meta_3x4"),
                    hide_padding=img.get("hide_padding"),
                    dpi=img.get("dpi"),
                    white_bg=img.get("white_bg"),
                    review_status=review_status,
                    issues=issues,
                    remark=img_state.get("remark"),
                    updated_by=img_state.get("updated_by"),
                    updated_at=img_state.get("updated_at"),
                    last_updated_at=img.get("last_updated_at"),
                    last_updated_by=img.get("last_updated_by"),
                    image_format=img.get("image_format"),
                )
            )

        # Compute PVID status: ALL images must be REVIEWED for PVID to be REVIEWED.
        all_reviewed_flag = all(img.review_status == "REVIEWED" for img in merged_images) if merged_images else False
        pvid_review_status = "REVIEWED" if all_reviewed_flag else "NOT_REVIEWED"

        # Apply Status Filter at PVID level
        if status and status != "All":
            if status != pvid_review_status:
                continue

        result_items.append(
            PvidItem(
                product_variant_id=pvid_val,
                product_name=raw_item["product_name"],
                brand_name=raw_item["brand_name"],
                category_name=raw_item["category_name"],
                subcategory_name=raw_item["subcategory_name"],
                l3_category_name=raw_item["l3_category_name"],
                packsize=raw_item["packsize"],
                created_date_bucket_label=raw_item["created_date_bucket_label"],
                pvid_review_status=pvid_review_status,
                image_count=raw_item["image_count"],
                image_3x4_count=raw_item["image_3x4_count"],
                transparent_image_exists=raw_item["transparent_image_exists"],
                transparent_image_link=raw_item["transparent_image_link"],
                images=merged_images,
            )
        )

    # Sort if needed (optional)
    # result_items.sort(key=lambda x: x.product_variant_id)

    has_more = len(bq_rows) == limit

    return ImagesResponse(
        items=result_items,
        page=page,
        page_size=limit,
        has_more=has_more,
    )

from fastapi.responses import JSONResponse

@router.post("/qc/toggle", response_model=ToggleResponse)
def toggle_status(req: ToggleRequest):
    fs = get_fs_client()
    if not fs:
        raise HTTPException(status_code=503, detail="Firestore not configured. System is Read-Only.")

    # Validate desired_status if provided
    if req.desired_status is not None and req.desired_status not in ("REVIEWED", "NOT_REVIEWED"):
        raise HTTPException(status_code=400, detail="desired_status must be 'REVIEWED' or 'NOT_REVIEWED'")

    # Option C: one doc per PVID, images map keyed by str(image_index)
    doc_ref = fs.collection('qc_current_state').document(req.product_variant_id)
    idx_key = str(req.image_index)

    event_id = str(uuid.uuid4())
    event_ts = datetime.utcnow()

    @firestore.transactional
    def update_in_transaction(transaction, doc_ref):
        snapshot = doc_ref.get(transaction=transaction)
        current_status = "NOT_REVIEWED"

        if snapshot.exists:
            data = snapshot.to_dict() or {}
            img_state = (data.get("images") or {}).get(idx_key) or {}
            current_status = img_state.get('review_status', 'NOT_REVIEWED')

        # Idempotent: use explicit desired_status if provided, else toggle
        if req.desired_status is not None:
            new_status = req.desired_status
        else:
            new_status = "REVIEWED" if current_status == "NOT_REVIEWED" else "NOT_REVIEWED"

        # Short-circuit: no write needed if already in desired state
        if new_status == current_status:
            return current_status, False  # (status, changed)

        # IMPORTANT: Use nested dict — NOT dot-path strings as keys.
        # The Python Firestore SDK does NOT expand "images.1.review_status" into
        # nested maps inside transaction.set(). It stores it as a literal field name.
        # The correct way to write nested maps is via a proper dict structure.
        transaction.set(
            doc_ref,
            {
                "images": {
                    idx_key: {
                        "review_status": new_status,
                        "updated_by": req.actor,
                        "updated_at": event_ts,
                    }
                }
            },
            merge=True,
        )

        # Write event log only when a change occurred
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

        return new_status, True  # (status, changed)

    # Retry with exponential backoff + jitter for write contention
    base = 0.1
    max_attempts = 5
    new_status = None
    transaction = fs.transaction()
    for attempt in range(max_attempts):
        try:
            new_status, changed = update_in_transaction(transaction, doc_ref)
            if changed:
                logger.info(
                    "QC write success: pvid=%s idx=%s event_id=%s new_status=%s",
                    req.product_variant_id, req.image_index, event_id, new_status
                )
            else:
                logger.info(
                    "QC toggle no-op: pvid=%s idx=%s already=%s",
                    req.product_variant_id, req.image_index, new_status
                )
            break
        except gapi_exceptions.Aborted:
            if attempt == max_attempts - 1:
                raise HTTPException(status_code=409, detail="Write contention. Please retry.")
            sleep_s = base * (2 ** attempt) + random.uniform(0, base)
            time.sleep(sleep_s)

    # Post-write diagnostic read
    try:
        _vdoc = doc_ref.get()
        _vdata = _vdoc.to_dict() or {}
        _images = _vdata.get("images") or {}
        stored_status = (_images.get(idx_key) or {}).get("review_status")
        logger.info(
            "Post-write verify: project=%s pvid=%s idx=%s exists=%s doc_id=%s "
            "images_keys=%s stored_status=%s desired=%s",
            getattr(fs, 'project', 'unknown'),
            req.product_variant_id, req.image_index,
            _vdoc.exists, _vdoc.id,
            len(_images), stored_status, req.desired_status
        )
        if stored_status is None:
            # Full dict dump to understand actual structure
            logger.warning("Post-write verify FAILED — full doc: %s", str(_vdata)[:2000])
    except Exception as _e:
        logger.warning("Post-write verify read failed: %s", _e)

    return JSONResponse(
        content={"new_status": new_status, "event_id": event_id},
        headers={"Cache-Control": "no-store"}
    )

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

    # Option C: one doc per PVID, images map keyed by str(image_index)
    doc_ref = fs.collection("qc_current_state").document(req.product_variant_id)
    idx_key = str(req.image_index)

    event_id = str(uuid.uuid4())
    event_ts = datetime.utcnow()

    @firestore.transactional
    def update_in_transaction(transaction, doc_ref):
        snapshot = doc_ref.get(transaction=transaction)
        current_issues = {}

        if snapshot.exists:
            data = snapshot.to_dict() or {}
            img_state = (data.get("images") or {}).get(idx_key) or {}
            current_issues = img_state.get("issues") or {}

        old_value = bool(current_issues.get(req.issue_key, False))
        new_value = bool(req.value)

        # Use proper nested dict — NOT dot-path string keys
        transaction.set(
            doc_ref,
            {
                "images": {
                    idx_key: {
                        "issues": {req.issue_key: new_value},
                        "updated_by": req.actor,
                        "updated_at": event_ts,
                    }
                }
            },
            merge=True,
        )

        # Write to Event Log inside same transaction
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
                "actor": req.actor,
            },
        )

    # Retry with exponential backoff + jitter for write contention
    base = 0.1
    max_attempts = 5
    transaction = fs.transaction()
    for attempt in range(max_attempts):
        try:
            update_in_transaction(transaction, doc_ref)
            logger.info(
                "QC issue write success: pvid=%s idx=%s issue=%s event_id=%s",
                req.product_variant_id, req.image_index, req.issue_key, event_id
            )
            break
        except gapi_exceptions.Aborted:
            if attempt == max_attempts - 1:
                raise HTTPException(status_code=409, detail="Write contention. Please retry.")
            sleep_s = base * (2 ** attempt) + random.uniform(0, base)
            time.sleep(sleep_s)

    return JSONResponse(
        content={"status": "ok", "event_id": event_id},
        headers={"Cache-Control": "no-store"}
    )

@router.post("/qc/remark", response_model=RemarkResponse)
def toggle_remark(req: RemarkRequest):
    """
    Update the remark for a specific image.
    """
    fs = get_fs_client()
    if not fs:
        raise HTTPException(status_code=503, detail="Firestore not configured. System is Read-Only.")

    # Option C: one doc per PVID
    doc_ref = fs.collection("qc_current_state").document(req.product_variant_id)
    idx_key = str(req.image_index)

    event_id = str(uuid.uuid4())
    event_ts = datetime.utcnow()

    @firestore.transactional
    def update_in_transaction(transaction, doc_ref):
        snapshot = doc_ref.get(transaction=transaction)
        old_remark = None

        if snapshot.exists:
            data = snapshot.to_dict()
            img_state = (data.get("images") or {}).get(idx_key, {})
            old_remark = img_state.get("remark")

        if old_remark == req.remark:
            return  # No change

        # Use nested dict for merge (dot-path keys are literal in Python SDK)
        transaction.set(
            doc_ref,
            {
                "images": {
                    idx_key: {
                        "remark": req.remark,
                        "updated_by": req.actor,
                        "updated_at": event_ts,
                    }
                }
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
                "event_type": "REMARK_CHANGE",
                "product_variant_id": req.product_variant_id,
                "image_index": req.image_index,
                "old_remark": old_remark,
                "new_remark": req.remark,
                "actor": req.actor,
            },
        )

    transaction = fs.transaction()
    update_in_transaction(transaction, doc_ref)

    return JSONResponse(
        content={"status": "ok", "event_id": event_id},
        headers={"Cache-Control": "no-store"}
    )

@router.get("/me/role", response_model=RoleResponse)
def get_role(email: str):
    fs = get_fs_client()
    if not fs:
        return RoleResponse(email=email, role="viewer")
    role = _resolve_role(fs, email)
    return RoleResponse(email=email, role=role, exists=(role != "viewer"))


def _resolve_role(fs, email: str) -> str:
    """
    Resolve role for an email. Checks qc_users first (source of truth for assignments),
    then falls back to Reviewers collection. Returns 'admin' | 'reviewer' | 'viewer'.
    """
    try:
        # 1. Check qc_users (preferred)
        doc = fs.collection('qc_users').document(email).get()
        if doc.exists:
            data = doc.to_dict() or {}
            r = data.get("role", "viewer")
            active = data.get("active", True)
            if not active:
                return "viewer"  # deactivated users become viewers
            if r in ("admin", "reviewer"):
                return r
    except Exception as e:
        logger.warning("qc_users role lookup failed for %s: %s", email, e)

    try:
        # 2. Fallback: Reviewers collection (legacy)
        doc = fs.collection('Reviewers').document(email).get()
        if doc.exists:
            data = doc.to_dict() or {}
            r = data.get("role", "viewer")
            if r in ("admin", "reviewer"):
                return r
    except Exception as e:
        logger.warning("Reviewers fallback role lookup failed for %s: %s", email, e)

    return "viewer"


def _get_reviewer_assigned_pvids(fs, email: str) -> Optional[List[str]]:
    """
    Returns today's assigned PVID list for a reviewer, or None if no assignment doc exists.
    """
    try:
        today = _today_ist()
        doc = fs.collection("qc_assignments").document(today).get()
        if not doc.exists:
            return None
        data = doc.to_dict() or {}
        assignments = data.get("assignments") or {}
        return assignments.get(email, [])
    except Exception as e:
        logger.warning("Could not load assignments for reviewer %s: %s", email, e)
        return None


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


# ============================================================
# PVID ASSIGNMENT SYSTEM
# ============================================================

# --- Assignment Models ---

class ReviewerSummary(BaseModel):
    email: str
    assigned_total: int
    reviewed_count: int
    pending_count: int

class AssignmentSummaryResponse(BaseModel):
    date: str
    reviewers: List[ReviewerSummary]

class PvidAssignmentDetail(BaseModel):
    product_variant_id: str
    pvid_review_status: str
    reviewed_images: int
    total_images: int
    last_updated_at: Optional[datetime] = None
    last_updated_by: Optional[str] = None

class AssignmentDetailsResponse(BaseModel):
    reviewer_email: str
    pvids: List[PvidAssignmentDetail]

class AssignmentMapResponse(BaseModel):
    date: str
    assignments: Dict[str, List[str]]

class RegenerateRequest(BaseModel):
    force: bool = False


# --- Assignment Helper ---

IST = ZoneInfo("Asia/Kolkata")

MAX_PER_REVIEWER = 100


def _today_ist() -> str:
    """Return today's date in IST as YYYY-MM-DD."""
    return datetime.now(IST).strftime("%Y-%m-%d")


def _load_reviewers(fs) -> List[str]:
    """
    Load active reviewers from qc_users where role == 'reviewer' and active == True.
    Falls back to Reviewers collection if qc_users is empty.
    """
    emails: List[str] = []
    try:
        docs = fs.collection("qc_users").where("role", "==", "reviewer").where("active", "==", True).stream()
        emails = [doc.id for doc in docs]
    except Exception as e:
        logger.warning("qc_users query failed, trying Reviewers fallback: %s", e)

    if not emails:
        # Fallback: read Reviewers collection
        try:
            docs = fs.collection("Reviewers").stream()
            for doc in docs:
                data = doc.to_dict() or {}
                if data.get("role") == "reviewer" and data.get("active", True):
                    emails.append(doc.id)
        except Exception as e:
            logger.error("Reviewers fallback also failed: %s", e)

    return sorted(emails)  # deterministic order


def _fetch_not_reviewed_pvids(bq, fs) -> List[Dict[str, Any]]:
    """
    Fetch all NOT_REVIEWED PVIDs from BigQuery, then filter by Firestore state.
    Returns list of dicts with keys: product_variant_id, created_date_bucket_label
    sorted by (created_date_bucket_label, product_variant_id).
    """
    table_id = get_bq_table_id("qc_image_source")
    query = f"""
        SELECT
            product_variant_id,
            COALESCE(created_date_bucket_label, 'More than 30 Days') AS created_date_bucket_label
        FROM `{table_id}`
        GROUP BY 1, 2
        ORDER BY created_date_bucket_label, product_variant_id
    """
    try:
        rows = [dict(r) for r in bq.query(query).result()]
    except Exception as e:
        logger.error("BQ fetch for assignment failed: %s", e)
        raise HTTPException(status_code=500, detail=f"BQ query failed: {e}")

    if not rows:
        return []

    all_pvids = [r["product_variant_id"] for r in rows]

    # Batch-read Firestore status (qc_current_state keyed by pvid)
    reviewed_pvids: set = set()
    if fs:
        BATCH = 500  # Firestore get_all supports up to 10 MB / ~500 docs safely
        for i in range(0, len(all_pvids), BATCH):
            batch_pvids = all_pvids[i:i + BATCH]
            refs = [fs.collection("qc_current_state").document(p) for p in batch_pvids]
            try:
                docs = fs.get_all(refs)
                for doc in docs:
                    if not doc.exists:
                        continue
                    data = doc.to_dict() or {}
                    images_map = data.get("images") or {}
                    # PVID is REVIEWED only if ALL its images have review_status == REVIEWED
                    # and it has at least one image
                    if not images_map:
                        continue
                    all_img_reviewed = all(
                        (img_data or {}).get("review_status") == "REVIEWED"
                        for img_data in images_map.values()
                        if isinstance(img_data, dict)
                    )
                    if all_img_reviewed:
                        reviewed_pvids.add(doc.id)
            except Exception as e:
                logger.warning("Firestore batch read failed in assignment fetch: %s", e)

    # Keep only NOT_REVIEWED PVIDs
    not_reviewed = [r for r in rows if r["product_variant_id"] not in reviewed_pvids]
    return not_reviewed


def ensure_today_assignments(fs, bq, force: bool = False) -> Dict[str, Any]:
    """
    Idempotent: returns existing assignments for today, or creates them.
    If force=True, delete existing and regenerate.
    """
    today = _today_ist()
    assign_ref = fs.collection("qc_assignments").document(today)

    if not force:
        existing = assign_ref.get()
        if existing.exists:
            logger.info("Returning existing assignments for %s", today)
            return existing.to_dict()

    # Load reviewers
    reviewers = _load_reviewers(fs)
    if not reviewers:
        raise HTTPException(status_code=400, detail="No active reviewers found in qc_users or Reviewers collection.")

    reviewer_count = len(reviewers)

    # Fetch NOT_REVIEWED PVIDs sorted deterministically
    not_reviewed_rows = _fetch_not_reviewed_pvids(bq, fs)
    total_available = len(not_reviewed_rows)

    # Compute per-reviewer slice size
    if total_available == 0:
        assign_per_reviewer = 0
    elif total_available < reviewer_count * MAX_PER_REVIEWER:
        assign_per_reviewer = math.floor(total_available / reviewer_count)
    else:
        assign_per_reviewer = MAX_PER_REVIEWER

    # Slice sequentially — no duplicates guaranteed
    assignments: Dict[str, List[str]] = {}
    pvid_list = [r["product_variant_id"] for r in not_reviewed_rows]
    for i, email in enumerate(reviewers):
        start = i * assign_per_reviewer
        end = start + assign_per_reviewer
        assignments[email] = pvid_list[start:end]

    total_assigned = sum(len(v) for v in assignments.values())

    doc_data = {
        "date": today,
        "created_at": datetime.utcnow(),
        "created_by": "system",
        "reviewers": reviewers,
        "assignments": assignments,
    }

    assign_ref.set(doc_data)

    logger.info(
        "ASSIGNMENT_CREATED date=%s reviewer_count=%d pvids_assigned=%d assign_per_reviewer=%d",
        today, reviewer_count, total_assigned, assign_per_reviewer
    )

    return doc_data


def _compute_pvid_status_from_fs(fs, pvids: List[str]) -> Dict[str, Dict[str, Any]]:
    """
    Batch-read qc_current_state for given pvid list.
    Returns dict keyed by pvid with keys: pvid_review_status, reviewed_images,
    total_images, last_updated_at, last_updated_by.
    """
    result: Dict[str, Dict[str, Any]] = {}
    if not pvids or not fs:
        return result

    BATCH = 500
    for i in range(0, len(pvids), BATCH):
        batch = pvids[i:i + BATCH]
        refs = [fs.collection("qc_current_state").document(p) for p in batch]
        try:
            docs = fs.get_all(refs)
            for doc in docs:
                pvid = doc.id
                if not doc.exists:
                    result[pvid] = {
                        "pvid_review_status": "NOT_REVIEWED",
                        "reviewed_images": 0,
                        "total_images": 0,
                        "last_updated_at": None,
                        "last_updated_by": None,
                    }
                    continue
                data = doc.to_dict() or {}
                images_map = data.get("images") or {}
                total = 0
                reviewed = 0
                last_ts = None
                last_by = None
                for img_data in images_map.values():
                    if not isinstance(img_data, dict):
                        continue
                    total += 1
                    if img_data.get("review_status") == "REVIEWED":
                        reviewed += 1
                    ts = img_data.get("updated_at")
                    if ts and (last_ts is None or ts > last_ts):
                        last_ts = ts
                        last_by = img_data.get("updated_by")
                result[pvid] = {
                    "pvid_review_status": "REVIEWED" if (total > 0 and reviewed == total) else "NOT_REVIEWED",
                    "reviewed_images": reviewed,
                    "total_images": total,
                    "last_updated_at": last_ts,
                    "last_updated_by": last_by,
                }
        except Exception as e:
            logger.warning("Firestore batch read failed in status compute: %s", e)

    # Ensure every requested pvid has an entry
    for p in pvids:
        if p not in result:
            result[p] = {
                "pvid_review_status": "NOT_REVIEWED",
                "reviewed_images": 0,
                "total_images": 0,
                "last_updated_at": None,
                "last_updated_by": None,
            }
    return result


# --- Admin Endpoints ---

@router.get("/admin/assignments/today", response_model=AssignmentSummaryResponse)
def get_assignments_today():
    """
    Returns today's assignment summary with per-reviewer reviewed/pending counts.
    Creates assignments if they don't exist yet.
    """
    fs = get_fs_client()
    if not fs:
        raise HTTPException(status_code=503, detail="Firestore not configured.")
    bq = get_bq_client()

    doc_data = ensure_today_assignments(fs, bq)
    assignments: Dict[str, List[str]] = doc_data.get("assignments", {})

    # Collect all PVIDs in one batch read
    all_pvids = list({p for pvids in assignments.values() for p in pvids})
    status_map = _compute_pvid_status_from_fs(fs, all_pvids)

    reviewer_summaries: List[ReviewerSummary] = []
    for email in doc_data.get("reviewers", []):
        pvids = assignments.get(email, [])
        reviewed = sum(1 for p in pvids if status_map.get(p, {}).get("pvid_review_status") == "REVIEWED")
        reviewer_summaries.append(ReviewerSummary(
            email=email,
            assigned_total=len(pvids),
            reviewed_count=reviewed,
            pending_count=len(pvids) - reviewed,
        ))

    logger.info("assignment summary generated for date=%s reviewers=%d", doc_data["date"], len(reviewer_summaries))
    return AssignmentSummaryResponse(date=doc_data["date"], reviewers=reviewer_summaries)


@router.get("/admin/assignments/details", response_model=AssignmentDetailsResponse)
def get_assignment_details(reviewer_email: Optional[str] = Query(None)):
    """
    Returns per-PVID detail for one reviewer (or all if reviewer_email omitted).
    """
    fs = get_fs_client()
    if not fs:
        raise HTTPException(status_code=503, detail="Firestore not configured.")
    bq = get_bq_client()

    doc_data = ensure_today_assignments(fs, bq)
    assignments: Dict[str, List[str]] = doc_data.get("assignments", {})

    if reviewer_email:
        if reviewer_email not in assignments:
            raise HTTPException(status_code=404, detail=f"Reviewer '{reviewer_email}' has no assignments today.")
        pvids = assignments[reviewer_email]
        label = reviewer_email
    else:
        # All reviewers merged (admin overview)
        pvids = [p for pvlist in assignments.values() for p in pvlist]
        label = "all"

    status_map = _compute_pvid_status_from_fs(fs, pvids)

    details = [
        PvidAssignmentDetail(
            product_variant_id=pvid,
            pvid_review_status=status_map[pvid]["pvid_review_status"],
            reviewed_images=status_map[pvid]["reviewed_images"],
            total_images=status_map[pvid]["total_images"],
            last_updated_at=status_map[pvid]["last_updated_at"],
            last_updated_by=status_map[pvid]["last_updated_by"],
        )
        for pvid in pvids
    ]

    logger.info("assignment details generated reviewer_email=%s pvids=%d", label, len(details))
    return AssignmentDetailsResponse(reviewer_email=label, pvids=details)


@router.get("/admin/assignments/map", response_model=AssignmentMapResponse)
def get_assignment_map():
    """
    Returns the raw assignments map for today.
    """
    fs = get_fs_client()
    if not fs:
        raise HTTPException(status_code=503, detail="Firestore not configured.")
    bq = get_bq_client()

    doc_data = ensure_today_assignments(fs, bq)
    return AssignmentMapResponse(
        date=doc_data["date"],
        assignments=doc_data.get("assignments", {}),
    )


@router.post("/admin/assignments/regenerate")
def regenerate_assignments(req: RegenerateRequest):
    """
    Delete and regenerate today's assignments. Requires force=True.
    """
    if not req.force:
        raise HTTPException(status_code=400, detail="Set force=true to regenerate assignments.")

    fs = get_fs_client()
    if not fs:
        raise HTTPException(status_code=503, detail="Firestore not configured.")
    bq = get_bq_client()

    today = _today_ist()
    # Delete existing doc first
    try:
        fs.collection("qc_assignments").document(today).delete()
        logger.info("Deleted existing assignment doc for %s", today)
    except Exception as e:
        logger.warning("Could not delete existing assignment doc: %s", e)

    doc_data = ensure_today_assignments(fs, bq, force=True)
    total = sum(len(v) for v in doc_data.get("assignments", {}).values())
    return {
        "status": "regenerated",
        "date": today,
        "reviewers": doc_data.get("reviewers", []),
        "total_pvids_assigned": total,
    }


app.include_router(router)
