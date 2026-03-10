"""
Vertex AI Gemini Live API proxy: inject MedMate system prompt + elder schedule, then forward messages.
"""

import asyncio
import json
import logging
import os
from typing import Any

import google.auth

logger = logging.getLogger(__name__)
import google.auth.transport.requests
import websockets
from websockets.exceptions import ConnectionClosed

LIVE_API_HOST = "us-central1-aiplatform.googleapis.com"
LIVE_API_PATH = "/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent"
LIVE_MODEL = "gemini-2.0-flash-live-preview-04-09"


def _format_schedule(schedule: dict[str, Any] | None) -> str:
    if not schedule:
        return "No medication schedule is set for this person."
    lines = []
    for slot in ("morning", "afternoon", "night"):
        meds = schedule.get(slot) or []
        if not meds:
            lines.append(f"- {slot.capitalize()}: none")
        else:
            parts = []
            for m in meds:
                name = m.get("name", "?")
                strength = m.get("strength")
                parts.append(f"{name} {strength or ''}".strip())
            lines.append(f"- {slot.capitalize()}: " + "; ".join(parts))
    return "\n".join(lines)


MEDMATE_PERSONA = """You are MedMate, a calm, clear, and patient voice assistant for an older adult. Use short, simple sentences. Speak slowly and clearly. Be warm and reassuring.

Your role:
- Answer questions about this person's medication schedule (morning, afternoon, night).
- When they show you a pill or a bottle (by sending an image), identify it (for a pill: shape, color, and any letters or numbers on it; for a bottle: read the label). Match it to their schedule when possible.
- Use the current time of day to say whether a pill is for "now" or for another time. If they show a pill that is for a different time (e.g. a night pill in the morning), tell them what the pill is, that it's for another time, and what they should take right now instead.
- If you are not sure what a pill or bottle is, say so and suggest they check with their pharmacist or doctor."""


def build_system_instruction(schedule: dict[str, Any] | None) -> str:
    schedule_block = _format_schedule(schedule)
    return f"""{MEDMATE_PERSONA}

This person's medication schedule:
{schedule_block}

When answering "what do I take in the morning/afternoon/night?" use the schedule above. When they show you a pill or bottle, compare it to this schedule and the current time."""


def get_access_token() -> str:
    creds, _ = google.auth.default()
    if not creds.valid:
        creds.refresh(google.auth.transport.requests.Request())
    return creds.token


async def run_live_proxy(
    client_ws: Any,
    elder_id: str,
    get_schedule_fn: Any,
) -> None:
    """Connect to Vertex Live API with MedMate system prompt and elder schedule; proxy client <-> Vertex."""
    schedule = None
    try:
        schedule = get_schedule_fn(elder_id)
    except Exception as e:
        err_msg = f"Could not load schedule: {e}"
        logger.exception("Could not load schedule for elder_id=%s", elder_id)
        try:
            await client_ws.send_json({"error": err_msg})
            await client_ws.close(code=4000, reason=err_msg[:123])
        except Exception:
            pass
        return

    try:
        token = get_access_token()
    except Exception as e:
        err_msg = f"Auth failed: {e}"
        logger.exception("get_access_token failed")
        try:
            await client_ws.send_json({"error": err_msg})
            await client_ws.close(code=4010, reason=err_msg[:123])
        except Exception:
            pass
        return
    url = f"wss://{LIVE_API_HOST}{LIVE_API_PATH}"
    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
    model_uri = f"projects/{project}/locations/us-central1/publishers/google/models/{LIVE_MODEL}"
    system_instruction = build_system_instruction(schedule)

    setup_message = {
        "setup": {
            "model": model_uri,
            "system_instruction": {"parts": [{"text": system_instruction}]},
            "generation_config": {
                "response_modalities": ["AUDIO"],
                "temperature": 0.9,
                "speech_config": {
                    "voice_config": {
                        "prebuilt_voice_config": {"voice_name": "Puck"},
                    }
                },
            },
            "realtime_input_config": {
                "automatic_activity_detection": {
                    "disabled": False,
                    "silence_duration_ms": 2000,
                    "prefix_padding_ms": 500,
                },
                "activity_handling": "ACTIVITY_HANDLING_UNSPECIFIED",
            },
        }
    }

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    try:
        async with websockets.connect(url, additional_headers=headers) as vertex_ws:
            await vertex_ws.send(json.dumps(setup_message))

            setup_done = False

            async def vertex_to_client() -> None:
                nonlocal setup_done
                try:
                    async for raw in vertex_ws:
                        if isinstance(raw, bytes):
                            await client_ws.send_bytes(raw)
                        else:
                            msg = json.loads(raw) if isinstance(raw, str) else raw
                            if msg.get("setupComplete") is not None:
                                setup_done = True
                            await client_ws.send_text(json.dumps(msg))
                except (ConnectionClosed, Exception):
                    pass

            async def client_to_vertex() -> None:
                try:
                    while True:
                        raw = await client_ws.receive()
                        if "text" in raw:
                            try:
                                data = json.loads(raw["text"])
                                if data.get("service_url") or data.get("bearer_token") or data.get("setup"):
                                    continue
                            except json.JSONDecodeError:
                                pass
                            await vertex_ws.send(raw["text"])
                        elif "bytes" in raw:
                            await vertex_ws.send(raw["bytes"])
                except (ConnectionClosed, Exception):
                    pass

            await asyncio.gather(
                asyncio.create_task(vertex_to_client()),
                asyncio.create_task(client_to_vertex()),
            )
    except Exception as e:
        err_msg = str(e)
        logger.exception("Vertex Live API connection or proxy failed")
        try:
            await client_ws.send_json({"error": err_msg})
            await client_ws.close(code=4010, reason=err_msg[:123])
        except Exception:
            pass
