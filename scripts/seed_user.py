#!/usr/bin/env python3
"""
Create a demo user for sign-in. Links the user to an existing elder (run seed_elder.py first).
Usage (from repo root):
  GOOGLE_CLOUD_PROJECT=your-project PYTHONPATH=backend python scripts/seed_user.py [email] [password]
Or from backend dir:
  GOOGLE_CLOUD_PROJECT=... python -c "import sys; sys.path.insert(0, '.'); from scripts.seed_user import main; main()"
Default: demo@medmate.local / medmate123
"""
import os
import sys

_here = os.path.dirname(os.path.abspath(__file__))
_backend = os.path.join(_here, "..", "backend")
if _backend not in sys.path:
    sys.path.insert(0, _backend)

from firestore_client import create_user

DEFAULT_EMAIL = "demo@medmate.local"
DEFAULT_PASSWORD = "medmate123"
DEFAULT_ELDER_ID = "elder-demo"


def main() -> None:
    email = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_EMAIL
    password = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_PASSWORD
    elder_id = os.environ.get("ELDER_ID", DEFAULT_ELDER_ID)
    if not os.environ.get("GOOGLE_CLOUD_PROJECT"):
        print("Set GOOGLE_CLOUD_PROJECT", file=sys.stderr)
        sys.exit(1)
    create_user(email, password, elder_id, display_name="Demo User")
    print(f"Created user: {email} -> elder_id={elder_id}")


if __name__ == "__main__":
    main()
