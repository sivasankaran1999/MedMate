# MedMate Backend

Cloud Run service that proxies to Vertex AI Gemini Live API and reads elder schedules from Firestore.

## Environment

- **GOOGLE_CLOUD_PROJECT** (required in production): GCP project ID.
- **GOOGLE_APPLICATION_CREDENTIALS** (optional for local): Path to service account JSON key. On Cloud Run, the default compute service account is used.

## Run locally

```bash
cd backend
pip install -r requirements.txt
export GOOGLE_CLOUD_PROJECT=your-project-id
# Optional, for Firestore/Vertex from your machine:
# export GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
uvicorn main:app --reload --port 8080
```

- Health: http://localhost:8080/health
- WebSocket (placeholder): ws://localhost:8080/ws

## Seed a test elder

From repo root (with `GOOGLE_CLOUD_PROJECT` and optionally `GOOGLE_APPLICATION_CREDENTIALS` set):

```bash
python scripts/seed_elder.py [elder_id]
```

Default elder ID is `elder-demo`. Creates one document in Firestore `elders` with sample morning/night meds.

## Deploy

From repo root:

```bash
./scripts/deploy.sh YOUR_PROJECT_ID
```

See [scripts/](../scripts/) for deployment automation.
