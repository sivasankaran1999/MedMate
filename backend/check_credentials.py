#!/usr/bin/env python3
"""
Run this in the SAME terminal where you start the backend (after gcloud auth application-default login).
It checks why Firestore login might be failing. No download needed — ADC is stored on your machine.
"""
from pathlib import Path
import os
import sys

# Load .env like main.py does
_backend_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(_backend_dir))
try:
    from dotenv import load_dotenv
    load_dotenv(_backend_dir / ".env")
    load_dotenv(_backend_dir / ".env.example")
except ImportError:
    pass

def main():
    print("=== MedMate credential check ===\n")

    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    key_file = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")

    print(f"1. GOOGLE_CLOUD_PROJECT: {repr(project) if project else 'NOT SET (set in .env)'}")
    if not project:
        print("   -> Fix: set GOOGLE_CLOUD_PROJECT in backend/.env\n")
        return 1

    # Where gcloud auth application-default login writes credentials (no download)
    home = os.path.expanduser("~")
    adc_path = os.path.join(home, ".config", "gcloud", "application_default_credentials.json")
    print(f"2. Application Default Credentials (from 'gcloud auth application-default login'):")
    if key_file:
        print(f"   GOOGLE_APPLICATION_CREDENTIALS is set to: {key_file}")
        print(f"   File exists: {os.path.isfile(key_file)}")
    else:
        print(f"   Expected path: {adc_path}")
        print(f"   File exists: {os.path.isfile(adc_path)}")
        if not os.path.isfile(adc_path):
            print("   -> Fix: run in this terminal:  gcloud auth application-default login")
            print("   Then run this script again with:  ../.venv/bin/python check_credentials.py")
            print("   Then start the backend in this same terminal.\n")
            return 1

    print("\n3. Testing Firestore connection (timeout 15s)...")
    try:
        from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
        try:
            from google.cloud import firestore
        except ImportError:
            print("   FAILED: google-cloud-firestore not installed.")
            print("   -> Fix: pip install google-cloud-firestore  (or: pip install -r backend/requirements.txt)\n")
            return 1

        def _test():
            db = firestore.Client(project=project)
            db.collection("users").limit(1).get()

        with ThreadPoolExecutor(max_workers=1) as ex:
            f = ex.submit(_test)
            try:
                f.result(timeout=15)
            except FuturesTimeoutError:
                print("   FAILED: Timed out after 15 seconds (auth or Firestore connection).")
                print("\n   Common causes:")
                print("   - Firestore not enabled: https://console.cloud.google.com/firestore (select project, create DB if needed).")
                print("   - Network blocking Google: try another Wi‑Fi, or turn VPN off, then run this script again.")
                print("   - Credential refresh hanging: same terminal + same network as when you ran gcloud auth application-default login.\n")
                return 1
        print("   OK — Firestore is reachable. Login should work if you start the backend here.\n")
        return 0
    except Exception as e:
        print(f"   FAILED: {e}")
        print("\n   Common causes:")
        print("   - Run 'gcloud auth application-default login' in THIS terminal, then run this script again.")
        print("   - If you use Cursor/VS Code 'Run', start the backend from a terminal instead (same one where you ran gcloud).")
        print("   - Your Google account may not have access to this project; ask the project owner to add your email.")
        print("   - Firestore might not be enabled: https://console.cloud.google.com/firestore\n")
        return 1

if __name__ == "__main__":
    sys.exit(main())
