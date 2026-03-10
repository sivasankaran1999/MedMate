# MedMate for Elders

Voice-first, vision-aware AI companion for elders: talk naturally, show pill or bottle anytime, interrupt anytime. Built for the [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/).

## Project context

See **[PROJECT_BRIEF.md](./PROJECT_BRIEF.md)** for full idea, tech requirements, and submission checklist.

## Tech stack

See **[TECH_STACK.md](./TECH_STACK.md)** and **[docs/architecture.md](./docs/architecture.md)** for detail and diagrams.

| Layer     | Choice                          | Hackathon requirement   |
|----------|----------------------------------|--------------------------|
| **AI**   | Vertex AI **Gemini Live API**   | Gemini model + Live API ✓ |
| **Backend** | **Cloud Run** (Python)       | GCP ✓                    |
| **Data** | **Firestore** (per-elder schedule) | GCP ✓                 |
| **Frontend** | **Next.js** (web, mic + camera) | —                    |

- **Voice + vision + barge-in** in one session; **per-elder** morning/afternoon/night schedule.
- All mandatory tech: Gemini, Live API, Google Cloud (Cloud Run + Firestore + Vertex AI).

---

## Spin-up (run locally)

### Prerequisites

- **Node.js** 20+ and **npm**
- **Python** 3.11+
- **Google Cloud project** with billing, and:
  - Vertex AI API, Cloud Run API, Firestore API enabled
  - For **local auth**, use one of:
    - **Option A (no key file):** [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials) — run `gcloud auth application-default login` (works when your org blocks service account key creation).
    - **Option B:** A service account with **Vertex AI User** and **Cloud Datastore User** roles, and its JSON key at `backend/service-account.json` (do not commit; in `.gitignore`).

### 1. Backend

**If your org blocks service account keys**, use Application Default Credentials (no key file):

```bash
gcloud auth application-default login
gcloud config set project YOUR_GCP_PROJECT_ID
cd backend
pip install -r requirements.txt
export GOOGLE_CLOUD_PROJECT=YOUR_GCP_PROJECT_ID
# Do NOT set GOOGLE_APPLICATION_CREDENTIALS — ADC from gcloud will be used
uvicorn main:app --reload --port 8080
```

**If you have a service account JSON key** (e.g. personal project or key allowed):

```bash
cd backend
pip install -r requirements.txt
export GOOGLE_CLOUD_PROJECT=your-gcp-project-id
export GOOGLE_APPLICATION_CREDENTIALS="$PWD/service-account.json"
uvicorn main:app --reload --port 8080
```

- Health: [http://localhost:8080/health](http://localhost:8080/health)
- Schedule API: `GET/PUT http://localhost:8080/elders/{id}/schedule`
- Live session: `ws://localhost:8080/ws?elder_id=elder-demo`

### 2. Frontend

```bash
cd frontend
cp .env.example .env.local
# Edit .env.local and set: NEXT_PUBLIC_BACKEND_URL=http://localhost:8080
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Allow microphone and camera when prompted. Choose "Demo Elder", click **Start session**, then **Start microphone** to talk, or **Show pill or bottle** to send a camera image.

### 3. Seed a test elder (optional)

From the repo root, with `GOOGLE_CLOUD_PROJECT` and `GOOGLE_APPLICATION_CREDENTIALS` set:

```bash
python scripts/seed_elder.py [elder_id]
```

Default `elder_id` is `elder-demo`. This creates one document in Firestore `elders` with sample morning/night meds. Ensure Firestore is created (Native mode, e.g. `us-central1`) in your project first.

---

## Deploy (Cloud Run + optional frontend)

**Automated deployment:** scripts live in **[scripts/](scripts/)**. For the hackathon “Automating Cloud Deployment” bonus, you can submit a link to that folder (e.g. `https://github.com/YOUR_ORG/medmate/tree/main/scripts`).

### Backend to Cloud Run

From the repo root:

```bash
./scripts/deploy.sh YOUR_GCP_PROJECT_ID
```

This sets the project, builds the backend from `backend/` with Cloud Build, and deploys to Cloud Run with `GOOGLE_CLOUD_PROJECT` set. Note the Cloud Run URL (e.g. `https://medmate-backend-xxx.run.app`).

### Frontend (production)

Deploy the frontend to **Vercel**, **Firebase Hosting**, or static hosting. Set the env var:

- `NEXT_PUBLIC_BACKEND_URL=https://your-cloud-run-url.run.app`

Use **HTTPS** in production so microphone and camera work in modern browsers.

---

## Repo structure

```
medmate/
├── frontend/          # Next.js (mic, camera, Live session UI)
├── backend/           # Cloud Run: Live API proxy, Firestore
├── docs/              # Architecture diagram, Firestore schema
├── scripts/           # deploy.sh, seed_elder.py
├── PROJECT_BRIEF.md
├── TECH_STACK.md
├── COST.md
├── PLAN.md
└── README.md          # This file
```

## License

TBD
