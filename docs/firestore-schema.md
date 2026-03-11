# Firestore schema (MedMate) — Hackathon database

We use **Google Cloud Firestore** as the database. This satisfies the hackathon requirement: *"Data: Firestore — Per-elder schedule: morning / afternoon / night meds."* We also store **users** (sign-in) and **time windows** so the agent knows when each slot applies (e.g. night = 8–11 PM, not 3 AM).

---

## Collections

### 1. `elders`

Stores each person’s medication schedule. Document ID = elder ID (e.g. `elder-demo`, `elder-001`).

| Field | Type | Description |
|-------|------|-------------|
| `schedule` | map | **Required.** Keys: `morning`, `afternoon`, `night`, optional `timeWindows`. |
| `schedule.morning` | array | Meds: `{ "name": string, "strength"?: string }` |
| `schedule.afternoon` | array | Same structure. |
| `schedule.night` | array | Same structure. |
| `schedule.timeWindows` | map | Optional. 24h windows: `morning` / `afternoon` / `night` → `{ "start": "HH:MM", "end": "HH:MM" }`. Defaults: morning 10:00–12:00, afternoon 14:00–16:00, night 20:00–23:00. |
| `displayName` | string | Optional. Display name. |
| `language` | string | Optional. e.g. `"en"`. |
| `lastKnownLocation` | map | Optional. `{ "lat", "lng", "updatedAt" }` for future use. |

**Example**

```json
{
  "schedule": {
    "timeWindows": {
      "morning": { "start": "10:00", "end": "12:00" },
      "afternoon": { "start": "14:00", "end": "16:00" },
      "night": { "start": "20:00", "end": "23:00" }
    },
    "morning": [
      { "name": "Lisinopril", "strength": "10 mg" },
      { "name": "Vitamin D" }
    ],
    "afternoon": [],
    "night": [
      { "name": "Metformin", "strength": "500 mg" },
      { "name": "Aspirin", "strength": "81 mg" }
    ]
  },
  "displayName": "Jane",
  "language": "en"
}
```

---

### 2. `users`

Stores sign-in credentials and links each user to an elder. Document ID = **normalized email** (lowercase).

| Field | Type | Description |
|-------|------|-------------|
| `email` | string | Same as document ID (normalized). |
| `password` | string | Demo: plain; production: use a secure hash. |
| `elder_id` | string | **Required.** References `elders/{elder_id}`. |
| `display_name` | string | Optional. Shown in UI after login. |

**Example**

```json
{
  "email": "demo@medmate.local",
  "password": "medmate123",
  "elder_id": "elder-demo",
  "display_name": "Demo User"
}
```

---

## How it’s used (hack flow)

1. **Sign-in:** Frontend calls `POST /auth/login` with email/password. Backend reads `users` by email, checks password, returns `elder_id` and `display_name`.
2. **Session:** Frontend opens WebSocket with `elder_id`. Backend loads `elders/{elder_id}` from Firestore and uses `schedule` (and `timeWindows`) to build the MedMate system prompt.
3. **Agent:** Vertex AI Live API gets current time + time windows + morning/afternoon/night meds, so it can answer “what do I take now?” and avoid saying “take night pill before bed” at 3 AM.

---

## Creating data

- **Elders:** `scripts/seed_elder.py` (creates/updates one elder with schedule + time windows).
- **Users:** `scripts/seed_user.py` (creates a user linked to an elder so that email/password can sign in).

Firestore must exist in your GCP project (Native mode, e.g. `us-central1`). Enable the Firestore API and grant your backend service account access to Firestore.
