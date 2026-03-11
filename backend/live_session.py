"""
Vertex AI Gemini Live API proxy: inject MedMate system prompt + elder schedule, then forward messages.
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import google.auth

logger = logging.getLogger(__name__)
import google.auth.transport.requests
import websockets
from websockets.exceptions import ConnectionClosed

LIVE_API_HOST = "us-central1-aiplatform.googleapis.com"
LIVE_API_PATH = "/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent"
LIVE_MODEL = "gemini-2.0-flash-live-preview-04-09"

# Default time windows (24h): morning 10–12, afternoon 2–4, night 8–11 (so 3 AM is NOT "night")
DEFAULT_TIME_WINDOWS = {
    "morning": {"start": "10:00", "end": "12:00"},
    "afternoon": {"start": "14:00", "end": "16:00"},
    "night": {"start": "20:00", "end": "23:00"},
}


def _format_schedule(schedule: dict[str, Any] | None) -> str:
    if not schedule:
        return "No medication schedule is set for this person."
    lines = []
    time_windows = schedule.get("timeWindows") or DEFAULT_TIME_WINDOWS
    for slot in ("morning", "afternoon", "night"):
        meds = schedule.get(slot) or []
        win = time_windows.get(slot) or DEFAULT_TIME_WINDOWS.get(slot) or {}
        start, end = win.get("start", "?"), win.get("end", "?")
        window_str = f" ({start}–{end})" if start != "?" else ""
        if not meds:
            lines.append(f"- {slot.capitalize()}{window_str}: none")
        else:
            parts = []
            for m in meds:
                name = m.get("name", "?")
                strength = m.get("strength")
                parts.append(f"{name} {strength or ''}".strip())
            count = len(meds)
            lines.append(f"- {slot.capitalize()}{window_str}: {count} tablet(s) — " + "; ".join(parts))
    return "\n".join(lines)


def _format_time_windows_and_current_time(
    schedule: dict[str, Any] | None,
    user_timezone: str | None = None,
) -> str:
    try:
        tz = ZoneInfo(user_timezone) if user_timezone else timezone.utc
    except Exception:
        tz = timezone.utc
    now = datetime.now(tz)
    current_time_24 = now.strftime("%H:%M")
    current_date = now.strftime("%Y-%m-%d")
    tz_label = user_timezone if user_timezone else "UTC"
    tw = (schedule or {}).get("timeWindows") or DEFAULT_TIME_WINDOWS
    m = tw.get("morning") or DEFAULT_TIME_WINDOWS["morning"]
    a = tw.get("afternoon") or DEFAULT_TIME_WINDOWS["afternoon"]
    n = tw.get("night") or DEFAULT_TIME_WINDOWS["night"]
    return f"""User's current local date and time ({tz_label}): {current_date} {current_time_24}. Use this time for all recommendations—do not ask the user what time it is.

Medication time windows (24-hour, in user's local time):
- Morning: {m.get('start', '10:00')}–{m.get('end', '12:00')}
- Afternoon: {a.get('start', '14:00')}–{a.get('end', '16:00')}
- Night: {n.get('start', '20:00')}–{n.get('end', '23:00')}

Important: "Night" means only within the night window (e.g. 20:00–23:00). If it is 03:00 (3 AM) for the user, the night window has passed—do NOT say they can take the night pill "before bed" or now. Tell them that was for the previous evening and they should wait for the next morning window for morning meds."""


MEDMATE_PERSONA = """You are MedMate, a calm, clear, and patient voice assistant for an older adult. Use short, simple sentences. Speak slowly and clearly. Be warm and reassuring.

Language: Always reply in the same language the user speaks. If they ask in Tamil, reply in Tamil. If they ask in Spanish, reply in Spanish. If they switch language mid-conversation, reply in whatever language they used in their most recent message. Match their language in every response.

Your role:
- If the user asks what time it is or what the time is now, tell them their current local date and time from the context above (it is already provided for you).
- Answer questions about this person's medication schedule (morning, afternoon, night) using the exact time windows given.
- CRITICAL — Seeing pills or bottles: You can only see or identify a pill or bottle when the user has actually sent you an image (e.g. by turning on live video or showing it to the camera). If the user asks "can you see the aspirin I'm holding?" or "what pill is this?" or "do you see the tablet?" and you have NOT received an image in this conversation, do NOT say yes or identify anything. Say clearly that you cannot see it and ask them to turn on the live video (or show the pill/bottle to the camera) so you can look. Never guess or assume what they are holding based on voice alone.
- When they have sent you an image of a pill or bottle, then identify it (for a pill: shape, color, and any letters or numbers on it; for a bottle: read the label). Match it to their schedule when possible.
- If they send an image of something that is clearly NOT a pill, tablet, or medicine bottle (e.g. a phone, pen, food, random object), identify what you see in a friendly way, then say that you need to see their medication to help—e.g. "That looks like [object]. Please show me your tablet or medicine bottle so I can help you with your medications."
- Use the current time and the time windows to say whether a pill is for "now" or for another time. If it is outside a slot's window (e.g. 3 AM and they ask about night pills), say that window has passed and what they should take in the next valid window.
- If they show a pill for a different time, tell them what the pill is, that it's for another time window, and what they should take right now instead (if within a window).
- If you are not sure what a pill or bottle is (after seeing an image), say so and suggest they check with their pharmacist or doctor."""


def build_system_instruction(
    schedule: dict[str, Any] | None,
    user_timezone: str | None = None,
) -> str:
    schedule_block = _format_schedule(schedule)
    time_block = _format_time_windows_and_current_time(schedule, user_timezone)
    return f"""{MEDMATE_PERSONA}

{time_block}

This person's medication schedule:
{schedule_block}

When answering "what do I take in the morning/afternoon/night?" use the schedule and time windows above. Only recommend taking a slot's meds if the current time is within that slot's window. When they show you a pill or bottle, compare it to this schedule and the current time."""


def get_access_token() -> str:
    creds, _ = google.auth.default()
    if not creds.valid:
        creds.refresh(google.auth.transport.requests.Request())
    return creds.token


async def run_live_proxy(
    client_ws: Any,
    elder_id: str,
    get_schedule_fn: Any,
    user_timezone: str | None = None,
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
    system_instruction = build_system_instruction(schedule, user_timezone)

    # Match official Google demo: snake_case (generation_config, response_modalities, etc.)
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
                            # Vertex may send JSON as a binary frame; decode and forward as text so client gets JSON with base64 audio
                            try:
                                msg = json.loads(raw.decode("utf-8"))
                                if msg.get("setupComplete") is not None:
                                    setup_done = True
                                sc = msg.get("serverContent") or msg.get("server_content")
                                if sc:
                                    mt = sc.get("modelTurn") or sc.get("model_turn")
                                    parts = (mt or {}).get("parts") or []
                                    has_audio = any(
                                        (p.get("inlineData") or p.get("inline_data") or {}).get("data")
                                        for p in parts
                                    )
                                    if has_audio:
                                        print("[MedMate] Audio in JSON (from binary frame): %d parts" % len(parts))
                                await client_ws.send_text(json.dumps(msg))
                            except (UnicodeDecodeError, json.JSONDecodeError):
                                pass  # skip non-JSON binary
                        else:
                            msg = json.loads(raw) if isinstance(raw, str) else raw
                            if msg.get("setupComplete") is not None:
                                setup_done = True
                            sc = msg.get("serverContent") or msg.get("server_content")
                            if sc:
                                mt = sc.get("modelTurn") or sc.get("model_turn")
                                parts = (mt or {}).get("parts") or []
                                has_audio = any(
                                    (p.get("inlineData") or p.get("inline_data") or {}).get("data")
                                    for p in parts
                                )
                                if has_audio:
                                    print("[MedMate] Audio in JSON: %d parts" % len(parts))
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
