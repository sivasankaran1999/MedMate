"""
Firestore access for MedMate elder schedules and users (auth).

Elders: collection "elders", document ID = elder ID.
  - schedule: { morning, afternoon, night, timeWindows?: { morning: {start,end}, ... } }
  - displayName?: str, language?: str

Users (sign-in): collection "users", document ID = normalized email (lowercase).
  - email: str, elder_id: str, display_name?: str, password: str (demo only; use hash in prod)
"""

from __future__ import annotations

import os
from typing import Any

from google.cloud import firestore

# Lazy client so we don't require credentials at import time
_db: firestore.Client | None = None


def _get_db() -> firestore.Client:
    global _db
    if _db is None:
        project = os.environ.get("GOOGLE_CLOUD_PROJECT")
        if not project:
            raise RuntimeError("GOOGLE_CLOUD_PROJECT is not set")
        _db = firestore.Client(project=project)
    return _db


def get_elder_schedule(elder_id: str) -> dict[str, Any] | None:
    """Load an elder document and return schedule (or full doc). Returns None if not found."""
    db = _get_db()
    doc = db.collection("elders").document(elder_id).get()
    if not doc.exists:
        return None
    data = doc.to_dict()
    return data.get("schedule") if data else None


def get_elder(elder_id: str) -> dict[str, Any] | None:
    """Load full elder document. Returns None if not found."""
    db = _get_db()
    doc = db.collection("elders").document(elder_id).get()
    if not doc.exists:
        return None
    return doc.to_dict()


def set_elder_schedule(
    elder_id: str,
    schedule: dict[str, Any],
    display_name: str | None = None,
    language: str | None = None,
) -> None:
    """Create or update an elder document with the given schedule."""
    db = _get_db()
    ref = db.collection("elders").document(elder_id)
    data: dict[str, Any] = {"schedule": schedule}
    if display_name is not None:
        data["displayName"] = display_name
    if language is not None:
        data["language"] = language
    ref.set(data, merge=True)


def get_user_by_email(email: str) -> dict[str, Any] | None:
    """Load user by email (document ID = normalized email). Returns None if not found."""
    if not email or not email.strip():
        return None
    key = email.strip().lower()
    db = _get_db()
    doc = db.collection("users").document(key).get()
    if not doc.exists:
        return None
    return doc.to_dict()


def create_user(email: str, password: str, elder_id: str, display_name: str | None = None) -> None:
    """Create a user for sign-in. Demo: password stored as-is; in prod use a hash."""
    key = email.strip().lower()
    db = _get_db()
    data: dict[str, Any] = {
        "email": key,
        "password": password,
        "elder_id": elder_id,
    }
    if display_name is not None:
        data["display_name"] = display_name
    db.collection("users").document(key).set(data, merge=True)
