# Image QC Full Stack Application

A full-stack application (Next.js + FastAPI) for Image QC processes, using BigQuery for source data and Firestore for writing review states.

## Architecture

- **Frontend**: Next.js 14 (App Router), Tailwind CSS. Located in `/frontend`.
- **Backend**: FastAPI (Python). Located in `/backend`.
- **Database**: 
  - `BigQuery` (Read-only source of images).
  - `Firestore` (Read/Write for review status, remarks, event logs, and user roles).

## Setup & Development

### Prerequisites
- Python 3.9+
- Node.js 18+
- Google Cloud Service Account (JSON) with:
  - BigQuery Data Viewer
  - Cloud Datastore User

### Environment Variables

Create a `.env` in `frontend/` (for local dev of frontend) and export vars for backend.

**Backend Required Vars**:
```bash
export BQ_PROJECT="temporary-471207"
export BQ_DATASET="image_qc"
export FIRESTORE_PROJECT="temporary-471207"
export GCP_SA_JSON='{...full json string...}'
export CORS_ORIGINS="http://localhost:3000"
```

**Frontend Required Vars** (`frontend/.env.local`):
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### Running Locally

1. **Start Backend**:
   ```bash
   cd backend
   pip install -r requirements.txt
   uvicorn api.index:app --reload --port 8000
   ```
   Backend runs at http://localhost:8000 (Swagger UI at /docs).

2. **Start Frontend**:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Frontend runs at http://localhost:3000.

## Deployment (Vercel)

The project is configured as a monorepo in `vercel.json`.

1. **Push to GitHub/GitLab**.
2. **Import into Vercel**.
3. **Set Environment Variables** in Vercel Project Settings:
   - `GCP_SA_JSON`
   - `BQ_PROJECT`
   - `BQ_DATASET`
   - `FIRESTORE_PROJECT`
   - `NEXT_PUBLIC_API_URL` (Set to `/api` alias for relative calls in production, or the full domain `https://your-app.vercel.app`)

   *Note*: In Vercel, if `NEXT_PUBLIC_API_URL` is empty, you might need to handle absolute URLs or use `/api` if on same domain. For this code, `NEXT_PUBLIC_API_URL` defaults to `http://localhost:8000` but you should set it to empty string or `/` in prod to use relative paths if routing allows, or the full Vercel URL.

## Authentication (MVP)

- Users enter email on first screen.
- Roles are checked against Firestore `user_roles` collection.
- Default role: `viewer`. 
- To make a user `reviewer` or `admin`, add a document to `user_roles` collection:
  - ID: `email@example.com`
  - Field: `role` = `reviewer`

## Design Decisions

- **Sync Strategy**: Images are fetched from BigQuery. Status is merged from Firestore in realtime.
- **Filtering**: 'Reviewed' status filter queries Firestore first. 'Not Reviewed' relies on BigQuery scan + merge (might return <100 items per page).
- **Optimistic UI**: Frontend acts immediately on Toggle/Remark and reverts on failure.
