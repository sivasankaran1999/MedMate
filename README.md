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
| **Data** | **Firestore** (per-elder schedule + users) | GCP ✓                 |
| **Frontend** | **Next.js** (web, mic + camera) | —                    |

- **Voice + vision + barge-in** in one session; **per-elder** morning/afternoon/night schedule.
- All mandatory tech: Gemini, Live API, Google Cloud (Cloud Run + Firestore + Vertex AI).
- **Database:** Firestore stores **elders** (schedule + time windows) and **users** (sign-in → elder). See **[docs/firestore-schema.md](./docs/firestore-schema.md)** for the full schema and hackathon alignment.

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
- Sign-in: `POST http://localhost:8080/auth/login` (body: `{ "email", "password" }`)
- Schedule: `GET/PUT http://localhost:8080/elders/{id}/schedule`
- Live session: `ws://localhost:8080/ws?elder_id=...`

### 2. Frontend

```bash
cd frontend
cp .env.example .env.local
# Edit .env.local and set: NEXT_PUBLIC_BACKEND_URL=http://localhost:8080
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Allow microphone and camera when prompted. Choose "Demo Elder", click **Start session**, then **Start microphone** to talk, or **Show pill or bottle** to send a camera image.

### 3. Seed database (Firestore)

Create Firestore in your GCP project first (Native mode, e.g. `us-central1`). Then from the repo root:

```bash
export GOOGLE_CLOUD_PROJECT=your-gcp-project-id
export PYTHONPATH=backend

# Elders: medication schedule + time windows (morning/afternoon/night)
python scripts/seed_elder.py [elder_id]

# Users: sign-in (email/password → elder_id). Run after seed_elder.
python scripts/seed_user.py [email] [password]
```

- Default elder: `elder-demo` with sample morning/night meds and time windows (e.g. night 8–11 PM).
- Default user: `demo@medmate.local` / `medmate123` → links to `elder-demo`. Use these to sign in at [http://localhost:3000](http://localhost:3000).

Full schema (elders + users): **[docs/firestore-schema.md](./docs/firestore-schema.md)**.

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
