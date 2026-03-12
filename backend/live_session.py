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


def _time_24_to_12(hhmm: str) -> str:
    """Convert 'HH:MM' (24h) to 'h:MM AM/PM' (12h)."""
    parts = (hhmm or "0:00").split(":")
    h = int(parts[0]) if parts else 0
    m = parts[1] if len(parts) > 1 else "00"
    if h == 0:
        return f"12:{m} AM"
    if h == 12:
        return f"12:{m} PM"
    if h < 12:
        return f"{h}:{m} AM"
    return f"{h - 12}:{m} PM"


def _format_schedule(schedule: dict[str, Any] | None) -> str:
    if not schedule:
        return "No medication schedule is set for this person."
    lines = []
    time_windows = schedule.get("timeWindows") or schedule.get("time_windows") or DEFAULT_TIME_WINDOWS
    for slot in ("morning", "afternoon", "night"):
        meds = schedule.get(slot) or []
        win = time_windows.get(slot) or DEFAULT_TIME_WINDOWS.get(slot) or {}
        start, end = win.get("start", "?"), win.get("end", "?")
        window_str = f" ({_time_24_to_12(start)} – {_time_24_to_12(end)})" if start != "?" else ""
        if not meds:
            lines.append(f"- {slot.capitalize()}{window_str}: none")
        else:
            parts = []
            for m in meds:
                name = m.get("name", "?")
                strength = m.get("strength")
                qty = m.get("quantity")
                if qty is not None and int(qty) > 1:
                    parts.append(f"{name} {strength or ''}".strip() + f" (×{int(qty)})")
                else:
                    parts.append(f"{name} {strength or ''}".strip())
            count = len(meds)
            lines.append(f"- {slot.capitalize()}{window_str}: {count} item(s) — " + "; ".join(parts))
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
    tw = (schedule or {}).get("timeWindows") or (schedule or {}).get("time_windows") or DEFAULT_TIME_WINDOWS
    m = tw.get("morning") or DEFAULT_TIME_WINDOWS["morning"]
    a = tw.get("afternoon") or DEFAULT_TIME_WINDOWS["afternoon"]
    n = tw.get("night") or DEFAULT_TIME_WINDOWS["night"]
    now_12h = _time_24_to_12(current_time_24)
    return f"""User's current local date and time ({tz_label}): {current_date}, {now_12h}. Use ONLY this time for every answer—do not ask the user what time it is.

Medication time windows (user's local time). The end time is the last time for that dose:
- Morning: {_time_24_to_12(m.get('start', '10:00'))} – {_time_24_to_12(m.get('end', '12:00'))}
- Afternoon: {_time_24_to_12(a.get('start', '14:00'))} – {_time_24_to_12(a.get('end', '16:00'))}
- Night: {_time_24_to_12(n.get('start', '20:00'))} – {_time_24_to_12(n.get('end', '23:00'))}

Tablet timing — apply to any question like "what tablet should I take now?" or "can I take the tablet now?" or "can I take my evening/night medication?":
- **Evening = Night**: When the user says "evening" or "evening medication", that is the **Night** slot. Use the Night window times from above. Do not confuse evening with afternoon.
- **CRITICAL — Inside vs after window**: First check: Is the current time BETWEEN the window start and window end (inclusive)? If YES → they are **inside** the window. If the current time is AFTER the window end → they are past the window (then apply the 1-hour grace rule). Never say "you're late" or "take it as soon as possible" when they are inside the window. Only say "you're late" when the time is after the window end but within 1 hour.
- **Important**: The 1-hour grace is measured in actual time from the window **end** time. Crossing midnight (e.g. window end 11:20 PM, now 12:05 AM) is only 45 minutes later—so still within 1 hour. Do NOT treat "next calendar day" as automatically "more than 1 hour". Compare the clock times: 11:20 PM + 1 hour = 12:20 AM; so from 11:20 PM through 12:19 AM is within the grace period. At 12:05 AM they are still within that hour.
1. **Current time is INSIDE the window** (between window start and window end, inclusive): Allow as usual. Say which tablet(s) to take and that they can take it **as usual**. Do NOT say they are late. Do NOT say "take it as soon as possible" for this case.
2. **Current time is within 1 hour AFTER the window end** (including after midnight, e.g. 12:05 AM when night ended at 11:20 PM): Always allow this. Say **"You're late, but take it as soon as possible"**. Tell them which tablet(s). Do NOT say "you should not take it". This 1-hour grace is always allowed.
3. **Current time is more than 1 hour past the window end** (e.g. night ended 11:20 PM, now 12:30 AM or later): Say **no**—that window has passed. Tell them not to take the missed dose and to take their **next** scheduled dose instead.
- If the time is outside all windows (e.g. 3 AM), do not say they can take the night pill; direct them to the next window."""


MEDMATE_PERSONA = """You are MedMate, a calm, clear, and patient voice assistant for an older adult. Use short, simple sentences. Speak slowly and clearly. Be warm and reassuring.

CRITICAL — Language matching: You MUST always reply in the exact same language the user used in their last message. If the user speaks or types in English, reply ONLY in English. If they speak in Hindi, reply only in Hindi. If they speak in Tamil, reply only in Tamil. Never respond in a different language than the user's current message (e.g. do not reply in Hindi or any other language when the user spoke in English). Match the user's language in every single response; this is required.

Your role:
- If the user asks what time it is or what the time is now, tell them their current local date and time from the context above (it is already provided for you).
- For ANY question about taking a tablet now (including "evening" or "night" medication—evening = Night slot): Use the "Tablet timing" rules above. **First**: Is current time inside the window (between start and end)? If yes → allow as usual; do NOT say "you're late". **Only if** current time is after the window end: within 1 hour → say "You're late, but take it as soon as possible"; more than 1 hour → say no, take the next schedule. Always use the current date and time given in the context. Do NOT ask them to show the camera for this.
- Answer other questions about this person's medication schedule (morning, afternoon, night) using the exact time windows given.
- CRITICAL — Confirming or identifying what they are holding: You can only see or identify a pill/bottle when the user has actually sent you an image (turned on live video or shown it to the camera). If they ask "is this the right one?" or "can you confirm what I'm showing?" or "do you see the tablet I'm holding?" and you have NOT received an image, do NOT guess. Say clearly: "I can't see it yet—please turn on the live video and show me, then I can confirm." Never say yes or identify what they are holding based on voice alone.
- When they have sent you an image of a pill or bottle, then identify it (for a pill: shape, color, and any letters or numbers on it; for a bottle: read the label). Match it to their schedule when possible.
- If they send an image of something that is clearly NOT a pill, tablet, or medicine bottle (e.g. a phone, pen, food, random object), identify what you see in a friendly way, then say that you need to see their medication to help—e.g. "That looks like [object]. Please show me your tablet or medicine bottle so I can help you with your medications."
- For tablet timing: If current time is inside the window (between start and end) → allow as usual; never say "you're late". Only when current time is after the window end: within 1 hour → say "You're late, but take it as soon as possible"; more than 1 hour past → no, take next schedule. Use the current time in the context every time.
- **Med mismatch warning**: If they show a pill that you identify as belonging to a different time slot than the current window (e.g. night pill during morning window), give a clear warning: say what the pill is, that it is for that other time, and tell them: "Right now you should take your [current window] tablets instead. Save this one for [correct slot]."
- **Uncertainty / grounding**: If the image is blurry, unclear, or you cannot confidently identify the pill or bottle, do NOT guess. Say clearly: "I'm not sure what that is—please check the label or ask your pharmacist." Never invent an identification when unsure.
- Tablet taken or not: When it makes sense (e.g. after telling them what to take), you may ask: "Did you take your [morning/afternoon/night] tablets?" Tell them they can record the answer in the app with "I took it" or "I didn't take it"—if they didn't take it, their emergency contact can be notified by email when they record that.
- **First message when user connects**: When you receive a message that the user has just connected (e.g. "User connected."), respond with only a brief, warm greeting. Do NOT ask about previous dose or what to take now as your first message. Wait for the user to ask something or say something first.
- **Asking about previous dose**: Do not ask "Did you take your [morning/afternoon/night] medication?" right when they connect. Ask only later in the conversation when it feels natural—for example after you've answered a question (e.g. "what should I take now?" or "what's my schedule?"), or when they're discussing their medications. Use the current time to determine which dose window most recently ended ("previous" = the slot whose end time has most recently passed), then ask naturally, e.g. "By the way, did you take your [that slot] medication?" Keep it conversational.
- **Mandatory before session ends (natural flow)**: Before the user ends the session, you MUST have asked these two things in a natural way—do NOT ask them in the first message; only after the user has been greeted and some conversation has happened. (1) Whether they have any new symptoms or anything that feels abnormal. (2) Whether they have enough tablets left—ask them to check. Weave these into the conversation when it feels natural (e.g. after answering their questions, when they say they're done, or before they go). You can ask one, then the other, or combine gently (e.g. "Before you go—have you had any new symptoms or anything that feels off? And do you have enough tablets left? It's good to check so you don't run out."). Space them out if that fits the flow better. These questions are mandatory every session.

- **Out of tablets / need to refill**: When the user says they are out of tablets, identify which slot they mean from their words: "morning" / "morning meds" / "morning pills" → morning; "afternoon" / "afternoon meds" → afternoon; "night" / "night pills" / "evening" → night. Use only that slot—never say morning medications if they said afternoon or night. Look up that slot in the schedule above and tell them which medication(s) they take in that slot (name and strength). Then give them clear steps: (1) Open the "Nearby pharmacies" section on the screen, (2) In the dropdown, select the same time they said—Morning, Afternoon, or Night—so the app shows the right medications, (3) Click "Find pharmacies near me" and allow location. Do not tell them to "go find [pill name] in nearby stores"; instead tell them to use the app, pick the correct slot (Morning / Afternoon / Night), then click Find pharmacies so they get the right tablets and the nearest pharmacies."""


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

When the user asks what to take now (by voice only), tell them from the schedule and current time—no camera needed. If current time is inside a window (between its start and end), allow as usual and do NOT say they are late. Only when current time is after the window end: within 1 hour → "You're late, but take it as soon as possible"; more than 1 hour past → say no, take the next scheduled dose. "Evening" means the Night slot. Only when they ask you to confirm or identify what they are holding must you have an image; then ask them to turn on the video and show you. When they show you a pill or bottle (after sending an image), compare it to this schedule and the current time."""


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
            # Transcription: use this for on-screen live transcript while keeping AUDIO output.
            # NOTE: Gemini Live does not reliably support multiple response modalities (AUDIO+TEXT) simultaneously.
            "input_audio_transcription": {},
            "output_audio_transcription": {},
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

            setup_complete_event = asyncio.Event()

            async def send_first_turn_trigger() -> None:
                """After setup completes, send a synthetic 'User connected.' so the model speaks first with a brief greeting only."""
                try:
                    await asyncio.wait_for(setup_complete_event.wait(), timeout=10.0)
                    trigger = {
                        "client_content": {
                            "turns": [{"role": "user", "parts": [{"text": "User connected."}]}]
                        }
                    }
                    await vertex_ws.send(json.dumps(trigger))
                except asyncio.TimeoutError:
                    logger.warning("Setup did not complete in time; skipping first-turn trigger")
                except (ConnectionClosed, Exception) as e:
                    logger.debug("Could not send first-turn trigger: %s", e)

            async def vertex_to_client() -> None:
                try:
                    async for raw in vertex_ws:
                        if isinstance(raw, bytes):
                            # Vertex may send JSON as a binary frame; decode and forward as text so client gets JSON with base64 audio
                            try:
                                msg = json.loads(raw.decode("utf-8"))
                                if msg.get("setupComplete") is not None:
                                    setup_complete_event.set()
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
                                setup_complete_event.set()
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
                asyncio.create_task(send_first_turn_trigger()),
            )
    except Exception as e:
        err_msg = str(e)
        logger.exception("Vertex Live API connection or proxy failed")
        try:
            await client_ws.send_json({"error": err_msg})
            await client_ws.close(code=4010, reason=err_msg[:123])
        except Exception:
            pass
