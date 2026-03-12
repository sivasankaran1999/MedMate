"""MedMate backend - Cloud Run service for Vertex AI Live API proxy and Firestore."""

import os

# Use certifi's CA bundle for SSL (fixes CERTIFICATE_VERIFY_FAILED on macOS and some environments)
import certifi
os.environ.setdefault("SSL_CERT_FILE", certifi.where())
os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())

# Load .env from backend directory (and .env.example if .env is missing)
from pathlib import Path
from dotenv import load_dotenv
_backend_dir = Path(__file__).resolve().parent
load_dotenv(_backend_dir / ".env")
load_dotenv(_backend_dir / ".env.example")  # fallback if .env doesn't exist

import json
import math
import re
from typing import Any
from urllib.parse import quote
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from firestore_client import (
    create_user,
    get_elder,
    get_elder_schedule,
    get_user_by_email,
    record_dose_confirmation,
    set_elder_schedule,
)

app = FastAPI(title="MedMate Backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Environment: used by Cloud Run and local runs
GOOGLE_CLOUD_PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
GOOGLE_APPLICATION_CREDENTIALS = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")


class MedEntry(BaseModel):
    name: str
    strength: str | None = None
    quantity: int | None = None  # e.g. 2 = "take 2 tablets"


class SchedulePayload(BaseModel):
    morning: list[MedEntry] = []
    afternoon: list[MedEntry] = []
    night: list[MedEntry] = []
    timeWindows: dict[str, Any] | None = None


def _schedule_to_dict(s: SchedulePayload) -> dict[str, Any]:
    out: dict[str, Any] = {
        "morning": [e.model_dump(exclude_none=True) for e in s.morning],
        "afternoon": [e.model_dump(exclude_none=True) for e in s.afternoon],
        "night": [e.model_dump(exclude_none=True) for e in s.night],
    }
    if s.timeWindows is not None:
        out["timeWindows"] = s.timeWindows
    return out


@app.get("/health")
def health():
    """Health check for Cloud Run and load balancers."""
    payload: dict = {"status": "ok"}
    if GOOGLE_CLOUD_PROJECT:
        payload["project"] = GOOGLE_CLOUD_PROJECT
    return payload


@app.get("/ready")
def ready():
    """Readiness for Cloud Run (same as health for now)."""
    return health()


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Approximate distance in km between two WGS84 points."""
    R = 6371
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def _fetch_nearby_pharmacies(lat: float, lon: float, radius_m: int = 5000) -> list[dict[str, Any]]:
    """Query Overpass API for pharmacies (amenity=pharmacy) near lat, lon. Returns list of {name, lat, lon, address, distance_km, phone?}."""
    # around: radius in meters, then lat, lon (Overpass order)
    query = (
        f'[out:json][timeout:15];'
        f'(node["amenity"="pharmacy"](around:{radius_m},{lat},{lon});'
        f' way["amenity"="pharmacy"](around:{radius_m},{lat},{lon}););'
        f' out body center;'
    )
    url = "https://overpass-api.de/api/interpreter?data=" + quote(query)
    try:
        with urlopen(Request(url), timeout=15) as resp:
            data = json.loads(resp.read().decode())
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not fetch pharmacies: {e}")
    elements = data.get("elements") or []
    results = []
    for el in elements:
        tags = el.get("tags") or {}
        name = tags.get("name") or tags.get("brand") or "Pharmacy"
        addr = tags.get("addr:street") or tags.get("address") or ""
        if tags.get("addr:housenumber"):
            addr = f"{tags['addr:housenumber']} {addr}".strip()
        if tags.get("addr:city"):
            addr = f"{addr}, {tags['addr:city']}".strip() if addr else tags["addr:city"]
        lat_el = el.get("lat")
        lon_el = el.get("lon")
        if lat_el is None and "center" in el:
            lat_el = el["center"].get("lat")
            lon_el = el["center"].get("lon")
        if lat_el is None or lon_el is None:
            continue
        dist = _haversine_km(lat, lon, lat_el, lon_el)
        phone = tags.get("contact:phone") or tags.get("phone") or None
        results.append({
            "name": name,
            "address": addr or None,
            "lat": lat_el,
            "lon": lon_el,
            "distance_km": round(dist, 2),
            "phone": phone,
        })
    results.sort(key=lambda x: x["distance_km"])
    return results[:20]


@app.get("/api/nearby-pharmacies")
def nearby_pharmacies(lat: float, lng: float, radius: int = 5000):
    """Return nearby pharmacies (OpenStreetMap) for the given coordinates. radius in meters (default 5km)."""
    if radius < 100 or radius > 50000:
        raise HTTPException(status_code=400, detail="radius must be between 100 and 50000 meters")
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(status_code=400, detail="Invalid lat or lng")
    return {"pharmacies": _fetch_nearby_pharmacies(lat, lng, radius)}


# Default empty schedule with time windows for new sign-ups
DEFAULT_EMPTY_SCHEDULE = {
    "timeWindows": {
        "morning": {"start": "10:00", "end": "12:00"},
        "afternoon": {"start": "14:00", "end": "16:00"},
        "night": {"start": "20:00", "end": "23:00"},
    },
    "morning": [],
    "afternoon": [],
    "night": [],
}


def _email_to_elder_id(email: str) -> str:
    """Generate a stable elder_id from email for new registrations."""
    key = email.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", key).strip("-")[:40]
    return f"elder-{slug}" if slug else f"elder-{hash(key) % 10**8}"


class LoginPayload(BaseModel):
    email: str
    password: str


class RegisterPayload(BaseModel):
    email: str
    password: str
    display_name: str | None = None
    time_windows: dict[str, Any] | None = None  # e.g. {"morning": {"start": "10:00", "end": "12:00"}, ...}
    emergency_contact_name: str | None = None
    emergency_contact_email: str | None = None  # family/contact notified via email if dose not taken
    pharmacist_name: str | None = None
    pharmacist_email: str | None = None
    pharmacist_phone: str | None = None


@app.post("/auth/register")
def register(body: RegisterPayload):
    """Create a new account: creates an elder (empty schedule) and a user linked to it."""
    if get_user_by_email(body.email):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    elder_id = _email_to_elder_id(body.email)
    schedule = dict(DEFAULT_EMPTY_SCHEDULE)
    if body.time_windows and isinstance(body.time_windows, dict):
        default_tw = schedule["timeWindows"]
        tw = dict(default_tw)
        for slot in ("morning", "afternoon", "night"):
            v = body.time_windows.get(slot)
            if isinstance(v, dict) and v.get("start") and v.get("end"):
                tw[slot] = {"start": str(v["start"]), "end": str(v["end"])}
        schedule["timeWindows"] = tw
    emergency_contact = None
    if (body.emergency_contact_email or "").strip():
        emergency_contact = {
            "name": (body.emergency_contact_name or "").strip() or "Emergency contact",
            "email": (body.emergency_contact_email or "").strip().lower(),
        }
    pharmacist_contact = None
    if (body.pharmacist_email or body.pharmacist_phone or body.pharmacist_name):
        pharmacist_contact = {
            "name": (body.pharmacist_name or "").strip() or None,
            "email": (body.pharmacist_email or "").strip().lower() or None,
            "phone": (body.pharmacist_phone or "").strip() or None,
        }
        pharmacist_contact = {k: v for k, v in pharmacist_contact.items() if v}
    set_elder_schedule(
        elder_id,
        schedule,
        display_name=body.display_name or body.email.split("@")[0],
        language="en",
        emergency_contact=emergency_contact,
        pharmacist_contact=pharmacist_contact if pharmacist_contact else None,
    )
    create_user(
        body.email,
        body.password,
        elder_id,
        display_name=body.display_name or body.email.split("@")[0],
    )
    return {
        "elder_id": elder_id,
        "display_name": body.display_name or body.email.split("@")[0],
    }


@app.post("/auth/login")
def login(body: LoginPayload):
    """Sign in with email and password. Returns elder_id and display_name for the session."""
    import logging
    from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
    try:
        with ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(get_user_by_email, body.email)
            try:
                user = fut.result(timeout=15)
            except FuturesTimeoutError:
                logging.getLogger("uvicorn.error").warning("Login: Firestore/auth timed out after 15s")
                raise HTTPException(
                    status_code=503,
                    detail="Database connection timed out. Run 'gcloud auth application-default login' in the backend terminal, then restart. See backend/LOCAL-DEV.md.",
                ) from None
    except HTTPException:
        raise
    except Exception as e:
        logging.getLogger("uvicorn.error").exception("Login failed (Firestore/credentials)")
        raise HTTPException(
            status_code=503,
            detail="Database unavailable. Run 'gcloud auth application-default login' in this terminal, then restart the backend. See backend/LOCAL-DEV.md.",
        ) from e
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.get("password") != body.password:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    elder_id = user.get("elder_id")
    if not elder_id:
        raise HTTPException(status_code=500, detail="User has no elder_id")
    return {
        "elder_id": elder_id,
        "display_name": user.get("display_name") or user.get("displayName") or body.email.split("@")[0],
    }


@app.get("/elders/{elder_id}/schedule")
def get_schedule(elder_id: str):
    """Return this elder's medication schedule (morning, afternoon, night)."""
    try:
        schedule = get_elder_schedule(elder_id)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    if schedule is None:
        raise HTTPException(status_code=404, detail="Elder not found")
    return schedule


@app.put("/elders/{elder_id}/schedule")
def update_schedule(elder_id: str, body: SchedulePayload):
    """Create or update an elder's schedule (admin/demo)."""
    try:
        set_elder_schedule(elder_id, _schedule_to_dict(body))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return {"ok": True}


@app.get("/elders/{elder_id}/profile")
def get_profile(elder_id: str):
    """Return elder profile: displayName, emergencyContact, pharmacistContact (for editing contacts)."""
    try:
        elder = get_elder(elder_id)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    if elder is None:
        raise HTTPException(status_code=404, detail="Elder not found")
    return {
        "displayName": elder.get("displayName") or elder.get("display_name"),
        "emergencyContact": elder.get("emergencyContact") or elder.get("emergency_contact"),
        "pharmacistContact": elder.get("pharmacistContact") or elder.get("pharmacist_contact"),
    }


class UpdateContactsPayload(BaseModel):
    emergency_contact_name: str | None = None
    emergency_contact_email: str | None = None
    pharmacist_name: str | None = None
    pharmacist_email: str | None = None
    pharmacist_phone: str | None = None


@app.put("/elders/{elder_id}/contacts")
def update_contacts(elder_id: str, body: UpdateContactsPayload):
    """Update emergency and/or pharmacist contact. Keeps existing schedule."""
    try:
        schedule = get_elder_schedule(elder_id)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    if schedule is None:
        raise HTTPException(status_code=404, detail="Elder not found")
    emergency_contact = None
    if (body.emergency_contact_email or "").strip():
        emergency_contact = {
            "name": (body.emergency_contact_name or "").strip() or "Emergency contact",
            "email": (body.emergency_contact_email or "").strip().lower(),
        }
    pharmacist_contact = None
    if (body.pharmacist_email or body.pharmacist_phone or (body.pharmacist_name or "").strip()):
        pharmacist_contact = {
            "name": (body.pharmacist_name or "").strip() or None,
            "email": (body.pharmacist_email or "").strip().lower() or None,
            "phone": (body.pharmacist_phone or "").strip() or None,
        }
        pharmacist_contact = {k: v for k, v in pharmacist_contact.items() if v}
    try:
        set_elder_schedule(
            elder_id,
            schedule,
            emergency_contact=emergency_contact,
            pharmacist_contact=pharmacist_contact,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return {"ok": True}


class ConfirmDosePayload(BaseModel):
    slot: str  # "morning" | "afternoon" | "night"
    taken: bool


class TranscriptEntry(BaseModel):
    role: str
    text: str


class CaregiverPharmacyOption(BaseModel):
    name: str
    address: str | None = None
    distance_km: float | None = None
    url: str | None = None


class RefillSummaryPayload(BaseModel):
    slot: str  # "morning" | "afternoon" | "night"
    reason: str
    top_pharmacies: list[CaregiverPharmacyOption] = []


class SessionSummaryPayload(BaseModel):
    transcript: list[TranscriptEntry]
    refill: RefillSummaryPayload | None = None


def _send_email(to_email: str, subject: str, body_text: str) -> None:
    """Send a single email via SMTP. No-op if SMTP not configured."""
    host = os.environ.get("SMTP_HOST", "").strip()
    if not host:
        import logging
        logging.getLogger("uvicorn.error").info("SMTP not configured; skipping email")
        return
    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ.get("SMTP_USER", "").strip()
    password = os.environ.get("SMTP_PASSWORD", "")
    from_addr = os.environ.get("FROM_EMAIL", user or "medmate@localhost").strip()
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_email
    msg.attach(MIMEText(body_text, "plain"))
    try:
        with smtplib.SMTP(host, port) as s:
            if port == 587:
                s.starttls()
            if user and password:
                s.login(user, password)
            s.sendmail(from_addr, [to_email], msg.as_string())
    except Exception as e:
        import logging
        logging.getLogger("uvicorn.error").warning("Failed to send email: %s", e)


def _summarize_transcript_for_caretaker(transcript: list[dict[str, str]]) -> str:
    """Call Vertex AI Gemini to summarize the conversation for a caretaker. Returns summary text."""
    lines = []
    for entry in transcript:
        role = (entry.get("role") or "user").lower()
        text = (entry.get("text") or "").strip()
        if not text:
            continue
        if role == "assistant":
            lines.append(f"MedMate: {text}")
        elif role == "user":
            lines.append(f"User: {text}")
        else:
            lines.append(text)
    conversation = "\n".join(lines) if lines else "No conversation."
    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "").strip()
    location = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1").strip()
    _fallback = "Session ended. A brief summary could not be generated for this session."
    _log = __import__("logging").getLogger("uvicorn.error")
    if not project:
        _log.warning("Session summary: GOOGLE_CLOUD_PROJECT not set")
        return _fallback
    prompt = f"""Summarize this conversation between an elderly user and a medication assistant (MedMate) for a family caretaker. Be concise. Include:
- What was discussed (medications, doses, timing)
- Whether any doses were taken or missed
- Any concerns or follow-ups mentioned
Keep the summary to a short paragraph.

Conversation:
{conversation}"""

    # Try Google GenAI SDK (Vertex AI) first
    try:
        from google import genai
        client = genai.Client(vertexai=True, project=project, location=location)
        for model_id in ("gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-flash-002"):
            try:
                response = client.models.generate_content(
                    model=model_id,
                    contents=prompt,
                )
                if response is None:
                    continue
                text = getattr(response, "text", None) if response else None
                if isinstance(text, str) and text.strip():
                    return text.strip()
            except Exception as model_err:
                _log.info("Session summary: model %s failed: %s", model_id, model_err)
                continue
    except ImportError:
        _log.info("Session summary: google-genai not installed, using REST")
    except Exception as e:
        _log.warning("Session summary: SDK failed: %s", e)

    # Fallback: REST API with ADC
    try:
        import google.auth
        import google.auth.transport.requests
        creds, _ = google.auth.default()
        if not creds.valid:
            creds.refresh(google.auth.transport.requests.Request())
        token = creds.token
        url = f"https://{location}-aiplatform.googleapis.com/v1/projects/{quote(project, safe='')}/locations/{quote(location, safe='')}/publishers/google/models/gemini-1.5-flash:generateContent"
        body = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"maxOutputTokens": 1024, "temperature": 0.3},
        }
        req = Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        err = data.get("error")
        if err:
            _log.warning("Session summary: Vertex API error: %s", err.get("message") or err)
            return _fallback
        candidates = data.get("candidates") or []
        if not candidates:
            _log.warning("Session summary: Vertex API returned no candidates (e.g. safety block). Response keys: %s", list(data.keys()))
            return _fallback
        parts = (candidates[0].get("content") or {}).get("parts") or []
        if not parts:
            _log.warning("Session summary: Vertex API returned candidate with no parts")
            return _fallback
        text = (parts[0].get("text") or "").strip()
        return text if text else _fallback
    except Exception as e:
        _log.warning("Session summary generation failed: %s", e)
        return _fallback


@app.post("/elders/{elder_id}/session-summary")
def session_summary(elder_id: str, body: SessionSummaryPayload):
    """Summarize the session transcript and email it to the caretaker. Returns summary and sent_to."""
    try:
        elder = get_elder(elder_id)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    if elder is None:
        raise HTTPException(status_code=404, detail="Elder not found")
    display_name = (elder.get("displayName") or elder.get("display_name") or "Your family member").strip()
    ec = elder.get("emergencyContact") or elder.get("emergency_contact") or {}
    caretaker_email = (ec.get("email") or "").strip().lower() if isinstance(ec, dict) else ""
    caretaker_name = (ec.get("name") or "Caretaker").strip() if isinstance(ec, dict) else "Caretaker"
    transcript_data = [{"role": e.role, "text": e.text} for e in body.transcript]
    summary = _summarize_transcript_for_caretaker(transcript_data)

    refill_block = ""
    if body.refill is not None:
        slot = (body.refill.slot or "").strip().lower() or "unknown"
        reason = (body.refill.reason or "").strip()
        refill_block = f"\n\nRefill alert: {display_name} indicated they may be out of tablets ({slot})."
        if reason:
            refill_block += f"\nReason/context (from transcript): {reason}"
        if body.refill.top_pharmacies:
            refill_block += "\nTop nearby pharmacies:"
            for i, p in enumerate(body.refill.top_pharmacies[:3], start=1):
                line = f"\n{i}. {p.name}"
                if p.distance_km is not None:
                    line += f" ({p.distance_km:.2f} km)"
                if p.address:
                    line += f" — {p.address}"
                if p.url:
                    line += f"\n   Refill/checkout: {p.url}"
                refill_block += line

    sent_to: str | None = None
    if caretaker_email:
        subject = f"MedMate session summary for {display_name}"
        body_text = f"Hello {caretaker_name},\n\nHere is a summary of the recent MedMate conversation with {display_name}:\n\n{summary}{refill_block}\n\n— MedMate"
        _send_email(caretaker_email, subject, body_text)
        sent_to = caretaker_email
    return {"summary": summary, "sent_to": sent_to}


def _send_dose_notification_email(
    to_email: str, to_name: str, elder_display_name: str, slot: str, taken: bool
) -> None:
    """Send email via SMTP notifying emergency contact: either that the dose was taken or not taken. No-op if SMTP not configured."""
    host = os.environ.get("SMTP_HOST", "").strip()
    if not host:
        import logging
        logging.getLogger("uvicorn.error").info("SMTP not configured; skipping dose notification email")
        return
    port = int(os.environ.get("SMTP_PORT", "587"))
    user = os.environ.get("SMTP_USER", "").strip()
    password = os.environ.get("SMTP_PASSWORD", "")
    from_addr = os.environ.get("FROM_EMAIL", user or "medmate@localhost").strip()
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    msg = MIMEMultipart("alternative")
    if taken:
        msg["Subject"] = f"MedMate: {elder_display_name} took {slot} medication"
        body_text = f"Hello {to_name},\n\n{elder_display_name} has confirmed they took their {slot} medication.\n\n— MedMate"
    else:
        msg["Subject"] = f"MedMate: {elder_display_name} did not take {slot} medication"
        body_text = f"Hello {to_name},\n\n{elder_display_name} has indicated they did not take their {slot} medication. You may want to follow up.\n\n— MedMate"
    msg["From"] = from_addr
    msg["To"] = to_email
    msg.attach(MIMEText(body_text, "plain"))
    try:
        with smtplib.SMTP(host, port) as s:
            if port == 587:
                s.starttls()
            if user and password:
                s.login(user, password)
            s.sendmail(from_addr, [to_email], msg.as_string())
    except Exception as e:
        import logging
        logging.getLogger("uvicorn.error").warning("Failed to send dose notification email: %s", e)


@app.post("/elders/{elder_id}/confirm-dose")
def confirm_dose(elder_id: str, body: ConfirmDosePayload):
    """Record whether the user took their dose for the given slot. Notify emergency contact by email for both taken and not taken."""
    if body.slot not in ("morning", "afternoon", "night"):
        raise HTTPException(status_code=400, detail="slot must be morning, afternoon, or night")
    try:
        contact = record_dose_confirmation(elder_id, body.slot, body.taken)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    elder = get_elder(elder_id) if contact else None
    display_name = (elder or {}).get("displayName") or (elder or {}).get("display_name") or "Your family member"
    if contact and contact.get("email"):
        _send_dose_notification_email(
            contact["email"], contact.get("name", "Family"), display_name, body.slot, body.taken
        )
    return {"ok": True, "recorded": body.taken}


def _get_query_param(scope: dict, name: str) -> str | None:
    qs = scope.get("query_string") or b""
    if isinstance(qs, bytes):
        qs = qs.decode("utf-8")
    for part in qs.split("&"):
        if "=" in part:
            k, v = part.split("=", 1)
            if k.strip() == name:
                from urllib.parse import unquote
                return unquote(v.strip()) or None
    return None


def _get_elder_id_from_scope(scope: dict) -> str | None:
    return _get_query_param(scope, "elder_id")


@app.websocket("/ws")
async def websocket_session(websocket: WebSocket):
    """Live API session: load elder schedule, inject system prompt, proxy to Vertex AI."""
    import logging
    log = logging.getLogger("uvicorn.error")
    log.info("WebSocket /ws connection attempt")
    # Accept immediately so the client gets "connected"; then validate and run proxy
    await websocket.accept()
    log.info("WebSocket accepted")
    elder_id = _get_elder_id_from_scope(websocket.scope)
    if not elder_id:
        log.warning("WebSocket: missing elder_id")
        try:
            await websocket.send_json({"error": "elder_id query param required"})
            await websocket.close(code=4000, reason="elder_id required")
        except Exception:
            pass
        return
    user_timezone = _get_query_param(websocket.scope, "timezone")
    try:
        from live_session import run_live_proxy
        await run_live_proxy(websocket, elder_id, get_elder_schedule, user_timezone)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        err_msg = str(e)
        import logging
        logging.getLogger("uvicorn.error").exception("WebSocket session error")
        try:
            await websocket.send_json({"error": err_msg})
            await websocket.close(code=4010, reason=err_msg[:123])
        except Exception:
            pass
