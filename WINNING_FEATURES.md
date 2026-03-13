# Winning Feature Ideas — Live Agents Category

**Goal:** Add one or two features that are **not** already in MedMate and that strongly impress judges for **Innovation & Multimodal UX (40%)** and **Technical (30%)**.

---

## Judging (reminder)

| Criterion | Weight | What judges look for |
|-----------|--------|----------------------|
| Innovation & Multimodal UX | 40% | Beyond text, see/hear/speak, live & context-aware, barge-in, persona |
| Technical | 30% | GenAI SDK/ADK, GCP, robust logic, error handling, grounding |
| Demo | 30% | Real software, clear architecture, GCP proof, problem/solution |

---

## 🏆 Flagship: Proactive “Time to take your pills” (agent initiates)

**What it is:** The agent **initiates** the conversation at medication time instead of only reacting. Same Live API session, but you add a **proactive trigger** (scheduled or user-requested).

**Why it wins:**
- Most demos are **reactive** (user speaks first). Proactive + voice is a clear differentiator.
- Uses the **same** Gemini Live API + Firestore; no new category, just new UX.
- Strong “real-world” story: “MedMate doesn’t just answer—it reaches out at the right time.”

**How it could work:**
1. **Option A (demo-friendly):** In the UI, add a “Remind me in 1 minute” (or “Simulate 8am reminder”) that, when clicked, causes the backend to **inject a synthetic “reminder” turn** into the Live session (e.g. server sends a short text/audio cue to the model so the **agent speaks first**): “It’s time for your morning medications. Have you taken Lisinopril and Vitamin D?” Elder can then reply by voice or show pills.
2. **Option B (full):** Backend subscribes to Firestore or a Cloud Scheduler job; when “now” falls in a medication window for an elder who has an active session (or you use a “wake” flow), backend triggers the same “agent speaks first” flow.

**Technical:** Same WebSocket/Live API; backend sends an initial server-side “reminder” message (or a scheduled prompt) so the **first thing the user hears** is the agent. No new APIs—just who speaks first.

**Demo script:** “Watch—MedMate doesn’t wait for you to remember. At 8am it says, ‘Good morning, it’s time for your morning pills. Have you taken them?’ I can say yes, or show the pills. And I can still interrupt anytime.”

---

## 🥈 Strong runner-up: Prescription / doctor note verification (vision)

**What it is:** User **shows a prescription slip, doctor’s note, or discharge sheet** (photo). Agent compares it to the **stored schedule** and says in plain language: “This matches your schedule,” or “Your doctor added once-daily Aspirin; your current schedule doesn’t include it—you may want to add it or confirm with your pharmacist.”

**Why it wins:**
- Uses **vision** you already have; no new modality.
- Solves a **complex, real problem**: bridging doctor instructions ↔ home schedule (medication safety).
- Fits “vision-enabled” and “solves complex problems” in the Live Agents category.

**How:** Extend the system prompt: when the user sends an image that looks like a prescription/note (or user says “I’m showing my prescription”), agent must (1) read medication names/doses/frequency from the image, (2) compare to the elder’s schedule, (3) respond in short, calm sentences with match/mismatch and one suggested action. Optional: store “last verified prescription” in Firestore for “Did my schedule change?” later.

**Demo script:** “I just got home from the doctor. I show MedMate my prescription—it reads it and says, ‘This matches your current schedule,’ or ‘Your doctor added Aspirin; consider adding it to your evening list.’ All by voice and one photo.”

---

## 🥉 Third: Live language switch (“Speak in Tamil / Spanish”)

**What it is:** User says “Speak in Tamil” or “From now on, Spanish.” Agent **switches language** for the rest of the session without reconnecting. Same persona (calm, short sentences), different language.

**Why it wins:**
- **Inclusive**, easy to demo, and very visible to judges.
- Shows Live API’s **conversation continuity** (context preserved across the switch).
- Minimal backend change: one line in system instruction: “If the user asks to speak in [language], switch to that language for all subsequent replies.”

**How:** System instruction already has persona; add: “If the user requests a language (e.g. ‘Speak in Tamil’, ‘In Spanish please’), acknowledge and use that language for all following responses until they ask for another language or English.”

**Demo script:** “My mother prefers Tamil. She says ‘Speak in Tamil’—and MedMate continues the same conversation in Tamil. Still interruptible, still the same schedule and pill-check.”

---

## Fourth: Gentle emotional check-in + soft escalation

**What it is:** After answering a medication question, agent **optionally** asks: “How are you feeling today?” If the user says something concerning (e.g. “dizzy,” “slept badly,” “confused”), agent responds with a **short, safe** line: “That could be related to your medications or something else. Would you like me to remind you to mention this to your doctor or a family member?” No diagnosis—just gentle nudge to seek human care.

**Why it wins:**
- Shows **care**, not just information—differentiates from “pill identifier” tools.
- Stays within Live Agents (voice, same session, interruptible).
- Easy to add: a few lines in the system prompt + rule: never diagnose, only suggest talking to doctor/family.

**Demo script:** “After we’re done with the pills, MedMate asks how I’m feeling. I say ‘a bit dizzy.’ It says, ‘That might be worth mentioning to your doctor or family.’ One sentence—no diagnosis, just care.”

---

## Fifth: “What did I take this week?” (voice-first adherence summary)

**What it is:** User asks: “Did I miss any doses this week?” or “What did I take this week?” Agent uses **dose confirmations** from Firestore (you already have `record_dose_confirmation`) to answer in one or two short sentences by voice.

**Why it wins:**
- Uses **existing** Firestore data; new UX layer only.
- Shows **context-aware** live agent (past behavior + schedule).

**How:** When building the system prompt, optionally load a short “adherence summary” (e.g. “In the last 7 days: morning taken 6/7, afternoon 7/7, night 5/7”). Add to context; instruct agent to use it only when user asks about missed doses or weekly summary. If no data, agent says “I don’t have that information yet; you can confirm when you take your pills and I’ll remember.”

**Demo script:** “I ask, ‘Did I miss any doses this week?’ MedMate says, ‘You took morning and afternoon every day; you missed night twice.’ All from our live confirmations.”

---

## Recommendation for maximum impact

1. **Implement the flagship: Proactive “Time to take your pills.”**  
   Use **Option A** for the demo: a “Simulate reminder” / “Remind me in 1 minute” button that makes the agent speak first. Easy to build, huge impact in the 4-minute video and in-person demo.

2. **If you have time, add one of:**  
   - **Prescription verification** (vision + schedule comparison), or  
   - **Live language switch** (“Speak in Tamil”), or  
   - **Emotional check-in** (“How are you feeling?” + soft escalation).

3. **In the pitch and demo:**  
   Lead with: “Unlike one-time scan tools, MedMate is a **live companion**: you can interrupt anytime, show pills anytime—and **it can reach out at medication time** so you don’t have to remember to ask.”

---

## What not to add (already covered)

- Barge-in, voice in/out, show pill/bottle, wrong-time handling, both-sides-of-pill, refill/pharmacy links, per-elder schedule, dose confirmation API—all already in place. The ideas above **add** on top of these without duplicating.
