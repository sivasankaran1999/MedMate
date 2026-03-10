"""MedMate backend - Cloud Run service for Vertex AI Live API proxy and Firestore."""

import os
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from firestore_client import get_elder_schedule, set_elder_schedule

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


class SchedulePayload(BaseModel):
    morning: list[MedEntry] = []
    afternoon: list[MedEntry] = []
    night: list[MedEntry] = []


def _schedule_to_dict(s: SchedulePayload) -> dict[str, Any]:
    return {
        "morning": [e.model_dump(exclude_none=True) for e in s.morning],
        "afternoon": [e.model_dump(exclude_none=True) for e in s.afternoon],
        "night": [e.model_dump(exclude_none=True) for e in s.night],
    }


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


def _get_elder_id_from_scope(scope: dict) -> str | None:
    qs = scope.get("query_string", b"").decode()
    for part in qs.split("&"):
        if "=" in part:
            k, v = part.split("=", 1)
            if k == "elder_id":
                return v
    return None


@app.websocket("/ws")
async def websocket_session(websocket: WebSocket):
    """Live API session: load elder schedule, inject system prompt, proxy to Vertex AI."""
    elder_id = _get_elder_id_from_scope(websocket.scope)
    if not elder_id:
        await websocket.close(code=4000, reason="elder_id query param required")
        return
    await websocket.accept()
    try:
        from live_session import run_live_proxy
        await run_live_proxy(websocket, elder_id, get_elder_schedule)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"error": str(e)})
        except Exception:
            pass
