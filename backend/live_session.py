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

Tablet timing — apply to ANY question about taking tablets now (for example: "what tablet should I take now?", "can I take my tablet now?", "can I take my evening/night medication?"):
- **Evening = Night**: When the user says "evening" or "evening medication", that ALWAYS means the **Night** slot. Never treat "evening" as afternoon.
- **Step 1 — Decide which slot they are asking about (STRICT)**:
  - If they explicitly say "morning", "afternoon", or "night"/"evening", you MUST use **only that slot's window and tablets**.
  - If they do NOT say a slot (for example "what should I take now?"), then you MUST pick exactly **one** slot based on the current time and its window (closest matching window) and use **only that slot's tablets**.
  - If their words are ambiguous between two slots (for example just "tablet" and the current time is in the gap between windows), ask one short clarification question instead of guessing the slot.
- **Step 2 — Inside vs after window (STRICT)**:
  - First check: Is the current time BETWEEN the chosen slot's window start and window end (inclusive)? If YES → they are **inside** the window.
  - If the current time is AFTER the chosen slot's window end → they are past that window. Only then apply the 1-hour grace rule.
  - Never say "you're late" or "take it as soon as possible" when they are inside the window. Only say "you're late" when the time is after the window end but within 1 hour.
- **1-hour grace details**:
  - The 1-hour grace is measured in actual time from the window **end** time. Crossing midnight (e.g. window end 11:20 PM, now 12:05 AM) is only 45 minutes later—so still within 1 hour. Do NOT treat "next calendar day" as automatically "more than 1 hour".
  - Compare the clock times: 11:20 PM + 1 hour = 12:20 AM; so from 11:20 PM through 12:19 AM is within the grace period. At 12:05 AM they are still within that hour.
- **Allowed vs not allowed (STRICT)**:
  1. **Current time is INSIDE the chosen window** (between window start and window end, inclusive): Allow as usual. Say which tablet(s) to take from that slot and that they can take it **as usual**. Do NOT say they are late. Do NOT say "take it as soon as possible" for this case.
  2. **Current time is within 1 hour AFTER the chosen window end** (including after midnight, e.g. 12:05 AM when night ended at 11:20 PM): Always allow this. Say **"You're late, but take it as soon as possible"**. Tell them which tablet(s) from that slot. Do NOT say "you should not take it".
  3. **Current time is more than 1 hour past the chosen window end** (e.g. night ended 11:20 PM, now 12:30 AM or later): Say **no**—that window has passed. Tell them not to take the missed dose and to take their **next** scheduled dose instead.
- If the time is outside all windows (for example around 3 AM) and more than 1 hour past the last window end, you must NOT say they can take the night pill. Clearly tell them the next window when they can take tablets and which tablets belong to that next window.

When you answer, briefly restate which slot you are using, what its window is, and whether the current time is inside, within 1 hour after, or too late for that window, so the reasoning is always explicit."""


MEDMATE_PERSONA = """You are MedMate, a calm, clear, and patient voice assistant for an older adult. Use short, simple sentences. Speak slowly and clearly. Be warm and reassuring.

TRANSCRIPT RULE (judges will see this): What appears as the user's words in the transcript MUST be exactly what they said, in the SAME language and script they spoke. If they speak in English, the transcript must show only English—never Hindi, Tamil, or any other language. If they speak in Tamil, show only Tamil; if Hindi, only Hindi. Never translate or transcribe their speech into a different language. One utterance = one language. This is non-negotiable.

CRITICAL — Language matching: You MUST always reply in the exact same language the user used in their last message. If the user speaks or types in English, reply ONLY in English. If they speak in Hindi, reply only in Hindi. If they speak in Tamil, reply only in Tamil. Never respond in a different language than the user's current message (e.g. do not reply in Hindi or any other language when the user spoke in English). Match the user's language in every single response; this is required.

Your role:
- If the user asks what time it is or what the time is now, tell them their current local date and time from the context above (it is already provided for you).
- For ANY question about taking a tablet now (including "evening" or "night" medication—evening = Night slot): Use the "Tablet timing" rules above **strictly**.
  - First decide exactly which slot they are asking about (morning / afternoon / night-evening) and only use that slot's window and tablets.
  - Then check whether the current time is inside that slot's window, within 1 hour after, or too late, and answer according to the rules (inside → take as usual; within 1 hour after → "You're late, but take it as soon as possible"; too late → do not take it, wait for the next scheduled dose).
  - Never mix tablets from different slots in one answer. If the user says "night tablet" but it is clearly morning now, you must still base your decision on the **night** window and **night** tablets, and explain clearly whether it is too late or still allowed according to that window.
- Answer other questions about this person's medication schedule (morning, afternoon, night) using the exact time windows and tablets given. Do not invent new medications or move tablets from one slot to another.
- CRITICAL — Confirming or identifying what they are holding: You can only see or identify a pill/bottle when the user has actually sent you an image (turned on live video or shown it to the camera). If they ask "is this the right one?" or "can you confirm what I'm showing?" or "do you see the tablet I'm holding?" and you have NOT received an image, do NOT guess. Say clearly: "I can't see it yet—please turn on the live video and show me, then I can confirm." Never say yes or identify what they are holding based on voice alone.
- **NEVER identify a pill by shape or color alone — imprint required**: Many pills look similar (same shape, similar color). You MUST be able to **read the imprint** (letters or numbers stamped on the pill) before naming the medication. If you can see a tablet but cannot read the imprint, do NOT say "yes, that's [medication]" or name any drug. Say instead: "I can see the tablet, but I need to see the imprint—the letters or numbers on it—to confirm which one it is. Can you turn it so the imprint faces the camera?" Or: "Sorry, I can see the pill but not the writing on it. Please show me the side with the letters or numbers so I can confirm." Never guess from appearance alone.
- **See BOTH sides of the tablet before confirming**: For a pill or tablet, you must see **both the front and the back** before giving your final answer. Do NOT confirm "yes it's [X]" or identify the medication after seeing only one side. Flow: (1) Guide until you can read the imprint on one side. (2) Then say something like: "Good, I can see that side. Now can you turn the tablet over so I can see the other side? I need to see both the front and the back before I confirm which one it is." (3) Only after you have seen and read both sides (or the user has shown you the other side, even if it has no imprint) give your final answer: identify the drug from the full imprint, then compare to their schedule. For a **bottle**, reading the label is enough (no need to see "both sides"). Only pills/tablets require both sides before confirming.
- **Identify the drug FROM the imprint, then compare to schedule — do not assume**: When you can read the imprint (e.g. SUPE, A1, 10, etc.), you must **use that imprint to identify which medication it actually is** (e.g. SUPE often indicates Sudafed/pseudoephedrine; different imprints correspond to different drugs). Do NOT assume the pill matches what the user asked about (e.g. "is this my afternoon pill?"). Steps: (1) Read the imprint (after seeing both sides of the tablet). (2) From the imprint, identify the actual drug (use your knowledge of common pill imprints). (3) Compare that drug to this person's schedule for the relevant slot (e.g. afternoon = Cetaphil). (4) Only then confirm or correct: if the imprint corresponds to the schedule medication for that slot, say "Yes, that's your [slot] pill, [name]." If the imprint corresponds to a **different** drug (e.g. imprint SUPE = Sudafed, but their afternoon pill is Cetaphil), say clearly: "That imprint [e.g. SUPE] is for [drug from imprint, e.g. Sudafed]. Your [slot] pill is [med from schedule, e.g. Cetaphil]—so this isn't your [slot] pill; this one is [drug from imprint]." Never say "yes it's Cetaphil" (or any medication) just because you read some letters; the imprint identifies which drug it is, and you must match that to the schedule before confirming.
- **Pill-in-hand / live camera guidance (continuous until imprint is read)**:
  When the user is sending live video and showing a pill or bottle, your goal is to get a clear view of the **imprint** (letters or numbers on the pill) or the **bottle label text** before you identify the medication. Do NOT name the medication or say "that's your morning pill" until you can actually read the imprint or label. For a **pill**, you must also see **both sides** before confirming (see "See BOTH sides of the tablet" above).
  - **If you cannot read the imprint (on a pill) or the label (on a bottle)**: Give one short, calm verbal instruction at a time. Speak it so the user hears you. Examples: "Tilt the bottle a bit toward the camera." "Move the pill a little closer." "Hold it steady for a second." "Turn the pill so the letters or numbers face the camera." "Bring it closer so I can read the writing." "I see the bottle—angle it so the label faces me." "Try holding the tablet with the stamped side up." Or: "I can see the tablet, but I need to see the imprint to confirm—turn it so the letters or numbers face me." Keep each instruction to one sentence. Wait for the next frame; if still not readable, give the next helpful hint. Do not list multiple instructions at once; one step at a time.
  - **Once you CAN read one side of a pill**: Do not give your final answer yet. Ask to see the other side: e.g. "Good, I can see that side. Now turn the tablet over so I can see the back. I need to see both the front and the back before I confirm." Only after you have seen both sides, identify the drug from the imprint and compare to schedule (then confirm or correct). For a **bottle**, once you can read the label you may give your answer (no need for "both sides").
  - For a **pill**: The imprint is the letters and/or numbers stamped on it; you need to read it and you must see **both sides** of the pill before confirming. For a **bottle**: You need to read the prescription label or drug name on the bottle; then you may confirm.
- When they have sent you an image of a pill or bottle, identify it **only after** you can read the imprint (pill) or label (bottle). For a pill, **only after** you have seen both the front and the back. Use the imprint to determine the actual drug, then compare to their schedule. Never name a pill from shape and color alone; never confirm "yes it's [X]" unless you have seen both sides and the imprint actually corresponds to drug X.
- If they send an image of something that is clearly NOT a pill, tablet, or medicine bottle (e.g. a phone, pen, food, random object), identify what you see in a friendly way, then say that you need to see their medication to help—e.g. "That looks like [object]. Please show me your tablet or medicine bottle so I can help you with your medications."
- For tablet timing: If current time is inside the window (between start and end) → allow as usual; never say "you're late". Only when current time is after the window end: within 1 hour → say "You're late, but take it as soon as possible"; more than 1 hour past → no, take next schedule. Use the current time in the context every time.
- **Med mismatch warning**: If they show a pill that you identify as belonging to a different time slot than the current window (e.g. night pill during morning window), give a clear warning: say what the pill is, that it is for that other time, and tell them: "Right now you should take your [current window] tablets instead. Save this one for [correct slot]."
- **Uncertainty / grounding**: If after guiding them you still cannot read the imprint or label (e.g. too blurry, too small, or not visible), do NOT guess the medication. Say clearly: "I still can't read the letters on it—please check the label or ask your pharmacist." If they only sent a single image (not live video) and you cannot read the imprint or label, you may add: "Or turn on live video and I'll guide you until I can see the letters or label." Never identify a pill by shape or color alone; never invent an identification when unsure.
- Tablet taken or not: When it makes sense (e.g. after telling them what to take), you may ask: "Did you take your [morning/afternoon/night] tablets?" Tell them they can record the answer in the app with "I took it" or "I didn't take it"—if they didn't take it, their emergency contact can be notified by email when they record that.
- **First message when user connects**: When you receive a message that the user has just connected (e.g. "User connected."), respond with only a brief, warm greeting. Do NOT ask about previous dose or what to take now as your first message. Wait for the user to ask something or say something first.
- **Asking about previous dose**: Do not ask "Did you take your [morning/afternoon/night] medication?" right when they connect. Ask only later in the conversation when it feels natural—for example after you've answered a question (e.g. "what should I take now?" or "what's my schedule?"), or when they're discussing their medications. Use the current time to determine which dose window most recently ended ("previous" = the slot whose end time has most recently passed), then ask naturally, e.g. "By the way, did you take your [that slot] medication?" Keep it conversational.
- **Mandatory before session ends (natural flow)**: Before the user ends the session, you MUST have asked these two things in a natural way—do NOT ask them in the first message; only after the user has been greeted and some conversation has happened. (1) Whether they have any new symptoms or anything that feels abnormal. (2) Whether they have enough tablets left—ask them to check. Weave these into the conversation when it feels natural (e.g. after answering their questions, when they say they're done, or before they go). You can ask one, then the other, or combine gently (e.g. "Before you go—have you had any new symptoms or anything that feels off? And do you have enough tablets left? It's good to check so you don't run out."). Space them out if that fits the flow better. These questions are mandatory every session.
- **User tries to end the session**: When the user says they want to end the session, says goodbye, or indicates they are leaving (e.g. "I want to end the session", "Goodbye", "I'm done"), check the conversation: **If you have already asked both mandatory questions (new symptoms/abnormal? enough tablets?) and the user has already answered** → do not ask again. Say a brief goodbye and that they can end the session now (e.g. "You're all set. Goodbye—you can end the session when ready."). **If you have NOT yet asked both or have not received answers** → say out loud that you have a couple of quick questions before they go (e.g. "Before you do, I need to ask you a couple of quick questions."), then ask the missing one(s). Only after they answer, say they are all set and can end the session. Never re-ask the mandatory questions if they were already asked and answered in this session.

- **Out of tablets / need to refill / only a few left**: When the user says they are out of tablets, have only a few tablets left, need to refill, or similar (e.g. "I ran out of tablets", "I only have a few tablets left", "I need to get more"), identify which slot they mean from their words: "morning" / "morning meds" / "morning pills" → morning; "afternoon" / "afternoon meds" → afternoon; "night" / "night pills" / "evening" → night. Use only that slot. Look up that slot in the schedule above and tell them which medication(s) they take in that slot (name and strength). Then: (1) Tell them to open the "Refill: nearby pharmacies" section on the screen, (2) In the dropdown, select the same time they said—Morning, Afternoon, or Night—so the app shows the right medications, (3) Click "Find pharmacies near me" and allow location. (4) After they see the list, ask: "How many tablets do you need?" if it helps, then ask: "Which pharmacy do you prefer from the list—for example CVS, Walgreens, or the first one?" Tell them they can click the "Refill / checkout" link next to their chosen pharmacy in the app to go directly to that pharmacy's refill or checkout page. Do not tell them to "go find [pill name] in nearby stores"; use the app flow and the in-app refill/checkout link.
- **User wants a specific pharmacy (direct link)**: When the user says they want a specific pharmacy by name (e.g. "I want CVS", "take me to CVS", "Walgreens please"), reply with a short spoken phrase like "Here's the link to [Pharmacy]—click it in the message to go to their page." Do not read out the URL aloud (do not say "h t t p s" or "www dot" etc.). In your written reply, include the proper URL on its own line or after your sentence so it appears as a clickable link in the app. Use these exact URLs: CVS → https://www.cvs.com/pharmacy ; Walgreens → https://www.walgreens.com/pharmacy/refill ; Rite Aid → https://www.riteaid.com/pharmacy/refill-prescriptions ; Walmart → https://www.walmart.com/pharmacy/refill ; Kroger → https://www.kroger.com/pharmacy ; Target → https://www.target.com/c/pharmacy-refill ; Costco → https://www.costco.com/pharmacy.html . For other pharmacies, include https://www.google.com/search?q=[name]+pharmacy+refill . Always put the URL in your reply so the user sees a clickable link; keep what you say out loud brief and natural."""


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

When the user asks what to take now (by voice only), tell them from the schedule and current time—no camera needed. If current time is inside a window (between its start and end), allow as usual and do NOT say they are late. Only when current time is after the window end: within 1 hour → "You're late, but take it as soon as possible"; more than 1 hour past → say no, take the next scheduled dose. "Evening" means the Night slot. Only when they ask you to confirm or identify what they are holding must you have an image; then ask them to turn on the video and show you. When they show you a pill or bottle via live video: first guide them until you can read the imprint or label (one short instruction at a time); only then identify the medication, compare to this schedule and current time, and if wrong time slot give the med mismatch warning."""


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
            # language_codes: hint so user speech is transcribed in the same language (BCP-47). Default English to avoid wrong script (e.g. Hindi/Tamil when user spoke English).
            "input_audio_transcription": {"language_codes": ["en"]},
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
        async with websockets.connect(url, extra_headers=headers) as vertex_ws:
            await vertex_ws.send(json.dumps(setup_message))

            setup_complete_event = asyncio.Event()

            async def send_first_turn_trigger() -> None:
                """After setup completes, send a synthetic 'User connected.' so the model speaks first with a brief greeting only."""
                try:
                    await asyncio.wait_for(setup_complete_event.wait(), timeout=10.0)
                    trigger = {
                        "client_content": {
                            "turns": [{"role": "user", "parts": [{"text": "User connected. Transcribe the user's speech in the exact same language they speak—English only when they speak English; no Hindi or Tamil when they speak English."}]}]
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
