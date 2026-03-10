# MedMate — Tech Stack

Tech stack chosen to **meet all hackathon requirements** and support a **winning demo**: voice + vision + barge-in, per-elder schedule, and clear GCP proof.

---

## Hackathon requirements → How we meet them

| Requirement | How we meet it |
|-------------|----------------|
| **Gemini model** | Vertex AI Gemini (Live API) for reasoning + vision. |
| **Gemini Live API or ADK** | **Vertex AI Gemini Live API** (multimodal) — real-time voice, barge-in, image in same session. |
| **Google GenAI SDK or ADK** | **Google Cloud Vertex AI SDK** (e.g. `google-cloud-aiplatform` / Python or Node) to call Live API. |
| **At least one Google Cloud service** | **Three:** Cloud Run, Firestore, Vertex AI (Live API). |
| **Backend hosted on GCP** | Backend runs on **Cloud Run**; judges see deployment + logs. |

---

## Stack overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  FRONTEND (Web)                                                          │
│  Next.js or React + TypeScript                                          │
│  • Mic → capture audio stream                                            │
│  • Camera → capture image when user taps "Show pill"                     │
│  • WebSocket or fetch → talk to our backend (no direct Gemini from UI)  │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ HTTPS / WebSocket
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  BACKEND (Google Cloud)                                                   │
│  Cloud Run (Node.js or Python)                                           │
│  • Proxies audio + image to Vertex AI Live API                           │
│  • Loads elder schedule from Firestore → injects into system prompt      │
│  • Optional: calls FDA/drug API for pill grounding (tool)               │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         │                      │                      │
         ▼                      ▼                      ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ Vertex AI       │   │ Firestore       │   │ (Optional)      │
│ Gemini Live API │   │ • Per-elder     │   │ FDA/Drug API    │
│ (multimodal)    │   │   schedule      │   │ for pill ID      │
│ Voice + vision  │   │   morning/      │   │ grounding        │
│ Barge-in        │   │   afternoon/    │   │                 │
│                 │   │   night         │   │                 │
└─────────────────┘   └─────────────────┘   └─────────────────┘
```

---

## 1. Frontend

| Choice | Role |
|--------|------|
| **Next.js** (or **React**) + **TypeScript** | Web app that works on phone/tablet; single codebase, easy to demo in browser. |
| **Web Audio API** | Capture microphone → send audio chunks to backend. |
| **getUserMedia** | Camera access; capture still image (e.g. JPEG) when user taps **Show pill**. |
| **WebSocket or streaming fetch** | Send audio stream + images to backend; receive audio stream back. |

**Why web first:** No app-store delay; judges can open a URL. Responsive so it works on mobile.

**Alternative:** Flutter or React Native if you want a native app later; for hackathon, web is enough.

---

## 2. Backend (Google Cloud)

| Service | Role |
|---------|------|
| **Cloud Run** | Hosts the backend service. Receives audio + images from frontend, holds **one WebSocket connection per session** to Vertex AI Live API, injects elder context into system prompt, streams responses back. Proves “backend on GCP.” |
| **Language** | **Python** (recommended) — `google-cloud-aiplatform` and Vertex AI Live API docs use Python. Or **Node.js** if you prefer. |

**Responsibilities:**
- Start Live API session with **system prompt** (MedMate persona + instructions to use schedule and identify pills).
- When a session starts, load **this elder’s schedule** from Firestore and add it to the prompt (e.g. “Morning: Lisinopril, Vitamin D; Night: Metformin, Aspirin”).
- Forward **audio** from client → Vertex; forward **images** (when user shows pill/bottle) → Vertex.
- Stream **audio** and optional **transcript** back to client.
- Barge-in is handled by **Vertex AI Live API** (native); backend just forwards user audio.

---

## 3. Gemini / AI (Vertex AI)

| Component | Role |
|-----------|------|
| **Vertex AI Gemini Live API** (multimodal) | Real-time voice in/out, **image in same session**, **barge-in**, low latency. |
| **Model** | e.g. `gemini-2.0-flash-exp` or the Live API model that supports multimodal (e.g. **gemini-live-2.5-flash-native-audio** or current equivalent with vision). Use the model that supports both **audio and image** in one Live session. |
| **System prompt** | MedMate persona (calm, short sentences, simple words) + rules: use elder’s schedule for “what do I take morning/afternoon/night?” and “is this the right pill?”; when user sends image, identify pill/bottle and match to schedule; if wrong time, say so and state what to take now. |

**Docs:** [Vertex AI Live API](https://cloud.google.com/vertex-ai/generative-ai/docs/live-api) — supports audio + image in same session, session memory, voice interruption.

---

## 4. Data (Google Cloud)

| Service | Role |
|---------|------|
| **Firestore** | Per-elder data: **schedule** (morning / afternoon / night meds — name, strength, optional time). Optional: display name, preferred language. Keyed by a stable **elder ID** (e.g. from simple sign-in or anonymous link). |

**Minimal schema (example):**
- `elders/{elderId}` → `{ displayName?, schedule: { morning: [...], afternoon: [...], night: [...] } }`
- Each med entry: `{ name, strength?, form? }` (e.g. `{ name: "Lisinopril", strength: "10 mg" }`).

This gives “the agent knows what I take in morning/afternoon/night” and “is this the right pill for now?”

---

## 5. Optional (for stronger technical score)

| Item | Role |
|------|------|
| **FDA or drug API** | Backend calls a drug API (e.g. by imprint or name) and gives result to the model as a **tool** so pill identification is grounded — reduces hallucinations. |
| **Automated deployment** | Script or IaC (e.g. `gcloud run deploy` script, or Terraform) in the repo → bonus points. |
| **Firebase Hosting** | Serve frontend from GCP (optional); or keep frontend on same Cloud Run with static files. |

---

## 6. What we do *not* need

- **Separate “pill ID” microservice:** Gemini vision in the Live API session is enough; optional drug API is for grounding only.
- **WebRTC for voice:** Backend can use WebSocket to Vertex; client sends audio chunks to backend. Simpler than full WebRTC for the demo.

---

## 7. Checklist vs hackathon rules

- [x] **Gemini model** — Vertex AI Gemini (Live).
- [x] **Gemini Live API** — Used via Vertex AI (real-time voice + vision, barge-in).
- [x] **Google Cloud** — Cloud Run (backend), Firestore (data), Vertex AI (Live API).
- [x] **Backend on GCP** — Cloud Run; proof via console or deploy script.
- [x] **GenAI SDK** — Vertex AI SDK (Python/Node) to call Live API.

---

## 8. Suggested repo structure (high level)

```
medmate/
├── frontend/          # Next.js or React app (mic, camera, UI)
├── backend/           # Cloud Run service (Python or Node)
│   ├── main.py        # WebSocket/server, session start, proxy to Vertex
│   ├── firestore.py   # Load/save elder schedule
│   └── Dockerfile
├── docs/              # Architecture diagram (for submission)
├── scripts/           # deploy.sh or similar (GCP deploy)
├── PROJECT_BRIEF.md
├── TECH_STACK.md
└── README.md          # Spin-up instructions for judges
```

---

*This stack is chosen to meet all [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/) requirements and support a winning MedMate demo.*
