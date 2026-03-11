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

import re
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from firestore_client import create_user, get_elder_schedule, get_user_by_email, set_elder_schedule

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
    set_elder_schedule(
        elder_id,
        schedule,
        display_name=body.display_name or body.email.split("@")[0],
        language="en",
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
    user = get_user_by_email(body.email)
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
