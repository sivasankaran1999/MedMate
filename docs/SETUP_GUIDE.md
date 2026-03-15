# MedMate — Step-by-step setup guide

This guide gets you from zero to a working MedMate: backend on Cloud Run, frontend pointing to it, and caretaker emails enabled.

---

## Prerequisites

- **Google Cloud account** (with billing enabled for the project)
- **Node.js** 20+ and **npm** (for frontend)
- **Google Cloud SDK (gcloud)** installed and logged in:  
  [Install gcloud](https://cloud.google.com/sdk/docs/install) then run:
  ```bash
  gcloud auth login
  gcloud auth application-default login
  ```
- **Gmail account** (or any SMTP provider) for sending caretaker emails

---

## Step 1: Create or select a GCP project

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing one. Note the **Project ID** (e.g. `my-medmate-project`).
3. Ensure billing is enabled for that project.

---

## Step 2: Enable required APIs

In Cloud Console, open **APIs & Services** → **Library** and enable:

- **Vertex AI API** — [Enable](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com)
- **Cloud Run API** — [Enable](https://console.cloud.google.com/apis/library/run.googleapis.com)
- **Firestore API** — [Enable](https://console.cloud.google.com/apis/library/firestore.googleapis.com)

Or from the terminal (replace `YOUR_PROJECT_ID`):

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud services enable aiplatform.googleapis.com run.googleapis.com firestore.googleapis.com
```

---

## Step 3: Create Firestore database

1. In Console go to **Firestore** → **Create database**.
2. Choose **Native mode**, pick a region (e.g. `us-central1`), then create.
3. (Optional) Start in **production** or **test** mode; you can adjust rules later.

---

## Step 4: Deploy the backend to Cloud Run

From your machine (repo root):

```bash
cd /path/to/MedMate
./scripts/deploy.sh YOUR_PROJECT_ID
```

- Replace `YOUR_PROJECT_ID` with your GCP project ID.
- The script builds the backend and deploys it to Cloud Run. When it finishes, it prints the **backend URL** (e.g. `https://medmate-backend-xxxxx-uc.a.run.app`). **Save this URL** — the frontend will need it.

Check health:

```bash
curl https://YOUR-BACKEND-URL.run.app/health
```

You should get `{"status":"ok"}` or similar.

---

## Step 5: Configure SMTP for caretaker emails (Cloud Run)

The backend sends session summaries and dose notifications only when SMTP is configured.

### 5a. Get a Gmail App Password (if using Gmail)

1. Use a Gmail account that will **send** the emails (can be a dedicated account like `medmate.notifications@gmail.com`).
2. Turn on **2-Step Verification** for that account: [Google Account → Security](https://myaccount.google.com/security).
3. Create an **App Password**: go to [App Passwords](https://myaccount.google.com/apppasswords), select “Mail” and your device, generate, and copy the **16-character password**.

### 5b. Set SMTP environment variables on Cloud Run

1. In [Cloud Console](https://console.cloud.google.com/) go to **Cloud Run**.
2. Click your service (e.g. `medmate-backend`).
3. Click **Edit & deploy new revision**.
4. Open the **Variables and secrets** tab → **Add variable** and add:

   | Name            | Value                          |
   |-----------------|--------------------------------|
   | `SMTP_HOST`     | `smtp.gmail.com`               |
   | `SMTP_PORT`     | `587`                          |
   | `SMTP_USER`     | Your sending Gmail address     |
   | `SMTP_PASSWORD` | The 16-character app password |
   | `FROM_EMAIL`    | Same as `SMTP_USER`            |

5. Click **Deploy**. Wait for the new revision to be live.

**Alternative:** Set the same variables in your shell and re-run the deploy script so they get passed into Cloud Run:

```bash
export SMTP_HOST=smtp.gmail.com
export SMTP_PORT=587
export SMTP_USER=your-sender@gmail.com
export SMTP_PASSWORD=your-16-char-app-password
export FROM_EMAIL=your-sender@gmail.com
./scripts/deploy.sh YOUR_PROJECT_ID
```

---

## Step 6: Seed a test elder and user (Firestore)

So you can log in and test:

From the repo root (replace project ID and email/password as you like):

```bash
export GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID
export PYTHONPATH=backend

# Create an elder with a sample medication schedule
python scripts/seed_elder.py elder-demo

# Create a user that links to that elder (email + password for login)
python scripts/seed_user.py demo@example.com yourpassword
```

- Default elder ID from `seed_elder.py` is `elder-demo` (or the ID you pass).
- Use the email and password from `seed_user.py` to log in from the frontend.

---

## Step 7: Run the frontend (point to Cloud Run)

1. Go to the frontend folder and copy the env example:
   ```bash
   cd frontend
   cp .env.example .env.local
   ```

2. Edit `frontend/.env.local` and set the backend URL to your **Cloud Run URL** (no trailing slash):
   ```
   NEXT_PUBLIC_BACKEND_URL=https://medmate-backend-xxxxx-uc.a.run.app
   ```
   Use the URL from Step 4.

3. Install and run:
   ```bash
   npm install
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser. Allow microphone (and camera if you’ll test “Show pill”).

---

## Step 8: Log in and set caretaker email

1. On the app, **log in** with the email and password you used in `seed_user.py` (e.g. `demo@example.com` / `yourpassword`).
2. Go to the **Settings** tab.
3. Under **Emergency & pharmacist contacts**, enter:
   - **Name:** e.g. “My Carer”
   - **Email:** the address that should receive session summaries and dose notifications (e.g. your personal email or the caretaker’s).
4. Click **Save contacts**. You should see “Saved”.

From now on, when this user ends a session (or records dose taken/not taken), the backend will send the email to that address — as long as SMTP is configured (Step 5).

---

## Step 9: Quick test

1. Start a **session** (e.g. **Start session** → **Start microphone**), have a short conversation, then **End session**.
2. Check the **caretaker inbox** (the email you set in Step 8). You should receive a short summary from the sender address you configured in Step 5.
3. (Optional) In Settings, use **Tablet taken?** → pick a slot → “I didn’t take it” and confirm the caretaker gets the dose notification email.

---

## Summary

| Step | What you did |
|------|------------------|
| 1    | GCP project created/selected |
| 2    | Vertex AI, Cloud Run, Firestore APIs enabled |
| 3    | Firestore database created (Native mode) |
| 4    | Backend deployed to Cloud Run; backend URL noted |
| 5    | SMTP env vars set on Cloud Run (sender = fixed) |
| 6    | Test elder + user seeded in Firestore |
| 7    | Frontend running locally with `NEXT_PUBLIC_BACKEND_URL` = Cloud Run URL |
| 8    | Logged in and saved caretaker email (recipient = per user) |
| 9    | Ended a session and verified caretaker received email |

- **Sender** = fixed (one Gmail/SMTP account on Cloud Run).  
- **Recipient** = dynamic (each user sets their caretaker email in the app).  
- All sending runs in the **hosted Cloud Run backend**.

For local backend development (and optional local SMTP), see the main [README](../README.md) “Spin-up (run locally)” and `backend/.env.example`.
