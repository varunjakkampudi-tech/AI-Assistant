"""
AUTH MODULE — email/password JWT + Google handoff (Expo Go-friendly)

Storage (MongoDB):
  users                  { id, email, password_hash?, name, picture?, provider, role, created_at, updated_at }
  login_attempts         { identifier, count, locked_until? }
  password_reset_tokens  { token, user_id, expires_at, used }
  auth_handoff           { nonce, status, access_token?, refresh_token?, user?, created_at, expires_at }

Tokens are Bearer-token only (React Native doesn't play well with cookies); JWT in Authorization header,
stored on device with expo-secure-store on the frontend.
"""
from __future__ import annotations
import os
import re
import uuid
import bcrypt
import jwt
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional, Callable

from fastapi import HTTPException, Request

logger = logging.getLogger(__name__)

JWT_ALG = "HS256"
ACCESS_TTL_MIN = 60 * 12       # 12 hours
REFRESH_TTL_DAYS = 30
LOGIN_MAX_ATTEMPTS = 5
LOGIN_LOCKOUT_MIN = 15
HANDOFF_TTL_MIN = 5

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(d: datetime) -> str:
    return d.isoformat()


def _secret() -> str:
    s = os.environ.get("JWT_SECRET")
    if not s:
        raise HTTPException(500, "Server misconfigured: JWT_SECRET missing")
    return s


# ==================== Password hashing ====================

def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ==================== JWT ====================

def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "type": "access",
        "exp": _now() + timedelta(minutes=ACCESS_TTL_MIN),
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALG)


def create_refresh_token(user_id: str, jti: Optional[str] = None) -> tuple[str, str]:
    jti = jti or uuid.uuid4().hex
    payload = {
        "sub": user_id,
        "jti": jti,
        "type": "refresh",
        "exp": _now() + timedelta(days=REFRESH_TTL_DAYS),
    }
    return jwt.encode(payload, _secret(), algorithm=JWT_ALG), jti


def decode_token(token: str, expected_type: str) -> Dict[str, Any]:
    try:
        payload = jwt.decode(token, _secret(), algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
    if payload.get("type") != expected_type:
        raise HTTPException(401, "Wrong token type")
    return payload


# ==================== User CRUD ====================

def _sanitize(user: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(user)
    out.pop("_id", None)
    out.pop("password_hash", None)
    return out


async def ensure_indexes(db) -> None:
    await db.users.create_index("email", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.auth_handoff.create_index("nonce", unique=True)


async def get_user_by_id(db, user_id: str) -> Optional[Dict[str, Any]]:
    u = await db.users.find_one({"id": user_id}, {"_id": 0})
    return u


async def get_user_by_email(db, email: str) -> Optional[Dict[str, Any]]:
    u = await db.users.find_one({"email": email.lower().strip()}, {"_id": 0})
    return u


async def create_user(db, *, email: str, name: str = "", password: Optional[str] = None,
                       provider: str = "password", picture: Optional[str] = None,
                       role: str = "user") -> Dict[str, Any]:
    email = email.lower().strip()
    if not _EMAIL_RE.match(email):
        raise HTTPException(400, "Invalid email")
    existing = await get_user_by_email(db, email)
    if existing:
        raise HTTPException(409, "Email already registered")
    doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "name": (name or email.split("@")[0]).strip()[:80],
        "picture": picture or "",
        "provider": provider,
        "role": role,
        "password_hash": hash_password(password) if password else None,
        "created_at": _iso(_now()),
        "updated_at": _iso(_now()),
    }
    await db.users.insert_one(doc)
    return _sanitize(doc)


async def upsert_oauth_user(db, *, email: str, name: str, picture: str,
                             provider: str = "google") -> Dict[str, Any]:
    """Create on first sight, otherwise update name/picture."""
    email = email.lower().strip()
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        await db.users.update_one(
            {"email": email},
            {"$set": {"name": name or existing.get("name"),
                       "picture": picture or existing.get("picture"),
                       "provider": existing.get("provider") or provider,
                       "updated_at": _iso(_now())}}
        )
        existing.update({"name": name or existing.get("name"),
                          "picture": picture or existing.get("picture")})
        return _sanitize(existing)
    return await create_user(db, email=email, name=name, picture=picture, provider=provider)


# ==================== Brute force ====================

async def _check_lockout(db, identifier: str) -> None:
    rec = await db.login_attempts.find_one({"identifier": identifier}, {"_id": 0})
    if not rec:
        return
    locked_until = rec.get("locked_until")
    if locked_until:
        try:
            t = datetime.fromisoformat(locked_until.replace("Z", "+00:00"))
            if t > _now():
                wait_secs = int((t - _now()).total_seconds())
                raise HTTPException(429, f"Too many failed attempts. Try again in {wait_secs}s.")
        except HTTPException:
            raise
        except Exception:
            pass


async def _record_failure(db, identifier: str) -> None:
    rec = await db.login_attempts.find_one({"identifier": identifier}, {"_id": 0})
    count = (rec or {}).get("count", 0) + 1
    update: Dict[str, Any] = {"identifier": identifier, "count": count, "last_at": _iso(_now())}
    if count >= LOGIN_MAX_ATTEMPTS:
        update["locked_until"] = _iso(_now() + timedelta(minutes=LOGIN_LOCKOUT_MIN))
        update["count"] = 0
    await db.login_attempts.update_one({"identifier": identifier}, {"$set": update}, upsert=True)


async def _clear_failures(db, identifier: str) -> None:
    await db.login_attempts.delete_one({"identifier": identifier})


# ==================== Auth dependencies ====================

async def current_user(request: Request, db) -> Dict[str, Any]:
    auth = request.headers.get("Authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token")
    token = auth[7:].strip()
    payload = decode_token(token, "access")
    user = await get_user_by_id(db, payload["sub"])
    if not user:
        raise HTTPException(401, "User not found")
    return _sanitize(user)


async def optional_user(request: Request, db) -> Optional[Dict[str, Any]]:
    auth = request.headers.get("Authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    try:
        token = auth[7:].strip()
        payload = decode_token(token, "access")
        user = await get_user_by_id(db, payload["sub"])
        return _sanitize(user) if user else None
    except Exception:
        return None


# ==================== Token bundle ====================

def issue_tokens(user: Dict[str, Any]) -> Dict[str, str]:
    refresh, jti = create_refresh_token(user["id"])
    return {
        "access_token": create_access_token(user["id"], user["email"]),
        "refresh_token": refresh,
        "refresh_jti": jti,
        "token_type": "bearer",
    }


# ==================== Google login handoff ====================

async def create_handoff(db) -> str:
    nonce = uuid.uuid4().hex
    await db.auth_handoff.insert_one({
        "nonce": nonce,
        "status": "pending",
        "created_at": _iso(_now()),
        "expires_at": _now() + timedelta(minutes=HANDOFF_TTL_MIN),
    })
    return nonce


async def finalize_handoff(db, nonce: str, user: Dict[str, Any]) -> None:
    tokens = issue_tokens(user)
    await db.auth_handoff.update_one(
        {"nonce": nonce},
        {"$set": {
            "status": "done",
            **tokens,
            "user": _sanitize(user),
            "finalized_at": _iso(_now()),
        }},
    )


async def poll_handoff(db, nonce: str) -> Dict[str, Any]:
    rec = await db.auth_handoff.find_one({"nonce": nonce}, {"_id": 0})
    if not rec:
        return {"status": "missing"}
    if rec.get("status") != "done":
        return {"status": rec.get("status", "pending")}
    return {
        "status": "done",
        "access_token": rec.get("access_token"),
        "refresh_token": rec.get("refresh_token"),
        "user": rec.get("user"),
    }


# ==================== Admin seed ====================

async def seed_admin(db) -> None:
    email = (os.environ.get("ADMIN_EMAIL") or "").strip().lower()
    password = os.environ.get("ADMIN_PASSWORD") or ""
    if not email or not password:
        return
    existing = await db.users.find_one({"email": email})
    if existing is None:
        try:
            await create_user(db, email=email, password=password, name="Owner", role="admin")
            logger.info("Seeded admin user %s", email)
        except HTTPException:
            pass
    elif existing.get("password_hash") and not verify_password(password, existing["password_hash"]):
        await db.users.update_one(
            {"email": email},
            {"$set": {"password_hash": hash_password(password), "updated_at": _iso(_now())}}
        )
        logger.info("Updated admin password for %s", email)
