# MedMate – LLM models (technical reference)

All generative AI in MedMate runs on **Google Vertex AI** in the same GCP project. No other LLM providers or API keys are used.

---

## 1. Voice / live session (real-time agent)

**Purpose:** Real-time voice conversation: user speaks, agent replies with speech. Handles medication questions, timing, and optional video (pill/bottle).

| Item | Value |
|------|--------|
| **API** | Vertex AI **Gemini Live API** (bidirectional WebSocket) |
| **Endpoint** | `wss://us-central1-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent` |
| **Model ID** | `gemini-2.0-flash-live-preview-04-09` |
| **Region** | `us-central1` (hardcoded in `live_session.py`) |
| **Config location** | `backend/live_session.py` |

**Model URI (logical):**
```text
projects/{GOOGLE_CLOUD_PROJECT}/locations/us-central1/publishers/google/models/gemini-2.0-flash-live-preview-04-09
```

**Generation config:**
- **Response modalities:** `["AUDIO"]` (agent responds with speech).
- **Temperature:** `0.9`
- **Voice:** Prebuilt voice `Puck` (`speech_config.voice_config.prebuilt_voice_config.voice_name`).
- **Input transcription:** Enabled, `language_codes: ["en"]`.
- **Output transcription:** Enabled (for on-screen transcript).
- **Realtime input:** Automatic activity detection (e.g. `silence_duration_ms: 2000`, `prefix_padding_ms: 500`).

**Flow:** Frontend → backend WebSocket proxy → Vertex Live WebSocket. Backend injects system instruction (MedMate persona + elder schedule) and forwards client audio/text and Vertex responses.

---

## 2. Session summary (post-conversation)

**Purpose:** After the user ends the session, summarize the transcript for the caretaker (and optionally email it). **Vertex only;** no fallback text.

| Item | Value |
|------|--------|
| **API** | Vertex AI **Generate Content** (non-streaming) |
| **Region** | From env `GOOGLE_CLOUD_LOCATION`, default `us-central1` |
| **Config location** | `backend/main.py`, `_summarize_transcript_for_caretaker()` |

**Models tried (in order until one returns text):**

1. **Google GenAI SDK (Vertex)**  
   - Client: `genai.Client(vertexai=True, project=project, location=location)`  
   - Models: `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.0-flash-001`, `gemini-2.0-flash-lite-001`

2. **Vertex REST**  
   - API versions: `v1beta1`, then `v1`  
   - URL pattern:  
     `https://{location}-aiplatform.googleapis.com/{api_ver}/projects/{project}/locations/{location}/publishers/google/models/{model_id}:generateContent`  
   - Same model IDs as above, in the same order.

**Per-request config:**
- **maxOutputTokens:** 1024  
- **temperature:** 0.3  

**Timeout:** 45 seconds per REST request.

**Failure behavior:** No fallback summary. On failure (e.g. all models fail or project unset), the backend raises `VertexSummaryError` and the session-summary endpoint returns **HTTP 503** with the error message in `detail`.

---

## Summary table

| Use case           | API / protocol              | Model ID                               | Region      | File              |
|--------------------|-----------------------------|----------------------------------------|-------------|-------------------|
| Live voice agent   | Live API (WebSocket)        | `gemini-2.0-flash-live-preview-04-09`  | us-central1 | `live_session.py` |
| Session summary    | Generate Content (SDK/REST) | `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.0-flash-001`, `gemini-2.0-flash-lite-001` | from env (default us-central1) | `main.py`   |

---

## Environment

- **GOOGLE_CLOUD_PROJECT** (required): GCP project for Vertex and Firestore.
- **GOOGLE_CLOUD_LOCATION** (optional): Used for session summary only; default `us-central1`. Live session uses `us-central1` explicitly.
- Credentials: Application Default Credentials (e.g. `gcloud auth application-default login`) or `GOOGLE_APPLICATION_CREDENTIALS`.

No separate Gemini API key or other provider keys are used; all LLM calls go through Vertex in this project.
