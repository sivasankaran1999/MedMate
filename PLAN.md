# MedMate — Plan (for Cursor Plan mode)

**Use this document in Cursor Plan mode so the AI has full project context.** Copy the whole file or paste sections as needed.

---

## 1. What MedMate Is

- **One-line pitch:** Voice-first, vision-aware AI companion for elders: talk naturally, show pill or bottle anytime, interrupt anytime. Built with Gemini Live API on Google Cloud.
- **Hackathon:** [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/) — **Deadline: March 16, 2026 @ 5:00 PM PDT.** Category: **Live Agents.**

---

## 2. Problem & Solution

- **Problem:** Existing tools are either scan-then-read (no live conversation) or voice-only (no “show pill”). Elders can’t have one conversation where they ask “What do I take in the morning?”, show a pill, then say “Wait, what about the blue one?” and show another.
- **Solution:** MedMate = **one live session**: voice in/out + show pill or bottle **anytime** + **barge-in** (interrupt mid-response). Plus **per-elder schedule**: agent knows what this elder takes in morning, afternoon, and night.

---

## 3. Must-Have Features (for winning demo)

1. **Voice in / voice out** — Elder talks naturally; agent replies by voice.
2. **Vision** — Elder can show a **pill** or **bottle** (camera); agent sees and explains. **Either pill OR bottle is enough** (no need to show both).
3. **Barge-in** — Elder can interrupt mid-response (e.g. “Wait, what about the blue one?”); agent stops and responds to the new input.
4. **Distinct persona** — Calm, clear, patient, simple language, short sentences.
5. **Per-elder customization** — Agent knows **this** elder’s schedule: what they take in **morning**, **afternoon**, and **night**. Answers “What do I take in the morning?” and “Is this my morning pill?” using stored schedule.
6. **Wrong-pill handling** — If elder shows a **night** pill in the **morning** (or wrong time), agent says what the pill is, that it’s for another time, and what to take **now**.
7. **Backend on Google Cloud** — Prove in demo (Cloud Run + Firestore + Vertex AI).
8. **Prod-level frontend** — Polished, accessible UI that looks and feels production-ready (see **§5b Frontend quality** below).

---

## 4. How It Works (user flow)

- Elder opens web app → starts session (optionally logs in so we have their schedule).
- **Voice:** Elder speaks → agent responds by voice.
- **Vision:** Elder taps “Show pill” and holds up **pill** or **bottle** → agent identifies it (pill: shape, color, **imprint** = letters/numbers on pill; bottle: label) and matches to **this elder’s** schedule.
- **Barge-in:** Elder interrupts → agent stops and answers the new question (and can accept a new image).
- **Identification:** Either **bottle** (read label) OR **pill** (imprint + shape + color) is enough; no need to show both.
- **Correct vs wrong time:** Agent uses current time + stored schedule to say “Yes, that’s your morning pill” or “That’s your night pill; this morning take X and Y.”

---

## 5. Tech Stack (mandatory for hackathon)

| Layer      | Technology              | Purpose |
|-----------|--------------------------|--------|
| **Frontend** | Next.js or React (TypeScript) | Web app: mic, camera (“Show pill”), WebSocket/stream to backend. **Must be prod-level** (see §5b). |
| **Backend**  | **Cloud Run** (Python or Node) | Proxies audio + images to Vertex AI Live API; loads elder schedule from Firestore; injects into system prompt. |
| **AI**       | **Vertex AI Gemini Live API** (multimodal) | Real-time voice + image in **same session**, barge-in. |
| **Data**     | **Firestore** | Per-elder schedule: morning / afternoon / night meds (name, strength). Keyed by elder ID. |

- **Hackathon requirements:** Gemini model ✓, Gemini Live API ✓, Google Cloud (Cloud Run + Firestore + Vertex AI) ✓, backend on GCP ✓.
- **Detailed stack & diagram:** See `TECH_STACK.md`.

---

### 5b. Frontend quality (prod-level)

The frontend must look and feel **production-ready**, not a prototype. When building, apply:

- **Visual design**
  - Cohesive design system: typography, spacing, colors, and components feel intentional and consistent.
  - Calm, trustworthy aesthetic (e.g. soft colors, clear hierarchy) suited to elders and healthcare.
  - No placeholder “lorem” or obvious dev-only UI; every screen is fit for demo and judges.
- **Accessibility & elder-friendly UX**
  - Large, readable text and touch targets (e.g. min 44px tap areas); sufficient contrast (WCAG AA where feasible).
  - Clear labels and states: mic on/off, “Show pill” button, connection status, speaking/listening.
  - Simple, minimal navigation; primary actions (start session, show pill, mute) obvious and easy to find.
- **Responsiveness**
  - Works on phone and tablet (primary) and desktop; layout and controls adapt without breaking.
- **States & feedback**
  - Loading states (e.g. “Connecting…”, “Listening…”) and clear errors (e.g. “Couldn’t connect — check your mic” or “Camera not available”) with simple recovery.
  - Visual feedback when recording (mic active) and when “Show pill” captures an image (e.g. thumbnail or “Sent”).
- **Performance & polish**
  - No janky layout shifts; smooth transitions where used; assets optimized so the app feels snappy.

---

## 6. Architecture (one sentence)

**Client (browser)** → **Cloud Run backend** (loads schedule from Firestore, injects into prompt) → **Vertex AI Gemini Live API** (voice + vision, barge-in); backend streams audio back to client.

---

## 7. Implementation Phases

Each phase has **What we build** (Cursor/code) and **What you do** (your steps: Google account, API keys, database, deploy, etc.). Complete "What you do" before or right after each phase’s build.

---

### Phase 1: Foundation & repo structure

**What we build:**
- Repo structure: `frontend/`, `backend/`, `docs/`, `scripts/`
- Root files: `README.md` (placeholder), `.gitignore`, any root config
- Placeholder or minimal app in `frontend/` and `backend/` so the structure runs

**What you do (from your end):**
- [ ] **Google account:** Use a Google account (Gmail) for Google Cloud.
- [ ] **Create a GCP project:** Go to [Google Cloud Console](https://console.cloud.google.com/) → Create project (e.g. `medmate-hackathon`) → note the **Project ID**.
- [ ] **Billing:** Attach a billing account (required for Vertex AI / Cloud Run). Use [free trial](https://cloud.google.com/free) ($300 for 90 days) if eligible, or request [hackathon credits](https://forms.gle/rKNPXA1o6XADvQGb7) (by Mar 13, 12:00 PM PT).
- [ ] **Install gcloud CLI** (optional now, needed for deploy): [Install Google Cloud CLI](https://cloud.google.com/sdk/docs/install) and run `gcloud auth login` and `gcloud config set project YOUR_PROJECT_ID`.

---

### Phase 2: GCP APIs & backend skeleton

**What we build:**
- Backend service (Python or Node) in `backend/` with:
  - HTTP/WebSocket server (e.g. FastAPI or Express)
  - Dockerfile and Cloud Run config (e.g. `scripts/deploy.sh` or similar)
  - Env placeholders: `GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS` (or use default service account when deployed)

**What you do (from your end):**
- [ ] **Enable APIs** in Cloud Console for your project:
  - [Vertex AI API](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com)
  - [Cloud Run API](https://console.cloud.google.com/apis/library/run.googleapis.com)
  - [Firestore API](https://console.cloud.google.com/apis/library/firestore.googleapis.com)
- [ ] **Create a service account** for the backend: IAM & Admin → Service Accounts → Create (e.g. `medmate-backend`). Grant roles: **Vertex AI User**, **Cloud Run Invoker** (if needed), **Firestore** (e.g. Cloud Datastore User or custom Firestore role).
- [ ] **Download JSON key:** Create key (JSON) for that service account and save it somewhere safe (e.g. `backend/service-account.json` — add this path to `.gitignore` so it’s never committed).
- [ ] **Local testing:** Set `GOOGLE_APPLICATION_CREDENTIALS` to the path of that JSON file when running the backend locally.

---

### Phase 3: Database (Firestore) for users & schedules

**What we build:**
- Firestore schema: e.g. collection `elders` (or `users`) with document ID = elder ID; each doc has `schedule: { morning: [...], afternoon: [...], night: [...] }` and optional `displayName`, `language`.
- Backend code to **read** an elder’s schedule by ID and **write**/update schedule (e.g. admin endpoint or script to seed one elder for demo).
- Optional: seed script or small admin UI to add a test elder with morning/afternoon/night meds.

**What you do (from your end):**
- [ ] **Create Firestore database** (if not already): Firestore → Create database → choose **Native mode**, pick a region (e.g. `us-central1`), start in **production** or test mode as you prefer.
- [ ] **Create collections/documents:** Either let the app create them on first write, or manually create one document under `elders` with a test elder ID and a sample `schedule` (e.g. morning: Lisinopril 10 mg, Vitamin D; night: Metformin 500 mg, Aspirin 81 mg).
- [ ] **Security rules (optional for demo):** For production you’d restrict read/write by auth; for hackathon demo you can start with rules that allow read/write for your project (then tighten later).

---

### Phase 4: Backend — Vertex AI Live API integration

**What we build:**
- Backend logic to open a **Live API session** with Vertex AI (WebSocket or SDK), send **system prompt** (MedMate persona + instructions to use elder schedule and identify pills; wrong-time handling).
- Load elder schedule from Firestore at session start and inject into the system prompt.
- Forward **audio** from client to Vertex and **images** (when user taps “Show pill”) to Vertex; stream **audio** (and optional transcript) back to client.
- Health/readiness endpoint for Cloud Run.

**What you do (from your end):**
- [ ] **Confirm Vertex AI API** is enabled and **service account** has **Vertex AI User** (or equivalent) so the backend can call the Live API.
- [ ] **Credentials:** For **local** runs: keep using `GOOGLE_APPLICATION_CREDENTIALS` pointing to the service account JSON. For **Cloud Run**: deploy with the same service account (or default compute SA with Vertex AI User); no key file needed in production.
- [ ] **Test backend locally:** Start backend, call session endpoint with a test elder ID; confirm no permission errors. Optionally test with a simple client or curl/Postman first.
- [ ] **Deploy backend to Cloud Run:** Run the deploy script (e.g. `./scripts/deploy.sh`) or `gcloud run deploy ...` — see Phase 6. Set env vars in Cloud Run: `GOOGLE_CLOUD_PROJECT`, and optionally elder-related config.

---

### Phase 5: Frontend (voice + “Show pill” + prod-level UI)

**What we build:**
- Next.js (or React) app in `frontend/` with **prod-level look and feel** (see **§5b Frontend quality**):
  - **Core behavior:** Mic capture (Web Audio API), “Show pill” button that captures one camera image (getUserMedia), UI to start session and show connection state. Send audio stream and image(s) to backend; receive and play audio back (and optional transcript).
  - **Design:** Cohesive design system (typography, spacing, colors); calm, trustworthy aesthetic for elders; no placeholder or dev-only UI.
  - **Accessibility & UX:** Large text and touch targets (min ~44px), clear labels (mic on/off, “Show pill”, connection status), simple navigation, primary actions obvious.
  - **Responsive:** Works on phone/tablet first, then desktop; layout adapts.
  - **States & feedback:** Loading (“Connecting…”, “Listening…”), clear error messages with recovery, visual feedback for mic active and “Show pill” capture.
  - **Polish:** No layout shift, smooth transitions, optimized assets.
- Optional: simple “elder ID” or sign-in so backend can load the right schedule (for demo, a dropdown or hardcoded test ID is fine).

**What you do (from your end):**
- [ ] **Environment variables:** In `frontend/.env.local` (or equivalent) set `NEXT_PUBLIC_BACKEND_URL=http://localhost:PORT` for local dev (replace PORT with your backend port). For production, set this to your Cloud Run backend URL (e.g. `https://your-service-xxx.run.app`).
- [ ] **Run frontend:** `cd frontend && npm install && npm run dev`. Open in browser; allow mic and camera when prompted.
- [ ] **Test locally:** Backend running locally + frontend pointing to it; do a short voice + “Show pill” test. For production, use HTTPS (e.g. Vercel or Cloud Run for frontend) so mic/camera work in modern browsers.

---

### Phase 6: Deploy, integration & demo prep

**What we build:**
- **Automated Cloud Deployment (for bonus, max 0.2):** Scripts or infrastructure-as-code that automate deployment so judges can **link to a specific section of the repo**. Put all deployment automation in one place, e.g.:
  - **`scripts/`** — e.g. `deploy.sh` (or `deploy-backend.sh` / `deploy-frontend.sh`) that build and deploy backend to Cloud Run (and optionally frontend to Firebase Hosting / Vercel) using `gcloud` and/or `firebase`. Or
  - **`infra/`** — Terraform / Pulumi / Cloud Build config that provisions and deploys (Cloud Run, env vars, etc.).
  - **README** must mention where the automated deployment code lives so you can submit a link (e.g. `https://github.com/YOUR_ORG/medmate/tree/main/scripts` or `.../infra`).
- **Deploy script(s)** in `scripts/`: build + deploy backend (and optionally frontend); idempotent where possible (set project, enable APIs, deploy service).
- **README** with spin-up instructions for judges: how to run locally (backend + frontend), env vars, and how to run the deploy script(s).
- **Architecture diagram** in `docs/` (e.g. Mermaid or image): Client ↔ Cloud Run ↔ Vertex AI Live API; Cloud Run ↔ Firestore.

**What you do (from your end):**
- [ ] **Deploy backend:** Run the deploy script or `gcloud run deploy`; note the **Cloud Run URL**. Ensure env vars (e.g. `GOOGLE_CLOUD_PROJECT`) are set in Cloud Run.
- [ ] **Deploy frontend:** Deploy `frontend/` to Vercel, Firebase Hosting, or Cloud Run (static). Set `NEXT_PUBLIC_BACKEND_URL` to the Cloud Run URL. If you use a custom domain, update CORS on the backend if required.
- [ ] **Proof of GCP deployment:** Record a short clip showing Cloud Console (Cloud Run service, Firestore, or logs) or a link to the backend code that uses GCP — for submission.
- [ ] **End-to-end test:** Open the live frontend URL, start a session, speak, tap “Show pill,” interrupt once; confirm schedule and wrong-pill behavior if implemented.
- [ ] **Demo video:** Record <4 min (English): problem, solution, quick architecture, show pill once, one interruption, real software. Upload to YouTube/unlisted and add link to Devpost.
- [ ] **Submit:** Public repo (README + spin-up), architecture diagram, demo video link, GCP proof. **Bonus:** If you implemented automated deployment, submit the **link to that code** (e.g. `scripts/` or `infra/`) for the Automating Cloud Deployment bonus (max 0.2). Optional: GDG profile, blog/video with #GeminiLiveAgentChallenge.

---

## 8. Submission checklist (hackathon)

- [ ] Public repo with **README** (spin-up / run instructions).
- [ ] **Proof of GCP deployment** — Short recording or code link showing backend on Google Cloud.
- [ ] **Architecture diagram** — Gemini ↔ backend ↔ DB ↔ frontend (add to repo/docs).
- [ ] **Demo video** (<4 min, English): real software, show pill/bottle once, one interruption, problem + solution + architecture.
- [ ] **Optional — Bonus (max 0.2): Automating Cloud Deployment** — Provide a **link to the section of your code** that demonstrates automated deployment (scripts or infrastructure-as-code). Put deployment automation in `scripts/` (e.g. `deploy.sh`, `deploy-backend.sh`) and/or `infra/` (Terraform, Pulumi, Cloud Build); document the link in the README or submission form (e.g. `https://github.com/YOUR_ORG/medmate/tree/main/scripts`).
- [ ] Optional: GDG profile, blog/video with #GeminiLiveAgentChallenge.

**Bonus — Automating Cloud Deployment (max 0.2):** *“Provide a link to the section of your code that demonstrates you have automated the deployment process using scripts or infrastructure-as-code tools.”* → Use **`scripts/`** (and/or **`infra/`**) for all deploy automation and submit that folder link (e.g. `https://github.com/YOUR_ORG/medmate/tree/main/scripts`).

---

## 9. Judging (reminder)

- **40%** Innovation & Multimodal UX — Voice + vision + barge-in + persona.
- **30%** Technical — GenAI SDK, GCP, robust logic, error handling, grounding.
- **30%** Demo — Real software, clear architecture, GCP proof, clear problem/solution.

---

## 10. Cost

- **$0 for hackathon** if you use: (1) **Hackathon GCP credits** (request by Mar 13, 12:00 PM PT: https://forms.gle/rKNPXA1o6XADvQGb7), and/or (2) **Google Cloud free trial** ($300 for 90 days for new accounts), and (3) **Free tiers** (Firestore, Cloud Run). See `COST.md` for details.

---

## 11. Repo structure (target)

```
medmate/
├── frontend/          # Next.js or React (mic, camera, UI)
├── backend/           # Cloud Run (Python or Node): Live API proxy, Firestore
├── docs/              # Architecture diagram for submission
├── scripts/           # deploy.sh or IaC for GCP
├── PROJECT_BRIEF.md
├── TECH_STACK.md
├── COST.md
├── PLAN.md            # This file — use in Cursor Plan mode
└── README.md          # Spin-up instructions for judges
```

---

## 12. Key docs in this repo

- **PROJECT_BRIEF.md** — Pitch, must-haves, mandatory tech, submission checklist, differentiators.
- **TECH_STACK.md** — Full stack, diagram, per-component detail, repo structure.
- **COST.md** — Whether it costs anything; credits, trial, free tiers.
- **PLAN.md** — This file; idea + tech stack in one place for Cursor Plan mode.

---

*Paste this file (or its sections) into Cursor Plan mode so the AI has the full MedMate idea and tech stack when helping you build.*
