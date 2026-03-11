"""
Firestore access for MedMate elder schedules and users (auth).

Elders: collection "elders", document ID = elder ID.
  - schedule: { morning, afternoon, night, timeWindows?: { morning: {start,end}, ... } }
  - displayName?: str, language?: str
  - emergencyContact?: { name: str, email: str }  # family/contact to notify via email
  - pharmacistContact?: { name?: str, email?: str, phone?: str }

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
    emergency_contact: dict[str, str] | None = None,
    pharmacist_contact: dict[str, str] | None = None,
) -> None:
    """Create or update an elder document with the given schedule and optional contacts."""
    db = _get_db()
    ref = db.collection("elders").document(elder_id)
    data: dict[str, Any] = {"schedule": schedule}
    if display_name is not None:
        data["displayName"] = display_name
    if language is not None:
        data["language"] = language
    if emergency_contact is not None and isinstance(emergency_contact, dict):
        data["emergencyContact"] = {
            "name": str(emergency_contact.get("name", "")).strip(),
            "email": str(emergency_contact.get("email", "")).strip().lower(),
        }
    if pharmacist_contact is not None and isinstance(pharmacist_contact, dict):
        data["pharmacistContact"] = {
            k: str(v).strip() for k, v in pharmacist_contact.items() if v
        }
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


# Max entries to keep in doseHistory for insights (e.g. ~90 days at 3 slots/day)
DOSE_HISTORY_CAP = 500


def record_dose_confirmation(elder_id: str, slot: str, taken: bool) -> dict[str, Any] | None:
    """Record that the user confirmed (or did not take) a dose for the given slot. Updates doseConfirmations (last per slot) and appends to doseHistory for insights. Returns emergency contact dict if they have an email."""
    if slot not in ("morning", "afternoon", "night"):
        return None
    db = _get_db()
    ref = db.collection("elders").document(elder_id)
    doc = ref.get()
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    from datetime import datetime, timezone
    now_iso = datetime.now(timezone.utc).isoformat()
    confirmations = dict(data.get("doseConfirmations") or {})
    confirmations[slot] = {"at": now_iso, "taken": taken}
    history: list[dict[str, Any]] = list(data.get("doseHistory") or [])
    history.append({"slot": slot, "at": now_iso, "taken": taken})
    if len(history) > DOSE_HISTORY_CAP:
        history = history[-DOSE_HISTORY_CAP:]
    ref.set({"doseConfirmations": confirmations, "doseHistory": history}, merge=True)
    ec = data.get("emergencyContact") or data.get("emergency_contact")
    email = (ec.get("email") or "").strip() if isinstance(ec, dict) else ""
    if isinstance(ec, dict) and email:
        return {"name": (ec.get("name") or "Emergency contact").strip(), "email": email}
    return None


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
