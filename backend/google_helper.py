"""Google integration helpers — Gmail (readonly + send) and Google Calendar.

Single-user app: tokens stored in MongoDB `integrations` collection with id='google'.
"""
from __future__ import annotations

import base64
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import HTTPException

load_dotenv()


GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.environ.get("GOOGLE_REDIRECT_URI", "")

SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
]

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"
CAL_BASE = "https://www.googleapis.com/calendar/v3"


def is_configured() -> bool:
    return bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI)


def auth_url(state: Optional[str] = None) -> str:
    """Build the consent URL the user is redirected to."""
    if not is_configured():
        raise HTTPException(500, "Google OAuth not configured")
    state = state or secrets.token_urlsafe(16)
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",
        "state": state,
    }
    from urllib.parse import urlencode
    return f"{AUTH_URL}?{urlencode(params)}"


async def exchange_code(code: str) -> dict:
    """Exchange auth code for access + refresh tokens."""
    async with httpx.AsyncClient(timeout=20.0) as http:
        r = await http.post(
            TOKEN_URL,
            data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
        )
        if r.status_code != 200:
            raise HTTPException(400, f"Token exchange failed: {r.text[:300]}")
        return r.json()


async def refresh_access_token(refresh_token: str) -> dict:
    async with httpx.AsyncClient(timeout=20.0) as http:
        r = await http.post(
            TOKEN_URL,
            data={
                "refresh_token": refresh_token,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "grant_type": "refresh_token",
            },
        )
        if r.status_code != 200:
            raise HTTPException(401, f"Token refresh failed: {r.text[:300]}")
        return r.json()


async def get_userinfo(access_token: str) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as http:
        r = await http.get(USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
        if r.status_code != 200:
            return {}
        return r.json()


async def get_valid_token(db) -> Optional[str]:
    """Return a fresh access token, refreshing if needed. None if not connected."""
    doc = await db.integrations.find_one({"id": "google"}, {"_id": 0})
    if not doc:
        return None
    expires_at = doc.get("expires_at", 0)
    now = int(time.time())
    if doc.get("access_token") and now < expires_at - 60:
        return doc["access_token"]
    refresh = doc.get("refresh_token")
    if not refresh:
        return None
    new = await refresh_access_token(refresh)
    access = new.get("access_token")
    if not access:
        return None
    expires_in = new.get("expires_in", 3600)
    await db.integrations.update_one(
        {"id": "google"},
        {"$set": {"access_token": access, "expires_at": now + expires_in}},
    )
    return access


# ---------- Gmail ----------
async def list_recent_messages(token: str, max_results: int = 5) -> list[dict]:
    async with httpx.AsyncClient(timeout=20.0) as http:
        # IDs only
        r = await http.get(
            f"{GMAIL_BASE}/messages",
            headers={"Authorization": f"Bearer {token}"},
            params={"maxResults": max_results, "q": "in:inbox"},
        )
        if r.status_code != 200:
            raise HTTPException(502, f"Gmail list failed: {r.text[:200]}")
        ids = [m["id"] for m in r.json().get("messages", [])]
        out = []
        for mid in ids:
            mr = await http.get(
                f"{GMAIL_BASE}/messages/{mid}",
                headers={"Authorization": f"Bearer {token}"},
                params={"format": "metadata", "metadataHeaders": ["From", "Subject", "Date"]},
            )
            if mr.status_code != 200:
                continue
            data = mr.json()
            headers = {h["name"]: h["value"] for h in data.get("payload", {}).get("headers", [])}
            out.append({
                "id": mid,
                "from": headers.get("From", ""),
                "subject": headers.get("Subject", "(no subject)"),
                "date": headers.get("Date", ""),
                "snippet": data.get("snippet", ""),
                "unread": "UNREAD" in data.get("labelIds", []),
            })
        return out


async def send_email(token: str, to: str, subject: str, body: str) -> dict:
    msg = EmailMessage()
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    async with httpx.AsyncClient(timeout=20.0) as http:
        r = await http.post(
            f"{GMAIL_BASE}/messages/send",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"raw": raw},
        )
        if r.status_code not in (200, 202):
            raise HTTPException(502, f"Gmail send failed: {r.text[:200]}")
        return r.json()


# ---------- Calendar ----------
async def list_upcoming_events(token: str, max_results: int = 10) -> list[dict]:
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    async with httpx.AsyncClient(timeout=20.0) as http:
        r = await http.get(
            f"{CAL_BASE}/calendars/primary/events",
            headers={"Authorization": f"Bearer {token}"},
            params={
                "timeMin": now,
                "maxResults": max_results,
                "singleEvents": "true",
                "orderBy": "startTime",
            },
        )
        if r.status_code != 200:
            raise HTTPException(502, f"Calendar list failed: {r.text[:200]}")
        items = r.json().get("items", [])
        out = []
        for it in items:
            start = it.get("start", {})
            end = it.get("end", {})
            out.append({
                "id": it.get("id"),
                "summary": it.get("summary", "(no title)"),
                "start": start.get("dateTime") or start.get("date"),
                "end": end.get("dateTime") or end.get("date"),
                "location": it.get("location", ""),
                "html_link": it.get("htmlLink"),
            })
        return out


async def create_event(
    token: str, summary: str, start_iso: str, end_iso: str, description: str = ""
) -> dict:
    payload = {
        "summary": summary,
        "description": description,
        "start": {"dateTime": start_iso},
        "end": {"dateTime": end_iso},
    }
    async with httpx.AsyncClient(timeout=20.0) as http:
        r = await http.post(
            f"{CAL_BASE}/calendars/primary/events",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=payload,
        )
        if r.status_code not in (200, 201):
            raise HTTPException(502, f"Calendar create failed: {r.text[:200]}")
        return r.json()
