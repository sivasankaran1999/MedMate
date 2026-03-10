#!/usr/bin/env bash
# Deploy MedMate frontend to Vercel (optional).
# Prerequisites: npm install -g vercel, and set NEXT_PUBLIC_BACKEND_URL to your Cloud Run URL.
# Usage: ./scripts/deploy-frontend.sh
# For other hosts (Firebase Hosting, etc.), build with: cd frontend && npm run build && export to static or deploy.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"

if ! command -v vercel &>/dev/null; then
  echo "Vercel CLI not found. Install with: npm install -g vercel"
  echo "Or build manually: cd frontend && npm run build && deploy the .next or out folder to your host."
  exit 1
fi

cd "$FRONTEND_DIR"
echo "Deploying frontend from $FRONTEND_DIR"
echo "Ensure NEXT_PUBLIC_BACKEND_URL is set (e.g. in .env.production or Vercel project env)."
vercel --prod
