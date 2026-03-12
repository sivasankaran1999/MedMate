#!/bin/bash
# Run this in YOUR terminal (after: gcloud auth application-default login)
# so the backend can use your Google credentials for sign-in.
cd "$(dirname "$0")"
echo "Starting backend on http://localhost:8080 ..."
exec ../.venv/bin/uvicorn main:app --reload --host 0.0.0.0 --port 8080
