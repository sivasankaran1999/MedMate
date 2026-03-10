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
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=$PROJECT_ID" \
  --port 8080

echo "Done. Backend URL: $(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)' 2>/dev/null || true)"
