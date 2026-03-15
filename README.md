# MedMate for Elders

Voice-first, vision-aware AI companion for elders: talk naturally, show pill or bottle anytime, interrupt anytime. Built for the [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/).


**Hackathon:** Gemini model, GenAI SDK, and Google Cloud (Vertex AI, Firestore, Cloud Run). Deployment automation: **[scripts/](scripts/)** and **[backend/Dockerfile](backend/Dockerfile)**.

**Demo video:** [Watch MedMate in action](https://drive.google.com/file/d/1nDe46qEv9pxeGdGZLNTqVltdyY-c-6Eb/view) (Google Drive)

## Hackathon Requirements Compliance

MedMate satisfies all requirements of the [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/):

- **Gemini model:** Vertex AI Gemini Live API (real-time voice + vision)
- **GenAI SDK:** Used for session summarization and model interactions
- **Google Cloud services:**
  - Cloud Run (backend hosting)
  - Firestore (user and medication schedule storage)
  - Vertex AI (Gemini Live multimodal model)

The backend is deployed on Google Cloud Run and uses Vertex AI Gemini Live for real-time voice and vision interaction.


## Project context

See **[PROJECT_BRIEF.md](./PROJECT_BRIEF.md)** for full idea, tech requirements, and submission checklist.

## Tech stack

See **[TECH_STACK.md](./TECH_STACK.md)** and **[docs/architecture.md](./docs/architecture.md)** for detail and diagrams.

| Layer     | Choice                          | Hackathon requirement   |
|----------|----------------------------------|--------------------------|
| **AI**   | Vertex AI **Gemini Live API** + **GenAI SDK** (summarization) | Gemini model ✓ · GenAI SDK ✓ |
| **Backend** | **Cloud Run** (Python)       | GCP ✓                    |
| **Data** | **Firestore** (per-elder schedule + users) | Google Cloud ✓        |
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

## Reproducible testing

Anyone can verify MedMate with the same steps. Use either **local** (backend + frontend on your machine) or **deployed** (Cloud Run backend + frontend pointing to it).

### Prerequisites

- Backend running (local: `uvicorn main:app --port 8080` in `backend/` with `GOOGLE_CLOUD_PROJECT` set; or use your Cloud Run URL).
- Frontend running (local: `npm run dev` in `frontend/` with `NEXT_PUBLIC_BACKEND_URL` set to backend URL).
- At least one elder and one user seeded (e.g. `python scripts/seed_elder.py elder-demo` then `python scripts/seed_user.py demo@example.com yourpassword`).

### Steps to reproduce

1. **Open the app**  
   Go to the frontend URL (e.g. [http://localhost:3000](http://localhost:3000) or your deployed URL). Use HTTPS in production so mic/camera work.

2. **Sign in**  
   Log in with the seeded user (e.g. `demo@example.com` / `yourpassword`).

3. **Optional: set caretaker email**  
   Go to **Settings** → **Emergency & pharmacist contacts** → enter a caretaker name and email → **Save contacts**. (Required only if you want to verify session-summary email.)

4. **Start a session**  
   Click **Start session**, then **Start microphone**. Allow mic (and camera if testing “Show pill”).

5. **Voice**  
   Say something (e.g. “What do I take in the morning?”). Confirm the agent replies by voice.

6. **Show pill (optional)**  
   Click **Show pill or bottle**, allow camera, hold a pill or bottle in frame. Confirm the agent identifies or comments on it.

7. **Barge-in (optional)**  
   While the agent is speaking, interrupt with a new question. Confirm the agent stops and responds to the new input.

8. **End session**  
   Click **End session**. Confirm the UI shows “Summarizing…” then a summary (and, if caretaker email was set and SMTP is configured, that the caretaker receives the email).

9. **Schedule**  
   In **Settings** → **My medications**, confirm the elder’s morning/afternoon/night schedule is visible and editable.

These steps are deterministic given the same seed data and backend configuration; judges or reviewers can run them to reproduce behavior.

---

## Deploy (Cloud Run + optional frontend)

**Automated deployment:** scripts live in **[scripts/](scripts/)**. For the hackathon “Automating Cloud Deployment” bonus, you can submit a link to that folder (e.g. `https://github.com/YOUR_ORG/medmate/tree/main/scripts`).

### Backend to Cloud Run

From the repo root:

```bash
./scripts/deploy.sh YOUR_GCP_PROJECT_ID
```

This sets the project, builds the backend from `backend/` with Cloud Build, and deploys to Cloud Run with `GOOGLE_CLOUD_PROJECT` set. Note the Cloud Run URL (e.g. `https://medmate-backend-xxx.run.app`).

**Caretaker emails:** The backend only sends session-summary and dose-notification emails when **SMTP is configured**. If the caretaker is not receiving emails, set these environment variables on your Cloud Run service:

1. In [Cloud Console](https://console.cloud.google.com/) go to **Cloud Run** → your service (e.g. `medmate-backend`) → **Edit & deploy new revision**.
2. Open the **Variables and secrets** tab and add:

   | Name | Value |
   |-----|--------|
   | `SMTP_HOST` | e.g. `smtp.gmail.com` |
   | `SMTP_PORT` | `587` |
   | `SMTP_USER` | Your sending email (e.g. Gmail address) |
   | `SMTP_PASSWORD` | App password (for Gmail: [create one](https://myaccount.google.com/apppasswords)) |
   | `FROM_EMAIL` | Same as `SMTP_USER` or your desired “From” address |

3. Deploy the new revision. After that, session summaries and dose notifications will be emailed to the elder’s emergency contact.

Without these variables, the backend logs “SMTP not configured; skipping email” and does not send mail.

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
├── docs/              # Architecture diagram, Firestore schema, setup guide
├── scripts/           # deploy.sh, seed_elder.py, seed_user.py
├── PROJECT_BRIEF.md
├── TECH_STACK.md
├── PLAN.md
└── README.md          # This file
```

## License

MIT (or add a LICENSE file for your preferred license).
