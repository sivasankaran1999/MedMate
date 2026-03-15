#!/usr/bin/env bash
# Deploy MedMate backend to Cloud Run.
# Usage: ./scripts/deploy.sh [GCP_PROJECT_ID]
# Requires: gcloud CLI, Docker (or use gcloud builds submit).
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
SERVICE_NAME="${MEDMATE_SERVICE_NAME:-medmate-backend}"
REGION="${MEDMATE_REGION:-us-central1}"

# Project from arg or gcloud config
PROJECT_ID="${1:-$(gcloud config get-value project 2>/dev/null)}"
if [ -z "$PROJECT_ID" ]; then
  echo "Usage: $0 GCP_PROJECT_ID"
  echo "Or set default: gcloud config set project YOUR_PROJECT_ID"
  exit 1
fi

echo "Project: $PROJECT_ID"
echo "Service: $SERVICE_NAME"
echo "Region:  $REGION"

# Set project for this run
gcloud config set project "$PROJECT_ID"

# Build and deploy with Cloud Build (no local Docker required)
cd "$BACKEND_DIR"
ENV_VARS="GOOGLE_CLOUD_PROJECT=$PROJECT_ID"
# Optional: pass SMTP so caretaker emails work (set in your shell before running this script)
for v in SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD FROM_EMAIL; do
  if [ -n "${!v}" ]; then
    ENV_VARS="$ENV_VARS,$v=${!v}"
  fi
done

gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars "$ENV_VARS" \
  --port 8080

echo "Done. Backend URL: $(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)' 2>/dev/null || true)"
echo "Tip: If caretaker emails are not sent, set SMTP_HOST, SMTP_USER, SMTP_PASSWORD (and optionally SMTP_PORT, FROM_EMAIL) on this Cloud Run service (see README)."
