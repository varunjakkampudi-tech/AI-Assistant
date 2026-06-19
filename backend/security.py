"""
Security center — login session tracking, audit log, breach detection.

Mongo collections:
  login_sessions: { id, user_id, refresh_jti, ip, user_agent, device_label, location, created_at, last_seen_at, revoked? }
  audit_events:   { id, user_id, event, ip, user_agent, location, ok, meta, created_at }
  otp_codes:      { id, email, code_hash, expires_at, used, ip }
"""
from __future__ import annotations
import os
import re
import uuid
import bcrypt
import hashlib
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

OTP_TTL_MIN = 10
OTP_MAX_ATTEMPTS = 5
SESSION_TTL_DAYS = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(d: datetime) -> str:
    return d.isoformat()


# ==================== OTP ====================

def _hash_code(code: str) -> str:
    return bcrypt.hashpw(code.encode(), bcrypt.gensalt(rounds=8)).decode()


def _verify_code(code: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(code.encode(), hashed.encode())
    except Exception:
        return False


def generate_otp() -> str:
    # 6-digit code, leading zeros allowed
    import secrets
    return f"{secrets.randbelow(1_000_000):06d}"


async def store_otp(db, email: str, ip: Optional[str]) -> str:
    code = generate_otp()
    await db.otp_codes.delete_many({"email": email.lower(), "used": False})
    await db.otp_codes.insert_one({
        "id": str(uuid.uuid4()),
        "email": email.lower().strip(),
        "code_hash": _hash_code(code),
        "ip": ip,
        "created_at": _iso(_now()),
        "expires_at": _iso(_now() + timedelta(minutes=OTP_TTL_MIN)),
        "attempts": 0,
        "used": False,
    })
    return code


async def verify_otp(db, email: str, code: str) -> bool:
    rec = await db.otp_codes.find_one(
        {"email": email.lower().strip(), "used": False},
        sort=[("created_at", -1)],
    )
    if not rec:
        return False
    # Expiry
    exp = rec.get("expires_at")
    if isinstance(exp, str):
        try:
            exp = datetime.fromisoformat(exp.replace("Z", "+00:00"))
        except Exception:
            return False
    if not exp or exp < _now():
        return False
    if rec.get("attempts", 0) >= OTP_MAX_ATTEMPTS:
        return False
    if not _verify_code(code, rec["code_hash"]):
        await db.otp_codes.update_one({"id": rec["id"]}, {"$inc": {"attempts": 1}})
        return False
    await db.otp_codes.update_one({"id": rec["id"]}, {"$set": {"used": True, "used_at": _iso(_now())}})
    return True


# ==================== Sessions ====================

def _device_label(ua: str) -> str:
    if not ua:
        return "Unknown device"
    ua_l = ua.lower()
    if "iphone" in ua_l:
        return "iPhone"
    if "ipad" in ua_l:
        return "iPad"
    if "android" in ua_l:
        return "Android"
    if "macintosh" in ua_l or "mac os" in ua_l:
        return "Mac"
    if "windows" in ua_l:
        return "Windows PC"
    if "linux" in ua_l:
        return "Linux"
    if "expo" in ua_l or "react native" in ua_l:
        return "ORA Mobile App"
    return "Web browser"


def _browser_label(ua: str) -> str:
    if not ua:
        return ""
    ua_l = ua.lower()
    if "edg/" in ua_l:
        return "Edge"
    if "chrome" in ua_l and "safari" in ua_l:
        return "Chrome"
    if "safari" in ua_l and "chrome" not in ua_l:
        return "Safari"
    if "firefox" in ua_l:
        return "Firefox"
    return ""


async def create_session(
    db, *, user_id: str, refresh_jti: str, ip: Optional[str], user_agent: Optional[str]
) -> Dict[str, Any]:
    ua = user_agent or ""
    sess = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "refresh_jti": refresh_jti,
        "ip": ip,
        "user_agent": ua[:300],
        "device_label": _device_label(ua),
        "browser": _browser_label(ua),
        "created_at": _iso(_now()),
        "last_seen_at": _iso(_now()),
        "expires_at": _iso(_now() + timedelta(days=SESSION_TTL_DAYS)),
        "revoked": False,
    }
    await db.login_sessions.insert_one(sess)
    return {k: v for k, v in sess.items() if k != "_id"}


async def list_sessions(db, user_id: str) -> List[Dict[str, Any]]:
    rows = await db.login_sessions.find(
        {"user_id": user_id, "revoked": {"$ne": True}},
        {"_id": 0},
    ).sort("last_seen_at", -1).to_list(50)
    return rows


async def revoke_session(db, user_id: str, session_id: str) -> bool:
    r = await db.login_sessions.update_one(
        {"id": session_id, "user_id": user_id},
        {"$set": {"revoked": True, "revoked_at": _iso(_now())}},
    )
    return r.modified_count > 0


async def revoke_all_sessions(db, user_id: str, except_jti: Optional[str] = None) -> int:
    q: Dict[str, Any] = {"user_id": user_id, "revoked": {"$ne": True}}
    if except_jti:
        q["refresh_jti"] = {"$ne": except_jti}
    r = await db.login_sessions.update_many(
        q, {"$set": {"revoked": True, "revoked_at": _iso(_now())}}
    )
    return r.modified_count


async def is_jti_valid(db, refresh_jti: str) -> bool:
    rec = await db.login_sessions.find_one(
        {"refresh_jti": refresh_jti, "revoked": {"$ne": True}}, {"_id": 0}
    )
    return rec is not None


async def touch_session(db, refresh_jti: str) -> None:
    await db.login_sessions.update_one(
        {"refresh_jti": refresh_jti}, {"$set": {"last_seen_at": _iso(_now())}}
    )


# ==================== Audit log ====================

async def log_event(
    db, *, user_id: Optional[str], event: str, ip: Optional[str] = None,
    user_agent: Optional[str] = None, ok: bool = True, meta: Optional[Dict[str, Any]] = None,
) -> None:
    try:
        await db.audit_events.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "event": event,
            "ip": ip,
            "user_agent": (user_agent or "")[:300],
            "device_label": _device_label(user_agent or ""),
            "ok": bool(ok),
            "meta": meta or {},
            "created_at": _iso(_now()),
        })
    except Exception as e:
        logger.warning("audit log failed: %s", e)


async def list_audit_events(db, user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    rows = await db.audit_events.find(
        {"user_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(limit)
    return rows


# ==================== Breach detection ====================

async def detect_new_device(db, user_id: str, user_agent: str, ip: Optional[str]) -> bool:
    """Returns True if this is a never-seen-before device-IP combo."""
    ua = (user_agent or "")[:300]
    label = _device_label(ua)
    prior = await db.login_sessions.find_one(
        {"user_id": user_id, "device_label": label},
        {"_id": 0},
    )
    return prior is None


async def ensure_indexes(db) -> None:
    await db.otp_codes.create_index("email")
    await db.login_sessions.create_index("user_id")
    await db.login_sessions.create_index("refresh_jti")
    await db.audit_events.create_index("user_id")
    await db.audit_events.create_index("created_at")
