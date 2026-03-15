# MedMate — Complete Technical Architecture (for Professional Diagram)

Exhaustive technical extraction for building a judge-ready architecture diagram. No summarization; every technical detail is included.

---

## 1. PRODUCT OVERVIEW

**What the product does (1–2 sentences):**  
MedMate is a voice-first, vision-aware medication companion for older adults. Users talk naturally to MedMate (and optionally show pills/bottles via camera); the agent answers “what do I take now?”, confirms pill identity from imprints, follows strict time-window and 1-hour grace rules, and at session end sends a summarized email to the family caregiver—with optional nearby-pharmacy suggestions when the user mentions running out of tablets.

**Core value proposition:**  
- **Live conversation + barge-in:** Real-time voice in/out with Gemini Live API; user can interrupt anytime.  
- **Schedule-aware timing:** Morning/afternoon/night slots with configurable time windows; inside window = take as usual; within 1 hour after window end = “late but take ASAP”; more than 1 hour past = do not take, wait for next dose.  
- **Pill identification (vision):** User shows pill or bottle via still image or live video; agent guides until imprint/label is readable, identifies drug from imprint, compares to schedule, and warns if wrong time slot.  
- **Caregiver loop:** Every session can be summarized by Vertex AI and emailed to the emergency contact; dose confirmations (taken/not taken) also trigger optional email; refill flow can attach top nearby pharmacies (Overpass/OSM) to the summary.  
- **No RAG/vector DB:** All “knowledge” is the elder’s schedule and time windows from Firestore plus the fixed MedMate system prompt; no ingestion pipeline, no embeddings, no retrieval.

---

## 2. TECH STACK (exact versions)

### Frontend

| Item | Source | Exact value |
|------|--------|-------------|
| **Framework** | `frontend/package.json` | Next.js `^15.0.0` |
| **React** | `frontend/package.json` | `^19.0.0` |
| **react-dom** | `frontend/package.json` | `^19.0.0` |
| **TypeScript** | `frontend/package.json` (devDependencies) | `^5.0.0` |
| **Node types** | `frontend/package.json` | `@types/node` `^22.0.0` |
| **React types** | `frontend/package.json` | `@types/react` `^19.0.0`, `@types/react-dom` `^19.0.0` |
| **Lint** | `frontend/package.json` | `eslint` `^9.0.0`, `eslint-config-next` `^15.0.0` |
| **Styles** | `frontend/package.json` | `postcss` `^8.0.0`, `tailwindcss` `^3.4.0` |
| **UI** | Codebase | No component library; custom React + Tailwind only. Single page: `app/page.tsx`; layout `app/layout.tsx`; fonts: Outfit + JetBrains Mono (`layout.tsx`). |
| **Audio** | Codebase | Web Audio API: `AudioContext` (16 kHz capture, 24 kHz playback), `AudioWorkletNode` with custom worklets: `public/audio-processors/capture.worklet.js`, `public/audio-processors/playback.worklet.js`. Fallback: `ScriptProcessorNode` if AudioWorklet unavailable. |
| **Media** | Codebase | `navigator.mediaDevices.getUserMedia` for mic and camera (still image + optional live video feed ~1 FPS). |
| **State** | Codebase | React `useState` / `useCallback` / `useRef`; session auth in `sessionStorage` keys: `medmate_elder_id`, `medmate_display_name`. |

### Backend

| Item | Source | Exact value |
|------|--------|-------------|
| **Language** | `backend/Dockerfile` | Python 3.11 (`python:3.11-slim`) |
| **Framework** | `backend/requirements.txt` | FastAPI `>=0.109.0` |
| **ASGI server** | `backend/requirements.txt` | uvicorn `[standard]` `>=0.27.0` |
| **Firestore** | `backend/requirements.txt` | `google-cloud-firestore` `>=2.16.0` |
| **Auth (GCP)** | `backend/requirements.txt` | `google-auth` `>=2.27.0` |
| **Vertex / GenAI** | `backend/requirements.txt` | `google-genai` `>=1.0.0` |
| **WebSockets** | `backend/requirements.txt` | `websockets` `>=13.0` |
| **SSL/certs** | `backend/requirements.txt` | `certifi` `>=2024.0.0` |
| **Env** | `backend/requirements.txt` | `python-dotenv` `>=1.0.0` |
| **Entry** | `backend/main.py` | `app = FastAPI(...)`; no separate `asgi.py`. Run: `uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}`. |

### Database

| Item | Source | Exact value |
|------|--------|-------------|
| **Name** | Docs + code | Google Cloud **Firestore** (Native mode). No version string in code; use Firestore API as per `google-cloud-firestore` SDK. |
| **ORM / Migrations** | None | No ORM; no migration runner. Schema is document-based; see `docs/firestore-schema.md`. |
| **Collections** | `backend/firestore_client.py`, `docs/firestore-schema.md` | `elders` (document ID = elder_id), `users` (document ID = normalized lowercase email). |
| **Extensions** | None | No vector DB, no full-text search extension; plain Firestore only. |

### AI / ML (Gemini only)

| Use case | Model (exact string) | Where defined |
|----------|----------------------|---------------|
| **Live voice + vision** | `gemini-2.0-flash-live-preview-04-09` | `backend/live_session.py` → `LIVE_MODEL` |
| **Session summary (try order)** | 1) `gemini-2.5-flash` 2) `gemini-2.5-flash-lite` 3) `gemini-2.0-flash-001` 4) `gemini-2.0-flash-lite-001` | `backend/main.py` → `_summarize_transcript_for_caretaker()`: `sdk_models` and `rest_models` tuples |

**Embedding models:** None. No RAG, no embeddings, no vector store.

### Other APIs and services

| Service | Purpose | Where |
|---------|---------|--------|
| **Overpass API** | Nearby pharmacies (amenity=pharmacy) by lat/lng/radius | `backend/main.py` → `_fetch_nearby_pharmacies()`; URL: `https://overpass-api.de/api/interpreter?data=...` |
| **Vertex AI REST** | Generate Content (session summary) when SDK path fails | `backend/main.py`; URL pattern: `https://{location}-aiplatform.googleapis.com/{v1beta1|v1}/projects/.../locations/.../publishers/google/models/{model_id}:generateContent` |
| **Vertex AI Live API** | Bidirectional WebSocket for live voice + vision | `backend/live_session.py`; `wss://us-central1-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent` |
| **SMTP** | Optional: session summary email + dose notification email | `backend/main.py` → `_send_email()`, `_send_dose_notification_email()`; env: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `FROM_EMAIL` |
| **Browser Geolocation** | User location for nearby pharmacies | Frontend: `navigator.geolocation.getCurrentPosition`; backend only receives lat/lng via GET `/api/nearby-pharmacies` |
| **External pharmacy links** | Refill/checkout URLs (no API calls) | Frontend: `getRefillCheckoutUrl()` and agent prompt in `live_session.py`: CVS, Walgreens, Rite Aid, Walmart, Kroger, Target, Costco, else Google search. Google Maps URLs built from lat/lon or query string. |

---

## 3. ALL AI FLOWS & PIPELINES

There are **two** AI flows only: (1) Live session (Gemini Live API), (2) Session summary (Vertex Generate Content). No ingestion, no RAG, no other pipelines.

### Pipeline 1: Live voice + vision session (Gemini Live API)

**Trigger:** User clicks “Start session” (or equivalent) with `elder_id` in session; frontend opens WebSocket to backend `/ws?elder_id=<id>&timezone=<optional>`.

**Steps (backend: `live_session.run_live_proxy`):**

1. **Validate:** Backend accepts WebSocket; if `elder_id` query param missing → send JSON `{ "error": "elder_id query param required" }`, close with code 4000.
2. **Load schedule:** Call `get_elder_schedule(elder_id)` (Firestore). On exception → send `{ "error": "Could not load schedule: ..." }`, close 4000.
3. **Auth:** `get_access_token()` (Google ADC). On failure → send `{ "error": "Auth failed: ..." }`, close 4010.
4. **Build system instruction:** `build_system_instruction(schedule, user_timezone)`:
   - Format schedule (morning/afternoon/night meds + time windows).
   - Format current time and time-window rules (user’s local date/time from `user_timezone` or UTC).
   - Prepend full `MEDMATE_PERSONA` (persona, transcript rule, language matching, tablet timing, pill identification, imprint/both-sides, refill/pharmacy instructions, mandatory questions, end-session flow).
5. **Connect to Vertex:** WSS to `us-central1-aiplatform.googleapis.com` + `LIVE_API_PATH`, headers `Authorization: Bearer <token>`, `Content-Type: application/json`.
6. **Send setup message:** JSON with `setup.model` = `projects/{project}/locations/us-central1/publishers/google/models/gemini-2.0-flash-live-preview-04-09`, `setup.system_instruction.parts[].text` = system instruction, `input_audio_transcription.language_codes` = `["en"]`, `output_audio_transcription` = `{}`, `generation_config.response_modalities` = `["AUDIO"]`, temperature 0.9, voice `Puck`, `realtime_input_config.automatic_activity_detection` (silence_duration_ms 2000, prefix_padding_ms 500).
7. **First-turn trigger:** After `setupComplete` event from Vertex (or timeout 10s), send synthetic user turn: `"User connected. Transcribe the user's speech in the exact same language they speak—English only when they speak English; no Hindi or Tamil when they speak English."` so the model speaks a short greeting first.
8. **Proxy loop:** Two concurrent tasks:
   - **Vertex → client:** Read messages from Vertex WebSocket; if binary frame, decode UTF-8 and parse JSON; forward entire JSON to client (so client gets `serverContent`, `modelTurn` with audio, `turnComplete`, `interrupted`, transcript fields). Handle both `serverContent` and `server_content`, `modelTurn` and `model_turn`, `inlineData` and `inline_data`.
   - **Client → Vertex:** Read from client WebSocket; if text, parse JSON and skip if it contains `service_url`/`bearer_token`/`setup`; else forward text as-is to Vertex. If bytes, forward bytes to Vertex.
9. **On any exception in proxy:** Send `{ "error": "<message>" }` to client, close with code 4010.

**Decision points / conditionals:**

- No `elder_id` → close with error.
- Schedule load fails → close with error.
- Token refresh fails → close with error.
- Setup complete → send first-turn trigger (with 10s timeout).
- Client can send `realtime_input` (audio PCM base64, or image/jpeg base64) and/or `client_content` (e.g. user text + `turn_complete: true`). Backend does not interpret; it only forwards.

**Guardrails / validation:** None in backend for content; all guardrails are in the **system prompt** (tablet timing rules, imprint-only identification, both sides for pill, language matching, mandatory questions before end). No server-side content filters or PII stripping.

**Fallback:** None. If Vertex Live connection fails, session ends with error.

---

### Pipeline 2: Session summary (Vertex Generate Content)

**Trigger:** User ends session; frontend calls `POST /elders/{elder_id}/session-summary` with body `{ transcript: [{ role, text }], refill?: { slot, reason, top_pharmacies } }`. Backend has already disconnected the WebSocket before this (frontend calls disconnect then POST).

**Steps (backend: `session_summary` → `_summarize_transcript_for_caretaker`):**

1. **Load elder:** `get_elder(elder_id)`. If None → 404. Extract `displayName`, `emergencyContact` (caretaker email/name).
2. **Prepare transcript text:** From `body.transcript`, build one string: each line either `"MedMate: <text>"` or `"User: <text>"` (by role). If empty → `"No conversation."`.
3. **Check project:** `GOOGLE_CLOUD_PROJECT` must be set; else raise `VertexSummaryError` (then 503).
4. **Prompt:** Fixed string: “Summarize this conversation between an elderly user and a medication assistant (MedMate) for a family caretaker. Be concise. Include: What was discussed (medications, doses, timing); Whether any doses were taken or missed; Any concerns or follow-ups mentioned. Keep the summary to a short paragraph. Conversation: <conversation>”.
5. **Try Google GenAI SDK (Vertex):**  
   - `genai.Client(vertexai=True, project=project, location=location)` where `location = GOOGLE_CLOUD_LOCATION` or `us-central1`.  
   - For each model in order `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.0-flash-001`, `gemini-2.0-flash-lite-001`: call `client.models.generate_content(model=model_id, contents=prompt)`.  
   - Extract text via `_extract_text(response)` (handles both SDK response shape and `response.candidates[0].content.parts[0].text`).  
   - If non-empty text returned → use it and exit.  
   - On exception or empty → set `last_error`, try next model.
6. **If SDK path failed (ImportError or all 4 models failed):** Try Vertex REST.  
   - Get token: `google.auth.default()` then refresh if not valid.  
   - For each API version `v1beta1`, `v1` and each model in same order:  
     - POST to `https://{location}-aiplatform.googleapis.com/{api_ver}/projects/.../locations/.../publishers/google/models/{model_id}:generateContent`  
     - Body: `contents: [{ role: "user", parts: [{ text: prompt }] }]`, `generationConfig: { maxOutputTokens: 1024, temperature: 0.3 }`  
     - Timeout 45s.  
     - If response has `error` → set `last_error`, continue.  
     - Else parse `candidates[0].content.parts[0].text`; if non-empty → return it.  
   - On HTTPError or other exception → set `last_error`, continue.
7. **If all attempts failed:** Raise `VertexSummaryError(last_error or "Vertex AI summarization failed...")` → endpoint returns **503** with `detail` = message.
8. **Back in `session_summary`:** Build `display_summary` = summary + optional refill block (refill alert + reason + top 3 pharmacies with name, distance, address, Maps URL). If caretaker email present → `_send_email(caretaker_email, subject, body_text)` (SMTP; no-op if SMTP not configured). Return `{ summary: display_summary, sent_to: caretaker_email or null }`.

**Decision points / conditionals:**

- Elder not found → 404.
- Project unset → 503.
- SDK available and one model returns text → use that text.
- SDK fails or no text → try REST with v1beta1 then v1, each with 4 models.
- Any model returns text → use it.
- All fail → 503, no fallback summary text.
- Caretaker email set and SMTP configured → send email; else `sent_to` null.

**Guardrails / validation:** None beyond prompt design (concise, caretaker-focused). No output filters.

**Fallback:** No alternative provider; no “summary unavailable” placeholder. Client sees 503 and error message.

---

## 4. GEMINI-SPECIFIC USAGE

### Models (exact strings)

| Model ID | Used for | File |
|----------|----------|------|
| `gemini-2.0-flash-live-preview-04-09` | Live voice + vision session (real-time, barge-in, audio in/out, image in same session) | `backend/live_session.py` |
| `gemini-2.5-flash` | Session summary (first try via SDK) | `backend/main.py` |
| `gemini-2.5-flash-lite` | Session summary (second try) | `backend/main.py` |
| `gemini-2.0-flash-001` | Session summary (third try) | `backend/main.py` |
| `gemini-2.0-flash-lite-001` | Session summary (fourth try) | `backend/main.py` |

### What each Gemini model is used for

- **gemini-2.0-flash-live-preview-04-09:**  
  - Real-time bidirectional conversation: user speech (and optional images) in; model speech (and optional text transcript) out.  
  - Handles “what do I take now?” using schedule + current time + time-window rules.  
  - Pill/bottle identification from camera: guide user until imprint/label readable, then identify drug and compare to schedule; never identify by shape/color only; require both sides for pill.  
  - Refill flow: tell user to use in-app “Refill: nearby pharmacies” and to select slot and open pharmacy links.  
  - Mandatory before end: ask about new symptoms and enough tablets; on “I want to end session” either say goodbye (if already asked) or ask missing questions then goodbye.  
  - Language: reply in same language as user’s last message (English/Hindi/Tamil etc.).  
  - First message: brief greeting only (no “what to take now?” immediately).

- **gemini-2.5-flash / gemini-2.5-flash-lite / gemini-2.0-flash-001 / gemini-2.0-flash-lite-001:**  
  - Single non-streaming call per session end: summarize transcript for caretaker (medications, doses taken/missed, concerns). No voice, no vision, no tools.

### Gemini-specific features used

| Feature | Where | Details |
|--------|--------|---------|
| **Live API (bidirectional WebSocket)** | `live_session.py` | `BidiGenerateContent`; single long-lived WebSocket; setup then streaming `realtime_input` and `client_content`; receive `serverContent.modelTurn` (audio), `turnComplete`, transcript, `interrupted`. |
| **System instruction** | `live_session.py` | Injected in setup: full MedMate persona + schedule + time windows + current time + tablet timing rules + pill ID rules (imprint, both sides, no guess). |
| **Response modality AUDIO** | `live_session.py` | `generation_config.response_modalities: ["AUDIO"]`; model responds with speech; client plays 24 kHz PCM. |
| **Prebuilt voice** | `live_session.py` | `speech_config.voice_config.prebuilt_voice_config.voice_name: "Puck"`. |
| **Input audio transcription** | `live_session.py` | `input_audio_transcription.language_codes: ["en"]` (hint for user speech). |
| **Output audio transcription** | `live_session.py` | `output_audio_transcription: {}` for on-screen transcript. |
| **Realtime input / automatic activity detection** | `live_session.py` | `realtime_input_config.automatic_activity_detection`: disabled false, silence_duration_ms 2000, prefix_padding_ms 500. |
| **Multimodal in same session** | `live_session.py` | Same session accepts audio (PCM) and image (JPEG base64) via `realtime_input.media_chunks`; model can “see” pill/bottle and answer. |
| **Barge-in / interruption** | Handled by Vertex | Backend only forwards client messages; Vertex handles turn-taking and `interrupted`; frontend on `interrupted` can send a short instruction so model says “Sorry, I heard noise…” then waits. |
| **Generate Content (non-Live)** | `main.py` | REST and SDK: single request/response for summary; no streaming, no tools. |
| **Vertex AI only** | Everywhere | No Gemini API key; all calls go through Vertex (same GCP project). Region: Live = `us-central1`; Summary = `GOOGLE_CLOUD_LOCATION` default `us-central1`. |

**Not used:** Grounding with Google Search, grounding with private data, function calling / tools, embeddings, batch or async inference, fine-tuning.

---

## 5. DATA FLOW

### Where data comes in

| Source | Data | Entry point |
|--------|------|-------------|
| **User (browser)** | Email, password | `POST /auth/login`, `POST /auth/register` |
| **User (browser)** | Display name, time windows, emergency contact, pharmacist contact (on register) | `POST /auth/register` body |
| **User (browser)** | Medication schedule (morning/afternoon/night + time windows) | `PUT /elders/{elder_id}/schedule` |
| **User (browser)** | Emergency/pharmacist contact updates | `PUT /elders/{elder_id}/contacts` |
| **User (browser)** | Live session: audio (PCM base64), optional image (JPEG base64), optional text (e.g. “I want to end session”) | WebSocket `/ws` → forwarded to Vertex Live |
| **User (browser)** | Transcript + optional refill context after session | `POST /elders/{elder_id}/session-summary` |
| **User (browser)** | Dose confirmation (slot, taken boolean) | `POST /elders/{elder_id}/confirm-dose` |
| **User (browser)** | Latitude, longitude, radius (for pharmacies) | `GET /api/nearby-pharmacies?lat=&lng=&radius=` |
| **Overpass API** | Pharmacy OSM data (elements with tags) | Backend HTTP GET to Overpass; parsed in `_fetch_nearby_pharmacies` |
| **Vertex AI** | Live: audio chunks, transcript, turnComplete, interrupted | WebSocket from Vertex → backend → client |
| **Vertex AI** | Summary: single text response | Generate Content response → backend → returned in session-summary JSON |
| **Firestore** | Elder doc, user doc | Backend via `firestore_client` (get_elder, get_elder_schedule, get_user_by_email, etc.) |

### How it’s processed and stored

- **Auth:** Register creates `elders` doc (schedule from payload or default empty + time windows) and `users` doc (email, password plain, elder_id, display_name). Login reads `users` by email, compares password, returns elder_id + display_name; frontend stores elder_id and display_name in sessionStorage.
- **Schedule:** Stored in `elders/{id}.schedule` (morning/afternoon/night arrays of { name, strength?, quantity? }, plus timeWindows). Loaded on dashboard; saved via PUT schedule.
- **Profile/contacts:** Stored in same elder doc (displayName, emergencyContact, pharmacistContact). Loaded via GET profile; updated via PUT contacts.
- **Live session:** Audio and image bytes forwarded to Vertex; no persistence of audio or images in MedMate. Transcript is only in frontend state until session end.
- **Session summary:** Transcript (and optional refill) sent to backend; backend calls Vertex to get summary text; summary + refill block stored nowhere—returned in response and optionally emailed. No DB write for transcript or summary.
- **Dose confirmation:** `record_dose_confirmation(elder_id, slot, taken)` writes to `elders/{id}.doseConfirmations[slot]` = { at: ISO8601, taken: bool }. If emergency contact has email, backend sends dose notification email (taken or not taken).
- **Nearby pharmacies:** Backend gets lat/lng/radius, calls Overpass, maps elements to { name, address, lat, lon, distance_km, phone }, sorts by distance, returns top 20; frontend can show and pass top 3 into session-summary refill.

### Where data goes out

| Destination | Data | When |
|-------------|------|------|
| **Browser (user)** | REST responses: schedule, profile, auth tokens (elder_id, display_name), session-summary JSON, confirm-dose OK, pharmacies list, health/ready | After each corresponding request |
| **Browser (user)** | WebSocket: Vertex messages (audio, transcript, turnComplete, interrupted, errors) | During live session |
| **Caretaker email** | Session summary (and refill block with top pharmacies) | After POST session-summary if emergency contact email set and SMTP configured |
| **Caretaker email** | Dose notification (taken or not taken) | After POST confirm-dose if emergency contact email set and SMTP configured |
| **Vertex AI** | System instruction + realtime input (audio/image/text) | During live session |
| **Vertex AI** | Summary prompt (conversation text) | On session-summary POST |
| **Overpass** | Query (Overpass QL for pharmacy nodes/ways) | When backend handles GET nearby-pharmacies |
| **Firestore** | Writes: set_elder_schedule, create_user, record_dose_confirmation (doseConfirmations merge) | On register, schedule/contacts update, confirm-dose |

---

## 6. SYSTEM COMPONENTS

### Backend (single FastAPI app)

| Component | File | Role |
|-----------|------|------|
| **App** | `main.py` | FastAPI app, CORS allow all, routes and WebSocket handler. |
| **Health** | `main.py` | GET `/health`, GET `/ready`; health returns status and optional project. |
| **Auth** | `main.py` | GET `/auth/status`; POST `/auth/register`; POST `/auth/login`. |
| **Elder schedule** | `main.py` | GET/PUT `/elders/{elder_id}/schedule`. |
| **Elder profile** | `main.py` | GET `/elders/{elder_id}/profile`. |
| **Elder contacts** | `main.py` | PUT `/elders/{elder_id}/contacts`. |
| **Session summary** | `main.py` | POST `/elders/{elder_id}/session-summary` (calls `_summarize_transcript_for_caretaker`, then optional email). |
| **Confirm dose** | `main.py` | POST `/elders/{elder_id}/confirm-dose` (record_dose_confirmation + optional dose email). |
| **Nearby pharmacies** | `main.py` | GET `/api/nearby-pharmacies` (Overpass + haversine sort, max 20). |
| **WebSocket** | `main.py` | GET `/ws`; accepts, validates elder_id, delegates to `live_session.run_live_proxy`. |
| **Live proxy** | `live_session.py` | Loads schedule, builds system instruction, connects to Vertex Live WSS, proxies client ↔ Vertex; first-turn trigger after setupComplete. |
| **Firestore client** | `firestore_client.py` | Lazy singleton Firestore client; get_elder_schedule, get_elder, set_elder_schedule, get_user_by_email, record_dose_confirmation, create_user. |

### Frontend

| Component | File | Role |
|-----------|------|------|
| **App shell** | `app/layout.tsx` | Root layout, fonts, metadata, globals.css. |
| **Single page** | `app/page.tsx` | All UI: login/register, dashboard (schedule, profile/contacts, live session, transcript, confirm dose, nearby pharmacies, refill, session summary). Conditional render by elderId (null = auth screen; else = dashboard). |
| **Live session client** | `lib/liveSession.ts` | Class `LiveSession`: connect (health check then WebSocket), startMic/stopMic, sendImageFromCamera, startLiveVideoFeed/stopLiveVideoFeed, disconnect; handleMessage for serverContent (transcript, audio, turnComplete, interrupted); playback 24 kHz PCM with buffer; send realtime_input (audio/image). |

### External

| Component | Role |
|-----------|------|
| **Vertex AI Live API** | Real-time model; receives setup + stream; returns audio + transcript. |
| **Vertex AI Generate Content** | Summary model; receives prompt; returns text. |
| **Firestore** | Persistence for elders and users. |
| **Overpass API** | Pharmacy POI data. |
| **SMTP server** | Optional; sends summary and dose emails. |

### Connections

- Frontend → Backend: HTTP (fetch) for all REST; WebSocket for `/ws` (one per live session).
- Backend → Firestore: SDK (firestore_client).
- Backend → Vertex Live: Single WebSocket per session (client_ws accepted, then one vertex_ws to Vertex).
- Backend → Vertex Generate: HTTP POST (REST) or SDK `generate_content` (session summary only).
- Backend → Overpass: HTTP GET (sync, 15s timeout).
- Backend → SMTP: TCP (smtplib), only when env set.

**Queues / caches / background jobs:** None. No message queue, no Redis, no Celery; all work is request-scoped or one WebSocket session.

---

## 7. USER JOURNEYS

### U1: Register

1. User opens app (no elderId in sessionStorage).  
2. Clicks “Sign up”; fills email, password, optional display name, time windows, emergency contact, pharmacist contact.  
3. Submit → `POST /auth/register`.  
4. Backend: elder_id = _email_to_elder_id(email); creates elder with default empty schedule + time windows + contacts; creates user with email/password/elder_id.  
5. Response: elder_id, display_name. Frontend stores in sessionStorage, sets elderId/displayName state.  
6. UI shows dashboard (schedule, profile, session, etc.).

### U2: Login

1. User on auth screen; enters email and password; Submit → `POST /auth/login`.  
2. Backend: get_user_by_email (Firestore); compare password; return elder_id, display_name.  
3. Frontend stores in sessionStorage and state; shows dashboard.

### U3: View and edit schedule

1. On dashboard load (elderId set), frontend GET `/elders/{elder_id}/schedule` and GET profile.  
2. Schedule displayed in slots (morning/afternoon/night) with time windows; user can add/remove/edit meds and time window start/end.  
3. Save → PUT `/elders/{elder_id}/schedule` with body; backend set_elder_schedule.  
4. UI shows “Saved” feedback.

### U4: Edit contacts

1. Profile section shows emergency and pharmacist contact fields (from GET profile).  
2. User edits; Save contacts → PUT `/elders/{elder_id}/contacts`.  
3. Backend loads schedule, merges new contact data, set_elder_schedule.  
4. UI shows “Saved” or error.

### U5: Live voice session (full path)

1. User clicks Start session. Frontend creates `LiveSession(BACKEND_URL, elderId, callbacks)`, calls `connect()`.  
2. Frontend: GET `/health`; then WebSocket `ws://backend/ws?elder_id=<id>&timezone=<Intl.resolvedOptions().timeZone>`.  
3. Backend: accept WebSocket; load schedule; build system instruction; connect to Vertex Live; send setup; on setupComplete send first-turn trigger.  
4. Vertex sends greeting audio (+ transcript); backend forwards; client plays audio and shows transcript.  
5. User clicks Start microphone; frontend captures 16 kHz PCM, sends base64 in `realtime_input.media_chunks`; backend forwards to Vertex.  
6. User speaks; Vertex transcribes and responds with audio; client plays and appends to transcript.  
7. (Optional) User clicks “Show pill or bottle”; frontend gets camera frame, JPEG base64, sends as realtime_input; backend forwards; Vertex may guide (“turn so I can see the imprint”) and then identify.  
8. (Optional) User starts “live video”; frontend sends ~1 FPS JPEG to backend → Vertex.  
9. User can interrupt; Vertex sets interrupted; frontend may send short text so model says “Sorry, I heard noise…”.  
10. When user says they want to end: first click sends “I want to end the session” to model; model may ask mandatory questions (symptoms, enough tablets); when model says “you can end the session”, frontend sets mandatoryQuestionsAnswered; second End click (or if already answered) triggers doEndSession.

### U6: End session and get summary

1. User clicks End session. If transcript empty or not connected → disconnect only, no summary.  
2. Else: disconnect WebSocket, set endingPhase “summarizing”, POST `/elders/{elder_id}/session-summary` with transcript and optional refill (slot, reason, top_pharmacies).  
3. Backend: get elder; _summarize_transcript_for_caretaker(transcript); build display_summary (summary + refill block); if caretaker email and SMTP → _send_email; return { summary, sent_to }.  
4. Frontend shows summary and “Sent to <email>” or “No email configured”.

### U7: Confirm dose (I took it / I didn’t take it)

1. User selects slot (morning/afternoon/night) and clicks “I took it” or “I didn’t take it”.  
2. Frontend POST `/elders/{elder_id}/confirm-dose` with { slot, taken }.  
3. Backend: record_dose_confirmation (writes doseConfirmations[slot]); get elder; if emergency contact has email → _send_dose_notification_email.  
4. Frontend shows “Recorded: you took it.” or “Recorded: not taken. Emergency contact will be emailed if configured.”

### U8: Nearby pharmacies (refill)

1. User selects slot (for which meds), clicks “Find pharmacies near me”.  
2. Frontend: getCurrentPosition; GET `/api/nearby-pharmacies?lat=&lng=&radius=5000`.  
3. Backend: _fetch_nearby_pharmacies (Overpass query, parse, haversine sort, top 20); return { pharmacies }.  
4. Frontend shows list with name, address, distance, Maps link, and refill/checkout link (from getRefillCheckoutUrl).  
5. If user had said “refill”/“out of tablets” in session and allowed location, refill context (slot, reason, top 3) is also sent in session-summary so caregiver email includes pharmacy list.

### U9: Logout

1. User clicks Logout. Frontend: session?.disconnect(); clear sessionStorage (AUTH_KEY, AUTH_DISPLAY_NAME_KEY); set elderId/displayName to null.  
2. UI shows auth screen again.

---

## 8. EXTERNAL INTEGRATIONS

| Integration | Direction | Data in | Data out | When |
|-------------|-----------|---------|-----------|------|
| **Vertex AI Gemini Live API** | Backend → Vertex | WebSocket: setup (model URI, system_instruction, generation_config, realtime_input_config); then realtime_input (audio PCM base64, image/jpeg base64); client_content (user text, turn_complete). | WebSocket: setupComplete; serverContent (modelTurn with audio parts, outputTranscription, inputTranscription, turnComplete, interrupted). | Every live session. |
| **Vertex AI Generate Content** | Backend → Vertex | REST or SDK: POST generateContent with contents (user prompt = summary instruction + conversation text), generationConfig (maxOutputTokens 1024, temperature 0.3). | JSON: candidates[0].content.parts[0].text (summary string). | Once per session-summary POST. |
| **Google Cloud Firestore** | Backend ↔ Firestore | Reads: elders/{id}, users/{email}. Writes: set (elders, users), merge (doseConfirmations, contacts). | Elder doc (schedule, displayName, emergencyContact, pharmacistContact, doseConfirmations); user doc (email, password, elder_id, display_name). | Every auth, schedule, profile, contacts, confirm-dose, and at session start (schedule load). |
| **Overpass API** | Backend → Overpass | GET request: URL with encoded Overpass QL (node/way amenity=pharmacy around radius, lat, lon; out body center). Timeout 15s. | JSON: elements with tags (name, brand, addr:*, contact:phone, etc.), lat/lon or center. | When GET /api/nearby-pharmacies is called. |
| **SMTP** | Backend → Mail server | TCP to SMTP_HOST:SMTP_PORT; STARTTLS if 587; auth if SMTP_USER/SMTP_PASSWORD; From FROM_EMAIL; To caretaker email; body plain text. | Session summary email body; or dose notification (taken/not taken) body. | After session-summary if caretaker email set; after confirm-dose if emergency contact email set. |
| **Browser Geolocation** | Frontend ← Device | getCurrentPosition (options: timeout 15s or 8s, maximumAge 60s). | latitude, longitude to frontend; frontend passes to GET /api/nearby-pharmacies. | When user clicks “Find pharmacies near me” or when refill detected in transcript and user allows location. |
| **Pharmacy / Maps links** | Frontend → User | None (no server call). | User clicks links: CVS, Walgreens, Rite Aid, Walmart, Kroger, Target, Costco (fixed URLs), or Google search; Google Maps URL with query or lat,lon. | When user clicks refill link or Maps link in UI. |

**Webhooks:** None. No inbound webhook endpoints; no outbound webhook calls.

---

## Environment variables (reference)

**Backend:**  
- `GOOGLE_CLOUD_PROJECT` (required)  
- `GOOGLE_APPLICATION_CREDENTIALS` (optional; ADC otherwise)  
- `GOOGLE_CLOUD_LOCATION` (optional; default `us-central1` for summary)  
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `FROM_EMAIL` (optional; for emails)

**Frontend:**  
- `NEXT_PUBLIC_BACKEND_URL` (e.g. `http://localhost:8080` or Cloud Run URL)

---

*Document generated for building a professional architecture diagram. Every technical detail above is extracted from the MedMate codebase and docs.*
