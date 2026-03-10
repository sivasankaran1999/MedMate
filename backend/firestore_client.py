"""
Firestore access for MedMate elder schedules.

Schema: collection "elders", document ID = elder ID.
Document fields:
  - schedule: { morning: [{ name: str, strength?: str }], afternoon: [...], night: [...] }
  - displayName?: str
  - language?: str
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
