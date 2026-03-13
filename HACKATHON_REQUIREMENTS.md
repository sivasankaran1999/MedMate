# Hackathon Requirements — MedMate Compliance

This document shows how MedMate satisfies the mandatory hackathon criteria.

---

## 1. Leverage a Gemini model ✓

We use **Gemini** in two places:

| Use | Model | Where |
|-----|--------|------|
| **Voice + vision agent** | `gemini-2.0-flash-live-preview-04-09` (Vertex AI Live API) | `backend/live_session.py` — real-time voice, barge-in, and camera/pill identification |
| **Session summarization** | `gemini-2.5-flash` / `gemini-2.0-flash-001` (Vertex AI) | `backend/main.py` — `_summarize_transcript_for_caretaker()` |

Both are Gemini models served via **Vertex AI** (Google Cloud).

---

## 2. Agents built with Google GenAI SDK or ADK ✓

- **Google GenAI SDK** is used for the **session-summary agent** in `backend/main.py`:
  - `from google import genai`
  - `genai.Client(vertexai=True, project=..., location=...)`
  - `client.models.generate_content(model=model_id, contents=prompt)` for summarization (see `_summarize_transcript_for_caretaker()`).
- **Voice agent** is the **Vertex AI Gemini Live API** (BidiGenerateContent over WebSocket), which is the official Gemini Live API for real-time, multimodal agents. The backend proxies to it in `backend/live_session.py` and injects the MedMate system prompt and elder schedule.

**Dependency:** `google-genai>=1.0.0` in `backend/requirements.txt`.

---

## 3. Use at least one Google Cloud service ✓

We use **multiple** Google Cloud services:

| Service | Use |
|--------|-----|
| **Vertex AI** | Gemini Live API (voice agent) and Gemini for session summarization |
| **Firestore** | Elders (schedule, time windows, contacts) and users (auth, elder_id). See `backend/firestore_client.py`. |
| **Cloud Run** (optional) | Backend is deployable to Cloud Run; see backend README and Cloud Run config. |

Firestore and Vertex AI are used in every run (local and deployed).

---

## Summary

| Requirement | Status | Where |
|-------------|--------|--------|
| Leverage a Gemini model | ✓ | `live_session.py` (Live), `main.py` (summarization) |
| GenAI SDK or ADK for agents | ✓ | GenAI SDK in `main.py`; Live API in `live_session.py` |
| At least one Google Cloud service | ✓ | Vertex AI, Firestore (and optionally Cloud Run) |

---

## Proof of Google Cloud Deployment

Judges accept **either** (1) a short screen recording of the app running on GCP (e.g. Cloud Run console/logs) **or** (2) **links to code files** that show Google Cloud services and APIs in use. MedMate satisfies **option (2)** with the following files in this repo:

### Vertex AI (Google Cloud) — API calls

| File | What it shows |
|------|----------------|
| **[backend/live_session.py](backend/live_session.py)** | **Vertex AI Gemini Live API:** WebSocket connection to `us-central1-aiplatform.googleapis.com`, path `LlmBidiService/BidiGenerateContent`, model URI `projects/…/locations/us-central1/publishers/google/models/gemini-2.0-flash-live-preview-04-09`. See lines 19–21 (constants), 209–211 (URL + model_uri), 249 (`websockets.connect` to Vertex). |
| **[backend/main.py](backend/main.py)** | **Vertex AI GenerateContent:** (1) **GenAI SDK** — `genai.Client(vertexai=True, ...)` and `client.models.generate_content(...)` (lines 504–509). (2) **Vertex REST** — direct HTTPS calls to `{location}-aiplatform.googleapis.com/…/models/{model}:generateContent` (lines 535–547). |

### Firestore (Google Cloud) — client and usage

| File | What it shows |
|------|----------------|
| **[backend/firestore_client.py](backend/firestore_client.py)** | **Firestore client:** `from google.cloud import firestore`, `firestore.Client(project=project)`, and Firestore API usage: `db.collection("elders").document(...).get()`, `.set()`, `db.collection("users")` (lines 19–31, 36–42, 62–78). |
| **[backend/main.py](backend/main.py)** | **Firestore in use:** Imports and calls `get_elder`, `get_elder_schedule`, `set_elder_schedule`, `get_user_by_email`, `create_user`, `record_dose_confirmation` from `firestore_client` (lines 28–34); used in auth, schedule, session-summary, and live-session flows. |

**For submission:** You can point judges to this document and/or link directly to the files above (e.g. `https://github.com/YOUR_ORG/MedMate/blob/main/backend/live_session.py`).

**Optional (option 1):** If you deploy the backend to **Cloud Run**, you can instead (or in addition) submit a short screen recording showing the Cloud Run service running in the GCP Console and/or logs showing requests to Vertex and Firestore.

---

## Bonus: Automating Cloud Deployment (max 0.2)

We provide **automated deployment** via scripts and a container definition. For the bonus, submit a link to this section of the repo:

| Link | What it demonstrates |
|------|----------------------|
| **[scripts/](scripts/)** | Deployment scripts: **[scripts/deploy.sh](scripts/deploy.sh)** — sets GCP project, runs `gcloud run deploy ... --source .` (Cloud Build builds from `backend/`), sets `GOOGLE_CLOUD_PROJECT`, deploys to Cloud Run in one command. **[scripts/deploy-frontend.sh](scripts/deploy-frontend.sh)** — deploys frontend to Vercel. |
| **[backend/Dockerfile](backend/Dockerfile)** | Container definition for the backend: Python 3.11, install deps, run uvicorn on port 8080; used when Cloud Run builds from source. |

**Submission link for judges:**  
`https://github.com/YOUR_ORG/MedMate/tree/main/scripts`  
(or the same path in your actual repo). Optionally also link to `backend/Dockerfile` for the image build.
