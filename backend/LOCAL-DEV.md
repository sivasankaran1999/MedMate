# Local dev: backend + Firestore

You **do not download anything**. `gcloud auth application-default login` saves credentials on your machine (in `~/.config/gcloud/application_default_credentials.json`). The backend must run in a terminal that “sees” that file — i.e. start it from the **same terminal** where you ran the gcloud command (or run the check script below first in that terminal).

## Steps (do in order)

1. **Sign in with Google (once per machine):**
   ```bash
   gcloud auth application-default login
   ```
   Use the same Google account that has access to the MedMate Firestore project. Complete the browser sign-in. No download — credentials are stored locally.

2. **Verify credentials (same terminal):**
   ```bash
   cd /path/to/MedMate/backend
   ../.venv/bin/python check_credentials.py
   ```
   (Use the project’s venv so `google.cloud` is available.)
   If it says "OK — Firestore is reachable", you’re good. If it fails, it will tell you what to fix (e.g. run gcloud again, or get access to the project).

3. **Start the backend in that same terminal:**
   ```bash
   ../.venv/bin/uvicorn main:app --reload --host 0.0.0.0 --port 8080
   ```
   Do **not** start the backend from Cursor/VS Code “Run” or another terminal — use the one where you ran step 1 (and step 2).

4. **Start the frontend** (in another terminal):
   ```bash
   cd /path/to/MedMate/frontend
   npm run dev
   ```

5. Open **http://localhost:3000** and sign in or create an account.

---

- Keep **GOOGLE_APPLICATION_CREDENTIALS** unset (or commented out) in `.env` when using this flow.
- If login still fails: run `python check_credentials.py` in the same terminal you use for the backend and fix whatever it reports.
