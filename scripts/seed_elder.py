#!/usr/bin/env python3
"""
Seed one test elder in Firestore for demo.
Usage (from repo root):
  GOOGLE_CLOUD_PROJECT=your-project GOOGLE_APPLICATION_CREDENTIALS=path/to/key.json \\
  python scripts/seed_elder.py [elder_id]
Default elder_id: elder-demo
"""
import os
import sys

# Add backend to path so we can import firestore_client
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from firestore_client import set_elder_schedule

DEFAULT_ELDER_ID = "elder-demo"

SCHEDULE = {
    "morning": [
        {"name": "Lisinopril", "strength": "10 mg"},
        {"name": "Vitamin D"},
    ],
    "afternoon": [],
    "night": [
        {"name": "Metformin", "strength": "500 mg"},
        {"name": "Aspirin", "strength": "81 mg"},
    ],
}


def main() -> None:
    elder_id = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_ELDER_ID
    if not os.environ.get("GOOGLE_CLOUD_PROJECT"):
        print("Set GOOGLE_CLOUD_PROJECT", file=sys.stderr)
        sys.exit(1)
    set_elder_schedule(elder_id, SCHEDULE, display_name="Demo Elder", language="en")
    print(f"Seeded elder: {elder_id}")


if __name__ == "__main__":
    main()
