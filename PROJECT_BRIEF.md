# MedMate for Elders — Project Brief

**Hackathon:** [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/)  
**Deadline:** March 16, 2026 @ 5:00 PM PDT  
**Category:** Live Agents

---

## One-line pitch

Voice-first, vision-aware companion for elders: talk naturally, show pill bottles anytime, interrupt anytime. Built with Gemini Live API / ADK on Google Cloud.

---

## Must-have features (for winning demo)

1. **Voice in / voice out** — User talks to MedMate naturally.
2. **Vision** — User can show a pill bottle (camera/screenshot); agent sees and explains (e.g. “What’s this pill?”, “How do I take it?”).
3. **Barge-in (interruptions)** — User can interrupt mid-response (e.g. “Wait, what about the blue one?”); agent handles gracefully.
4. **Distinct persona** — Calm, clear, patient, simple language; short sentences.
5. **Backend on Google Cloud** — e.g. Cloud Run + Firestore (or Vertex AI); prove in demo.

---

## Mandatory tech

- **Gemini model** — Core reasoning + vision.
- **Gemini Live API or ADK** — Real-time voice, barge-in, low latency.
- **Google Cloud** — At least one service (Cloud Run, Vertex AI, Firestore, etc.); backend hosted on GCP.

→ **Concrete stack:** [TECH_STACK.md](./TECH_STACK.md) (Vertex AI Live API, Cloud Run, Firestore, Next.js/React).

---

## Submission checklist

- [ ] Public code repo with **README** (spin-up / run instructions).
- [ ] **Proof of GCP deployment** — Short recording or code link showing backend on Google Cloud.
- [ ] **Architecture diagram** — Gemini ↔ backend ↔ DB ↔ frontend.
- [ ] **Demo video** (<4 min, English): real software, show pill bottle once, one interruption, problem + solution + architecture.
- [ ] Optional: GDG profile, automated deployment (e.g. script/IaC in repo), one blog/video with #GeminiLiveAgentChallenge.

---

## Judging (reminder)

- **40%** Innovation & Multimodal UX — Beyond text, see/hear/speak, live & context-aware, barge-in, persona.
- **30%** Technical — GenAI SDK or ADK, GCP, robust logic, error handling, grounding.
- **30%** Demo — Real software, clear architecture, GCP proof, clear problem/solution.

---

## Differentiators vs existing products

- **ClearRx** etc. are scan-then-listen. MedMate = **live conversation**, **show anytime**, **interrupt anytime** (Gemini Live / ADK).
- Emphasize in pitch: “Unlike one-time scan tools, MedMate is a live companion you can interrupt and show pills to anytime.”

---

## Timeline

- **~7 days** from project start to deadline (Mar 16, 5pm PDT).
- Request GCP credits by **Mar 13, 12:00 PM PT** if needed: https://forms.gle/rKNPXA1o6XADvQGb7

---

*Open this file in Cursor when working in the MedMate workspace for full context.*
