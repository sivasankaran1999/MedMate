# Firestore schema (MedMate)

## Collection: `elders`

Document ID = elder ID (e.g. `elder-001`, or a stable user identifier).

| Field         | Type   | Description                                      |
|---------------|--------|--------------------------------------------------|
| `schedule`    | map    | **Required.** Keys: `morning`, `afternoon`, `night`. |
| `schedule.morning`   | array | List of meds: `{ "name": string, "strength"?: string }` |
| `schedule.afternoon`| array | Same structure.                                 |
| `schedule.night`     | array | Same structure.                                 |
| `displayName` | string | Optional. Display name for the elder.           |
| `language`    | string | Optional. Preferred language (e.g. `en`).       |

### Example document

```json
{
  "schedule": {
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
