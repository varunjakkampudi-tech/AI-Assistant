"""
Super Master Admin Console — backend.

Single comprehensive router for all admin-only endpoints.
Mount with prefix='/api/admin'. Every endpoint requires a valid Bearer token
AND a user with role in {'admin', 'super_admin'}. Super-admin-only endpoints
are guarded with require_super_admin().

Mongo collections owned by this module:
  admin_audit               — immutable audit trail of admin actions
  admin_ai_providers        — provider credentials (api keys encrypted at rest)
  admin_feature_models      — per-feature primary + fallback model assignments
  admin_ai_usage            — every AI call cost/usage row (rolled up for dashboards)
  admin_budgets             — monthly AI cost budgets + alert thresholds
  admin_feature_flags       — feature flags with rollout %, audience, status
  admin_prompts             — versioned system prompts
  admin_subscriptions       — plan catalog + per-user plan assignment is on users.plan
  admin_notifications       — broadcast queue (push/email/announcement)
  admin_config              — singleton {key: 'platform', ...} platform configuration
  admin_support_tickets     — alias of support_tickets but enriched
  admin_system_health       — last-known status snapshots
"""
from __future__ import annotations
import os
import uuid
import json
import base64
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Body, Query
from pydantic import BaseModel, Field, EmailStr

import auth as auth_mod
import security as sec

logger = logging.getLogger(__name__)
router = APIRouter()

# ==================== Roles & deps ====================
ADMIN_ROLES = {"admin", "super_admin"}
SUPER_ADMIN_ROLE = "super_admin"


def get_db(request: Request):
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise HTTPException(500, "DB not configured")
    return db


def _client_ip(request: Request) -> Optional[str]:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


async def require_admin(request: Request) -> Dict[str, Any]:
    db = get_db(request)
    user = await auth_mod.current_user(request, db)
    if user.get("role") not in ADMIN_ROLES:
        raise HTTPException(403, "Admin access required")
    return user


async def require_super_admin(request: Request) -> Dict[str, Any]:
    db = get_db(request)
    user = await auth_mod.current_user(request, db)
    if user.get("role") != SUPER_ADMIN_ROLE:
        raise HTTPException(403, "Super admin access required")
    return user


# ==================== Audit log (immutable) ====================
async def audit(db, *, actor: Dict[str, Any], action: str, target: str = "",
                previous: Any = None, new: Any = None, ip: Optional[str] = None,
                user_agent: Optional[str] = None, ok: bool = True) -> None:
    try:
        await db.admin_audit.insert_one({
            "id": str(uuid.uuid4()),
            "actor_id": actor.get("id"),
            "actor_email": actor.get("email"),
            "actor_role": actor.get("role"),
            "action": action,
            "target": target,
            "previous": previous,
            "new": new,
            "ip": ip,
            "user_agent": (user_agent or "")[:300],
            "ok": bool(ok),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as e:
        logger.warning("audit insert failed: %s", e)


# ==================== Encryption for provider secrets ====================
def _fernet():
    key = os.environ.get("ADMIN_FERNET_KEY")
    if not key:
        raise HTTPException(500, "ADMIN_FERNET_KEY missing")
    try:
        from cryptography.fernet import Fernet
        return Fernet(key.encode() if isinstance(key, str) else key)
    except Exception as e:
        raise HTTPException(500, f"Fernet init failed: {e}")


def enc(plain: str) -> str:
    if not plain:
        return ""
    return _fernet().encrypt(plain.encode("utf-8")).decode("utf-8")


def dec(cipher: str) -> str:
    if not cipher:
        return ""
    try:
        return _fernet().decrypt(cipher.encode("utf-8")).decode("utf-8")
    except Exception:
        return ""


def mask(val: str) -> str:
    if not val:
        return ""
    if len(val) <= 8:
        return "•" * len(val)
    return val[:4] + "•" * (len(val) - 8) + val[-4:]


# ==================== Schemas ====================
class AdminLogin(BaseModel):
    email: EmailStr
    password: str


class RoleAssign(BaseModel):
    role: Literal["user", "admin", "super_admin"]


class StatusAssign(BaseModel):
    status: Literal["active", "suspended", "banned"]


class PlanAssign(BaseModel):
    plan: Literal["free", "pro", "premium", "enterprise"]


class ProviderCreate(BaseModel):
    name: str  # bedrock | openai | anthropic | gemini | azure | groq | deepseek | ollama
    label: str = ""
    api_key: str = ""
    secret_key: str = ""
    endpoint: str = ""
    region: str = ""
    enabled: bool = True


class ProviderUpdate(BaseModel):
    label: Optional[str] = None
    api_key: Optional[str] = None
    secret_key: Optional[str] = None
    endpoint: Optional[str] = None
    region: Optional[str] = None
    enabled: Optional[bool] = None


class FeatureModelAssign(BaseModel):
    feature: str  # chat | journal | career | knowledge | digital_twin | voice | briefing | search ...
    primary_model_id: str
    fallback_model_ids: List[str] = []


class BudgetSet(BaseModel):
    monthly_usd: float = 500.0
    alert_pct: List[int] = [50, 75, 90, 100]
    email_to: str = ""


class FeatureFlagBody(BaseModel):
    key: str
    label: str = ""
    status: Literal["enabled", "disabled", "beta", "internal", "rollout"] = "enabled"
    rollout_pct: int = 100
    audience: List[str] = []  # plan names or user ids


class PromptBody(BaseModel):
    key: str
    label: str = ""
    body: str
    mode: Literal["draft", "published"] = "draft"


class PromptPublish(BaseModel):
    version_id: str


class NotificationBody(BaseModel):
    channel: Literal["push", "email", "announcement", "maintenance"]
    title: str
    body: str
    audience: Literal["all", "beta", "premium", "enterprise", "selected"] = "all"
    user_ids: List[str] = []


class ConfigBody(BaseModel):
    app_name: Optional[str] = None
    logo_url: Optional[str] = None
    primary_color: Optional[str] = None
    accent_color: Optional[str] = None
    theme: Optional[str] = None
    support_email: Optional[str] = None
    support_phone: Optional[str] = None
    privacy_url: Optional[str] = None
    terms_url: Optional[str] = None
    cookies_url: Optional[str] = None


class SubscriptionPlanBody(BaseModel):
    key: str  # free|pro|premium|enterprise
    label: str = ""
    price_usd_monthly: float = 0.0
    features: List[str] = []
    storage_gb: float = 1.0
    monthly_token_limit: int = 100_000
    upload_limit_mb: int = 50
    ai_requests_per_day: int = 200


class AIUsageIngest(BaseModel):
    """Optional ingestion endpoint so other modules can record AI usage."""
    provider: str
    model_id: str
    feature: str = "chat"
    user_id: Optional[str] = None
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: int = 0
    cost_usd: float = 0.0
    success: bool = True
    error: Optional[str] = None


# ==================== Admin login (password) ====================
@router.post("/login")
async def admin_login(body: AdminLogin, request: Request):
    db = get_db(request)
    user = await auth_mod.get_user_by_email(db, body.email)
    if not user or not user.get("password_hash"):
        raise HTTPException(401, "Invalid credentials")
    if not auth_mod.verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid credentials")
    if user.get("role") not in ADMIN_ROLES:
        raise HTTPException(403, "Not an admin")
    sanitized = auth_mod._sanitize(user)
    tokens = auth_mod.issue_tokens(sanitized)
    ua = request.headers.get("user-agent")
    ip = _client_ip(request)
    await sec.create_session(db, user_id=sanitized["id"], refresh_jti=tokens["refresh_jti"], ip=ip, user_agent=ua)
    await audit(db, actor=sanitized, action="admin.login", ip=ip, user_agent=ua)
    return {"user": sanitized, **{k: v for k, v in tokens.items() if k != "refresh_jti"}}


@router.get("/me")
async def admin_me(user: Dict[str, Any] = Depends(require_admin)):
    return {"user": user}


# ==================== Executive Dashboard ====================
@router.get("/metrics/overview")
async def metrics_overview(request: Request, user: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    week_ago = (now - timedelta(days=7)).isoformat()
    month_ago = (now - timedelta(days=30)).isoformat()

    total_users = await db.users.count_documents({})
    new_today = await db.users.count_documents({"created_at": {"$gte": today}})
    dau = await db.login_sessions.distinct("user_id", {"last_seen_at": {"$gte": today}})
    wau = await db.login_sessions.distinct("user_id", {"last_seen_at": {"$gte": week_ago}})
    mau = await db.login_sessions.distinct("user_id", {"last_seen_at": {"$gte": month_ago}})

    suspended = await db.users.count_documents({"status": "suspended"})
    banned = await db.users.count_documents({"status": "banned"})
    active_users = max(0, total_users - suspended - banned)

    # AI metrics
    ai_today = await db.admin_ai_usage.count_documents({"created_at": {"$gte": today}})
    ai_total = await db.admin_ai_usage.count_documents({})
    cost_pipeline = [
        {"$group": {"_id": None,
                     "input_tokens": {"$sum": "$input_tokens"},
                     "output_tokens": {"$sum": "$output_tokens"},
                     "cost_usd": {"$sum": "$cost_usd"},
                     "lat_avg": {"$avg": "$latency_ms"},
                     "errors": {"$sum": {"$cond": ["$success", 0, 1]}}}}
    ]
    today_cost = await db.admin_ai_usage.aggregate(
        [{"$match": {"created_at": {"$gte": today}}}] + cost_pipeline
    ).to_list(1)
    month_cost = await db.admin_ai_usage.aggregate(
        [{"$match": {"created_at": {"$gte": month_ago}}}] + cost_pipeline
    ).to_list(1)
    lifetime = await db.admin_ai_usage.aggregate(cost_pipeline).to_list(1)

    def _take(rows):
        r = rows[0] if rows else {}
        return {
            "input_tokens": int(r.get("input_tokens", 0)),
            "output_tokens": int(r.get("output_tokens", 0)),
            "cost_usd": round(float(r.get("cost_usd", 0.0)), 4),
            "avg_latency_ms": int(r.get("lat_avg", 0) or 0),
            "errors": int(r.get("errors", 0)),
        }

    today_stats = _take(today_cost)
    month_stats = _take(month_cost)
    lifetime_stats = _take(lifetime)
    success_rate = 100.0 if ai_total == 0 else round(
        100.0 * (ai_total - lifetime_stats["errors"]) / ai_total, 2
    )

    # Platform content counts
    plat = {}
    for coll in (
        "chat_sessions", "chat_messages", "memories", "journal_entries",
        "knowledge_docs", "phone_calls", "calendar_events",
        "career_applications", "goals", "reminders",
    ):
        try:
            plat[coll] = await db[coll].count_documents({})
        except Exception:
            plat[coll] = 0

    # Financial — pull plan distribution + mocked MRR from plan catalog
    plans = await db.admin_subscriptions.find({}, {"_id": 0}).to_list(50)
    plan_price = {p["key"]: float(p.get("price_usd_monthly", 0.0)) for p in plans}
    plan_dist: Dict[str, int] = {}
    async for u in db.users.find({}, {"plan": 1}):
        k = u.get("plan") or "free"
        plan_dist[k] = plan_dist.get(k, 0) + 1
    mrr = sum(plan_dist.get(k, 0) * v for k, v in plan_price.items())
    arr = mrr * 12.0

    # Growth — last 7 days new users per day
    growth: List[Dict[str, Any]] = []
    for i in range(6, -1, -1):
        day = (now - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        nxt = day + timedelta(days=1)
        n = await db.users.count_documents({"created_at": {"$gte": day.isoformat(), "$lt": nxt.isoformat()}})
        growth.append({"date": day.date().isoformat(), "new_users": n})

    return {
        "users": {
            "total": total_users,
            "active": active_users,
            "suspended": suspended,
            "banned": banned,
            "new_today": new_today,
            "dau": len(dau),
            "wau": len(wau),
            "mau": len(mau),
            "growth": growth,
        },
        "ai": {
            "requests_today": ai_today,
            "requests_total": ai_total,
            "success_rate": success_rate,
            "today": today_stats,
            "month": month_stats,
            "lifetime": lifetime_stats,
        },
        "financial": {
            "mrr": round(mrr, 2),
            "arr": round(arr, 2),
            "ai_cost_month": month_stats["cost_usd"],
            "ai_cost_lifetime": lifetime_stats["cost_usd"],
            "plan_distribution": plan_dist,
        },
        "platform": plat,
    }


@router.get("/metrics/cost-series")
async def metrics_cost_series(days: int = 14, request: Request = None, user: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    now = datetime.now(timezone.utc)
    days = max(1, min(days, 60))
    series: List[Dict[str, Any]] = []
    for i in range(days - 1, -1, -1):
        day = (now - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        nxt = day + timedelta(days=1)
        cur = db.admin_ai_usage.aggregate([
            {"$match": {"created_at": {"$gte": day.isoformat(), "$lt": nxt.isoformat()}}},
            {"$group": {"_id": None,
                          "cost_usd": {"$sum": "$cost_usd"},
                          "tokens": {"$sum": {"$add": ["$input_tokens", "$output_tokens"]}},
                          "requests": {"$sum": 1}}},
        ])
        row = await cur.to_list(1)
        r = row[0] if row else {}
        series.append({
            "date": day.date().isoformat(),
            "cost_usd": round(float(r.get("cost_usd", 0.0)), 4),
            "tokens": int(r.get("tokens", 0)),
            "requests": int(r.get("requests", 0)),
        })
    return {"series": series}


# ==================== User Management ====================
@router.get("/users")
async def users_list(request: Request, q: str = "", status: str = "", plan: str = "",
                     role: str = "", skip: int = 0, limit: int = 50,
                     user: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    f: Dict[str, Any] = {}
    if q:
        f["$or"] = [{"email": {"$regex": q, "$options": "i"}},
                       {"name": {"$regex": q, "$options": "i"}}]
    if status:
        f["status"] = status
    if plan:
        f["plan"] = plan
    if role:
        f["role"] = role
    total = await db.users.count_documents(f)
    rows = await db.users.find(f, {"_id": 0, "password_hash": 0}).sort("created_at", -1).skip(skip).limit(min(limit, 200)).to_list(200)
    return {"total": total, "items": rows, "skip": skip, "limit": limit}


@router.get("/users/{user_id}")
async def user_detail(user_id: str, request: Request, user: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(404, "User not found")
    sessions = await db.login_sessions.find({"user_id": user_id, "revoked": {"$ne": True}}, {"_id": 0}).sort("last_seen_at", -1).to_list(20)
    events = await db.audit_events.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(20)
    counts = {}
    for coll in ("chat_sessions", "memories", "journal_entries", "goals", "reminders"):
        try:
            counts[coll] = await db[coll].count_documents({"user_id": user_id})
        except Exception:
            counts[coll] = 0
    return {"user": target, "sessions": sessions, "events": events, "counts": counts}


@router.put("/users/{user_id}/status")
async def user_set_status(user_id: str, body: StatusAssign, request: Request, actor: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(404, "User not found")
    prev = target.get("status", "active")
    await db.users.update_one({"id": user_id}, {"$set": {"status": body.status, "updated_at": datetime.now(timezone.utc).isoformat()}})
    if body.status in ("suspended", "banned"):
        await sec.revoke_all_sessions(db, user_id)
    await audit(db, actor=actor, action=f"user.{body.status}", target=user_id, previous=prev, new=body.status, ip=_client_ip(request), user_agent=request.headers.get("user-agent"))
    return {"ok": True, "status": body.status}


@router.put("/users/{user_id}/role")
async def user_set_role(user_id: str, body: RoleAssign, request: Request, actor: Dict[str, Any] = Depends(require_super_admin)):
    db = get_db(request)
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(404, "User not found")
    prev = target.get("role", "user")
    await db.users.update_one({"id": user_id}, {"$set": {"role": body.role, "updated_at": datetime.now(timezone.utc).isoformat()}})
    await audit(db, actor=actor, action="user.role_changed", target=user_id, previous=prev, new=body.role, ip=_client_ip(request), user_agent=request.headers.get("user-agent"))
    return {"ok": True, "role": body.role}


@router.put("/users/{user_id}/plan")
async def user_set_plan(user_id: str, body: PlanAssign, request: Request, actor: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(404, "User not found")
    prev = target.get("plan", "free")
    await db.users.update_one({"id": user_id}, {"$set": {"plan": body.plan, "updated_at": datetime.now(timezone.utc).isoformat()}})
    await audit(db, actor=actor, action="user.plan_changed", target=user_id, previous=prev, new=body.plan, ip=_client_ip(request))
    return {"ok": True, "plan": body.plan}


@router.delete("/users/{user_id}")
async def user_delete(user_id: str, request: Request, actor: Dict[str, Any] = Depends(require_super_admin)):
    db = get_db(request)
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(404, "User not found")
    if target.get("role") == SUPER_ADMIN_ROLE and target.get("id") == actor.get("id"):
        raise HTTPException(400, "Cannot delete yourself")
    # Soft delete-ish: revoke sessions + erase profile + cascade per-user collections
    USER_COLLS = [
        "chat_sessions", "chat_messages", "memories", "goals", "reminders",
        "journal_entries", "health_logs", "transactions", "notifications",
        "jobs", "career_profile", "career_applications", "knowledge_docs",
        "knowledge_chunks", "phone_calls", "incoming_calls", "missed_call_reminders",
        "digital_twin_profile", "user_settings", "login_sessions", "audit_events",
        "suggestions", "integrations",
    ]
    removed = 0
    for c in USER_COLLS:
        try:
            r = await db[c].delete_many({"user_id": user_id})
            removed += r.deleted_count
        except Exception:
            pass
    await db.users.delete_one({"id": user_id})
    await audit(db, actor=actor, action="user.deleted", target=user_id, previous={"email": target.get("email")}, new=None, ip=_client_ip(request))
    return {"ok": True, "documents_removed": removed}


@router.post("/users/{user_id}/revoke-sessions")
async def user_revoke_sessions(user_id: str, request: Request, actor: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    n = await sec.revoke_all_sessions(db, user_id)
    await audit(db, actor=actor, action="user.sessions_revoked", target=user_id, new={"revoked": n}, ip=_client_ip(request))
    return {"ok": True, "revoked": n}


# ==================== AI Model Control Center ====================
PROVIDER_LABELS = {
    "bedrock": "Amazon Bedrock", "openai": "OpenAI", "anthropic": "Anthropic",
    "gemini": "Google Gemini", "azure": "Azure OpenAI", "groq": "Groq",
    "deepseek": "DeepSeek", "ollama": "Ollama",
}

# Default model catalog used by the UI (can be extended).
MODEL_CATALOG = {
    "bedrock": ["amazon.nova-lite-v1:0", "amazon.nova-pro-v1:0", "amazon.nova-micro-v1:0", "anthropic.claude-3-5-sonnet-20241022-v2:0"],
    "openai": ["gpt-5.4", "gpt-5.4-mini", "gpt-5.2", "gpt-4o", "gpt-4o-mini"],
    "anthropic": ["claude-sonnet-4-6", "claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-1"],
    "gemini": ["gemini-3.1-pro", "gemini-3-flash", "gemini-3.5-flash"],
    "azure": ["gpt-4o-azure", "gpt-4o-mini-azure"],
    "groq": ["llama-3.3-70b", "mixtral-8x7b"],
    "deepseek": ["deepseek-chat", "deepseek-reasoner"],
    "ollama": ["llama3.3", "qwen2.5"],
}


def _serialize_provider(p: Dict[str, Any], reveal: bool = False) -> Dict[str, Any]:
    out = {k: v for k, v in p.items() if k != "_id"}
    out["label"] = out.get("label") or PROVIDER_LABELS.get(out.get("name", ""), out.get("name", ""))
    api_key = dec(out.get("api_key_enc", ""))
    secret_key = dec(out.get("secret_key_enc", ""))
    if reveal:
        out["api_key"] = api_key
        out["secret_key"] = secret_key
    else:
        out["api_key"] = mask(api_key)
        out["secret_key"] = mask(secret_key)
    out.pop("api_key_enc", None)
    out.pop("secret_key_enc", None)
    return out


@router.get("/ai/providers")
async def providers_list(request: Request, user: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    rows = await db.admin_ai_providers.find({}).to_list(100)
    items = [_serialize_provider(p) for p in rows]
    return {"items": items, "catalog": MODEL_CATALOG, "labels": PROVIDER_LABELS}


@router.post("/ai/providers")
async def provider_create(body: ProviderCreate, request: Request, actor: Dict[str, Any] = Depends(require_super_admin)):
    db = get_db(request)
    name = body.name.strip().lower()
    if name not in PROVIDER_LABELS:
        raise HTTPException(400, f"Unknown provider '{name}'")
    existing = await db.admin_ai_providers.find_one({"name": name})
    doc = {
        "id": existing.get("id") if existing else str(uuid.uuid4()),
        "name": name,
        "label": body.label or PROVIDER_LABELS[name],
        "api_key_enc": enc(body.api_key),
        "secret_key_enc": enc(body.secret_key),
        "endpoint": body.endpoint,
        "region": body.region,
        "enabled": body.enabled,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "created_at": (existing or {}).get("created_at", datetime.now(timezone.utc).isoformat()),
    }
    await db.admin_ai_providers.update_one({"name": name}, {"$set": doc}, upsert=True)
    await audit(db, actor=actor, action="provider.upserted", target=name, new={"enabled": body.enabled, "endpoint": body.endpoint}, ip=_client_ip(request))
    return {"ok": True, "provider": _serialize_provider(doc)}


@router.patch("/ai/providers/{name}")
async def provider_update(name: str, body: ProviderUpdate, request: Request, actor: Dict[str, Any] = Depends(require_super_admin)):
    db = get_db(request)
    existing = await db.admin_ai_providers.find_one({"name": name})
    if not existing:
        raise HTTPException(404, "Provider not found")
    patch: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if body.label is not None:
        patch["label"] = body.label
    if body.endpoint is not None:
        patch["endpoint"] = body.endpoint
    if body.region is not None:
        patch["region"] = body.region
    if body.enabled is not None:
        patch["enabled"] = body.enabled
    if body.api_key is not None and body.api_key != "":
        patch["api_key_enc"] = enc(body.api_key)
    if body.secret_key is not None and body.secret_key != "":
        patch["secret_key_enc"] = enc(body.secret_key)
    await db.admin_ai_providers.update_one({"name": name}, {"$set": patch})
    await audit(db, actor=actor, action="provider.updated", target=name, new=list(patch.keys()), ip=_client_ip(request))
    fresh = await db.admin_ai_providers.find_one({"name": name})
    return {"ok": True, "provider": _serialize_provider(fresh)}


@router.delete("/ai/providers/{name}")
async def provider_delete(name: str, request: Request, actor: Dict[str, Any] = Depends(require_super_admin)):
    db = get_db(request)
    r = await db.admin_ai_providers.delete_one({"name": name})
    await audit(db, actor=actor, action="provider.deleted", target=name, ip=_client_ip(request))
    return {"ok": r.deleted_count > 0}


# Per-feature model assignment (primary + fallback chain)
@router.get("/ai/feature-models")
async def feature_models_list(request: Request, user: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    rows = await db.admin_feature_models.find({}, {"_id": 0}).to_list(100)
    return {"items": rows}


@router.post("/ai/feature-models")
async def feature_models_assign(body: FeatureModelAssign, request: Request, actor: Dict[str, Any] = Depends(require_super_admin)):
    db = get_db(request)
    existing = await db.admin_feature_models.find_one({"feature": body.feature}, {"_id": 0})
    prev = existing.copy() if existing else None
    doc = {
        "feature": body.feature,
        "primary_model_id": body.primary_model_id,
        "fallback_model_ids": body.fallback_model_ids,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.admin_feature_models.update_one({"feature": body.feature}, {"$set": doc}, upsert=True)
    await audit(db, actor=actor, action="feature_model.assigned", target=body.feature, previous=prev, new=doc, ip=_client_ip(request))
    return {"ok": True, "item": doc}


# AI usage ingestion (admin-only) — for other modules / cron jobs to push usage rows
@router.post("/ai/usage")
async def ai_usage_ingest(body: AIUsageIngest, request: Request, actor: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    row = body.model_dump()
    row["id"] = str(uuid.uuid4())
    row["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.admin_ai_usage.insert_one(row)
    return {"ok": True, "id": row["id"]}


@router.get("/ai/usage")
async def ai_usage_list(request: Request, days: int = 7, limit: int = 100, user: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    since = (datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 90)))).isoformat()
    rows = await db.admin_ai_usage.find({"created_at": {"$gte": since}}, {"_id": 0}).sort("created_at", -1).limit(min(limit, 500)).to_list(500)
    by_provider: Dict[str, Dict[str, float]] = {}
    by_model: Dict[str, Dict[str, float]] = {}
    by_feature: Dict[str, Dict[str, float]] = {}
    for r in rows:
        for bucket, key in ((by_provider, r.get("provider", "?")),
                                  (by_model, r.get("model_id", "?")),
                                  (by_feature, r.get("feature", "chat"))):
            b = bucket.setdefault(key, {"requests": 0, "cost_usd": 0.0, "tokens": 0})
            b["requests"] += 1
            b["cost_usd"] += float(r.get("cost_usd", 0.0))
            b["tokens"] += int(r.get("input_tokens", 0)) + int(r.get("output_tokens", 0))
    for bucket in (by_provider, by_model, by_feature):
        for k, v in bucket.items():
            v["cost_usd"] = round(v["cost_usd"], 4)
    return {"items": rows[:limit], "by_provider": by_provider, "by_model": by_model, "by_feature": by_feature}


# Budgets
@router.get("/ai/budget")
async def budget_get(request: Request, user: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    doc = await db.admin_budgets.find_one({"key": "monthly"}, {"_id": 0})
    if not doc:
        doc = {"key": "monthly", "monthly_usd": 500.0, "alert_pct": [50, 75, 90, 100], "email_to": ""}
    # compute current usage
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    cur = db.admin_ai_usage.aggregate([
        {"$match": {"created_at": {"$gte": month_start}}},
        {"$group": {"_id": None, "spent": {"$sum": "$cost_usd"}}},
    ])
    rows = await cur.to_list(1)
    spent = round(float(rows[0]["spent"]), 4) if rows else 0.0
    pct = round(100.0 * spent / max(0.0001, doc.get("monthly_usd", 1.0)), 2)
    return {"budget": doc, "spent_usd": spent, "spent_pct": pct}


@router.put("/ai/budget")
async def budget_set(body: BudgetSet, request: Request, actor: Dict[str, Any] = Depends(require_super_admin)):
    db = get_db(request)
    doc = {"key": "monthly", **body.model_dump(), "updated_at": datetime.now(timezone.utc).isoformat()}
    await db.admin_budgets.update_one({"key": "monthly"}, {"$set": doc}, upsert=True)
    await audit(db, actor=actor, action="budget.updated", new=doc, ip=_client_ip(request))
    return {"ok": True, "budget": doc}


# ==================== Prompt management ====================
@router.get("/prompts")
async def prompts_list(request: Request, user: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    # latest published + draft per key
    rows = await db.admin_prompts.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    by_key: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        k = r["key"]
        slot = by_key.setdefault(k, {"key": k, "label": r.get("label", ""), "versions": []})
        slot["versions"].append(r)
    return {"items": list(by_key.values())}


@router.post("/prompts")
async def prompt_create(body: PromptBody, request: Request, actor: Dict[str, Any] = Depends(require_super_admin)):
    db = get_db(request)
    doc = {
        "id": str(uuid.uuid4()),
        "key": body.key,
        "label": body.label or body.key,
        "body": body.body,
        "mode": body.mode,
        "version": int(datetime.now(timezone.utc).timestamp()),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": actor.get("email"),
    }
    if body.mode == "published":
        # demote previously published
        await db.admin_prompts.update_many({"key": body.key, "mode": "published"}, {"$set": {"mode": "archived"}})
    await db.admin_prompts.insert_one(doc)
    doc.pop("_id", None)
    await audit(db, actor=actor, action="prompt.saved", target=body.key, new={"mode": body.mode, "version": doc["version"]}, ip=_client_ip(request))
    return {"ok": True, "item": doc}


@router.post("/prompts/{prompt_id}/publish")
async def prompt_publish(prompt_id: str, request: Request, actor: Dict[str, Any] = Depends(require_super_admin)):
    db = get_db(request)
    doc = await db.admin_prompts.find_one({"id": prompt_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Version not found")
    await db.admin_prompts.update_many({"key": doc["key"], "mode": "published"}, {"$set": {"mode": "archived"}})
    await db.admin_prompts.update_one({"id": prompt_id}, {"$set": {"mode": "published"}})
    await audit(db, actor=actor, action="prompt.published", target=doc["key"], new={"version": doc["version"]}, ip=_client_ip(request))
    return {"ok": True}


@router.post("/prompts/{prompt_id}/rollback")
async def prompt_rollback(prompt_id: str, request: Request, actor: Dict[str, Any] = Depends(require_super_admin)):
    """Promote a historical version back to 'published'."""
    db = get_db(request)
    doc = await db.admin_prompts.find_one({"id": prompt_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Version not found")
    await db.admin_prompts.update_many({"key": doc["key"], "mode": "published"}, {"$set": {"mode": "archived"}})
    await db.admin_prompts.update_one({"id": prompt_id}, {"$set": {"mode": "published"}})
    await audit(db, actor=actor, action="prompt.rollback", target=doc["key"], new={"version": doc["version"]}, ip=_client_ip(request))
    return {"ok": True}


@router.delete("/prompts/{prompt_id}")
async def prompt_delete(prompt_id: str, request: Request, actor: Dict[str, Any] = Depends(require_super_admin)):
    db = get_db(request)
    r = await db.admin_prompts.delete_one({"id": prompt_id})
    await audit(db, actor=actor, action="prompt.deleted", target=prompt_id, ip=_client_ip(request))
    return {"ok": r.deleted_count > 0}


# ==================== Feature flags ====================
@router.get("/features")
async def features_list(request: Request, user: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    rows = await db.admin_feature_flags.find({}, {"_id": 0}).to_list(200)
    return {"items": rows}


@router.put("/features")
async def features_upsert(body: FeatureFlagBody, request: Request, actor: Dict[str, Any] = Depends(require_super_admin)):
    db = get_db(request)
    prev = await db.admin_feature_flags.find_one({"key": body.key}, {"_id": 0})
    doc = {
        "key": body.key,
        "label": body.label or body.key,
        "status": body.status,
        "rollout_pct": max(0, min(100, body.rollout_pct)),
        "audience": body.audience,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "created_at": (prev or {}).get("created_at", datetime.now(timezone.utc).isoformat()),
    }
    await db.admin_feature_flags.update_one({"key": body.key}, {"$set": doc}, upsert=True)
    await audit(db, actor=actor, action="feature_flag.upserted", target=body.key, previous=prev, new=doc, ip=_client_ip(request))
    return {"ok": True, "item": doc}


@router.delete("/features/{key}")
async def feature_delete(key: str, request: Request, actor: Dict[str, Any] = Depends(require_super_admin)):
    db = get_db(request)
    r = await db.admin_feature_flags.delete_one({"key": key})
    await audit(db, actor=actor, action="feature_flag.deleted", target=key, ip=_client_ip(request))
    return {"ok": r.deleted_count > 0}


# ==================== Subscriptions / plans ====================
@router.get("/subscriptions/plans")
async def plans_list(request: Request, user: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    rows = await db.admin_subscriptions.find({}, {"_id": 0}).to_list(50)
    return {"items": rows}


@router.put("/subscriptions/plans")
async def plans_upsert(body: SubscriptionPlanBody, request: Request, actor: Dict[str, Any] = Depends(require_super_admin)):
    db = get_db(request)
    doc = {**body.model_dump(), "updated_at": datetime.now(timezone.utc).isoformat()}
    await db.admin_subscriptions.update_one({"key": body.key}, {"$set": doc}, upsert=True)
    await audit(db, actor=actor, action="plan.upserted", target=body.key, new=doc, ip=_client_ip(request))
    return {"ok": True, "item": doc}


@router.get("/billing/summary")
async def billing_summary(request: Request, user: Dict[str, Any] = Depends(require_admin)):
    """Read-only billing snapshot. (Real Stripe integration intentionally deferred.)"""
    db = get_db(request)
    plans = await db.admin_subscriptions.find({}, {"_id": 0}).to_list(50)
    plan_price = {p["key"]: float(p.get("price_usd_monthly", 0.0)) for p in plans}
    plan_dist: Dict[str, int] = {}
    async for u in db.users.find({}, {"plan": 1}):
        k = u.get("plan") or "free"
        plan_dist[k] = plan_dist.get(k, 0) + 1
    mrr = sum(plan_dist.get(k, 0) * v for k, v in plan_price.items())
    return {
        "mrr": round(mrr, 2),
        "arr": round(mrr * 12, 2),
        "active_subscriptions": sum(v for k, v in plan_dist.items() if k != "free"),
        "free_users": plan_dist.get("free", 0),
        "plan_distribution": plan_dist,
        "plan_prices": plan_price,
        "failed_payments": 0,
        "refunds_30d": 0,
        "note": "Connect Stripe to populate live numbers.",
    }


# ==================== Audit log ====================
@router.get("/audit")
async def audit_list(request: Request, limit: int = 100, q: str = "", user: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    f: Dict[str, Any] = {}
    if q:
        f["$or"] = [{"action": {"$regex": q, "$options": "i"}},
                       {"actor_email": {"$regex": q, "$options": "i"}},
                       {"target": {"$regex": q, "$options": "i"}}]
    rows = await db.admin_audit.find(f, {"_id": 0}).sort("created_at", -1).limit(min(limit, 500)).to_list(500)
    return {"items": rows}


# ==================== Security center ====================
@router.get("/security/overview")
async def security_overview(request: Request, user: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    now = datetime.now(timezone.utc)
    day_ago = (now - timedelta(days=1)).isoformat()
    week_ago = (now - timedelta(days=7)).isoformat()

    failed = await db.audit_events.count_documents({"event": {"$in": ["otp.failed", "login.failed"]}, "created_at": {"$gte": day_ago}})
    rate_limited = await db.audit_events.count_documents({"event": "otp.rate_limited", "created_at": {"$gte": day_ago}})
    new_devices = await db.audit_events.count_documents({"event": {"$in": ["login.email_otp", "login.google"]}, "meta.new_device": True, "created_at": {"$gte": week_ago}})
    blocked_users = await db.users.count_documents({"status": {"$in": ["suspended", "banned"]}})

    suspicious = await db.audit_events.find(
        {"$or": [{"event": "otp.failed"}, {"event": "otp.rate_limited"}],
          "created_at": {"$gte": week_ago}}, {"_id": 0}
    ).sort("created_at", -1).limit(50).to_list(50)

    return {
        "failed_logins_24h": failed,
        "rate_limit_violations_24h": rate_limited,
        "new_device_logins_7d": new_devices,
        "blocked_users": blocked_users,
        "suspicious_recent": suspicious,
    }


# ==================== System health ====================
@router.get("/health/snapshot")
async def health_snapshot(request: Request, user: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    # Mongo ping
    try:
        await db.command("ping")
        mongo = {"status": "healthy", "detail": "ping ok"}
    except Exception as e:
        mongo = {"status": "critical", "detail": str(e)}

    # Backend
    backend = {"status": "healthy", "detail": "server.py up"}

    # Provider health — quick presence check, no live ping (saves credits)
    providers = await db.admin_ai_providers.find({}, {"_id": 0}).to_list(100)
    prov_health: List[Dict[str, Any]] = []
    for p in providers:
        has_creds = bool(p.get("api_key_enc")) or p.get("name") == "ollama"
        status = "healthy" if (p.get("enabled") and has_creds) else ("warning" if p.get("enabled") else "disabled")
        prov_health.append({
            "name": p.get("name"),
            "label": p.get("label") or PROVIDER_LABELS.get(p.get("name", ""), p.get("name", "")),
            "enabled": p.get("enabled", False),
            "status": status,
        })

    # Storage / disk-ish guess
    storage_doc = await db.command("dbStats")
    storage = {
        "data_size_mb": round(float(storage_doc.get("dataSize", 0)) / 1024 / 1024, 2),
        "storage_size_mb": round(float(storage_doc.get("storageSize", 0)) / 1024 / 1024, 2),
        "objects": storage_doc.get("objects", 0),
    }

    snapshot = {
        "frontend": {"status": "healthy", "detail": "Expo dev server"},
        "backend": backend,
        "database": mongo,
        "storage": storage,
        "providers": prov_health,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.admin_system_health.update_one({"key": "snapshot"}, {"$set": {"key": "snapshot", **snapshot}}, upsert=True)
    return snapshot


# ==================== Notifications ====================
@router.get("/notifications")
async def notifications_list(request: Request, user: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    rows = await db.admin_notifications.find({}, {"_id": 0}).sort("created_at", -1).limit(100).to_list(100)
    return {"items": rows}


@router.post("/notifications")
async def notifications_send(body: NotificationBody, request: Request, actor: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    audience_filter: Dict[str, Any] = {}
    if body.audience == "selected" and body.user_ids:
        audience_filter = {"id": {"$in": body.user_ids}}
    elif body.audience in ("premium", "enterprise"):
        audience_filter = {"plan": body.audience}
    elif body.audience == "beta":
        audience_filter = {"role": {"$in": ["beta", "admin", "super_admin"]}}
    # else "all" -> no filter
    recipient_count = await db.users.count_documents(audience_filter) if body.audience != "all" else await db.users.count_documents({})
    doc = {
        "id": str(uuid.uuid4()),
        "channel": body.channel,
        "title": body.title[:160],
        "body": body.body[:4000],
        "audience": body.audience,
        "user_ids": body.user_ids,
        "recipients_estimated": recipient_count,
        "status": "queued",
        "created_by": actor.get("email"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.admin_notifications.insert_one(doc)
    doc.pop("_id", None)
    # Lightweight delivery: insert per-user announcement rows so the app can show them
    if body.channel == "announcement":
        targets = await db.users.find(audience_filter, {"id": 1}).to_list(50000)
        if targets:
            batch = [{
                "id": str(uuid.uuid4()),
                "user_id": t["id"],
                "title": doc["title"],
                "body": doc["body"],
                "kind": "announcement",
                "created_at": doc["created_at"],
                "read": False,
            } for t in targets]
            try:
                await db.notifications.insert_many(batch)
            except Exception:
                pass
        await db.admin_notifications.update_one({"id": doc["id"]}, {"$set": {"status": "delivered"}})
    await audit(db, actor=actor, action=f"notification.{body.channel}", target=body.audience, new={"id": doc["id"], "recipients": recipient_count}, ip=_client_ip(request))
    return {"ok": True, "item": doc, "recipients_estimated": recipient_count}


# ==================== Configuration ====================
@router.get("/config")
async def config_get(request: Request, user: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    doc = await db.admin_config.find_one({"key": "platform"}, {"_id": 0}) or {
        "key": "platform",
        "app_name": "ORA OS",
        "logo_url": "",
        "primary_color": "#0a0a0c",
        "accent_color": "#E1B168",
        "theme": "dark",
        "support_email": "support@oraos.app",
        "support_phone": "",
        "privacy_url": "/api/legal/privacy",
        "terms_url": "/api/legal/terms",
        "cookies_url": "/api/legal/cookies",
    }
    return doc


@router.put("/config")
async def config_set(body: ConfigBody, request: Request, actor: Dict[str, Any] = Depends(require_super_admin)):
    db = get_db(request)
    prev = await db.admin_config.find_one({"key": "platform"}, {"_id": 0})
    patch: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for k, v in body.model_dump(exclude_none=True).items():
        patch[k] = v
    await db.admin_config.update_one({"key": "platform"}, {"$set": {"key": "platform", **patch}}, upsert=True)
    await audit(db, actor=actor, action="config.updated", previous=prev, new=patch, ip=_client_ip(request))
    fresh = await db.admin_config.find_one({"key": "platform"}, {"_id": 0})
    return {"ok": True, "config": fresh}


# ==================== Analytics ====================
@router.get("/analytics/overview")
async def analytics_overview(request: Request, user: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    now = datetime.now(timezone.utc)
    week_ago = (now - timedelta(days=7)).isoformat()

    # Feature usage proxy — count audit_events by event prefix
    cur = db.audit_events.aggregate([
        {"$match": {"created_at": {"$gte": week_ago}}},
        {"$group": {"_id": "$event", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 50},
    ])
    feature_usage = [{"event": r["_id"], "count": r["count"]} async for r in cur]

    # Session duration proxy — average gap between created_at & last_seen_at on login_sessions
    pipe = [
        {"$match": {"last_seen_at": {"$exists": True}, "created_at": {"$exists": True}}},
        {"$project": {"diff_min": {"$divide": [{"$subtract": [{"$dateFromString": {"dateString": "$last_seen_at"}}, {"$dateFromString": {"dateString": "$created_at"}}]}, 60000]}}},
        {"$group": {"_id": None, "avg_min": {"$avg": "$diff_min"}, "max_min": {"$max": "$diff_min"}, "n": {"$sum": 1}}},
    ]
    try:
        rows = await db.login_sessions.aggregate(pipe).to_list(1)
    except Exception:
        rows = []
    sess = rows[0] if rows else {}

    # Retention proxy — D1, D7 stickiness
    total_signups = await db.users.count_documents({})
    repeated = await db.login_sessions.aggregate([
        {"$group": {"_id": "$user_id", "logins": {"$sum": 1}}},
        {"$match": {"logins": {"$gt": 1}}},
        {"$count": "n"},
    ]).to_list(1)
    repeat_users = repeated[0]["n"] if repeated else 0
    retention = round(100.0 * repeat_users / total_signups, 2) if total_signups else 0.0

    return {
        "feature_usage_7d": feature_usage,
        "session_duration": {
            "avg_minutes": round(float(sess.get("avg_min", 0)), 2),
            "max_minutes": round(float(sess.get("max_min", 0)), 2),
            "sample_size": int(sess.get("n", 0)),
        },
        "retention": {"return_rate_pct": retention, "repeat_users": repeat_users, "total_users": total_signups},
    }


# ==================== Support center ====================
@router.get("/support/tickets")
async def support_list(request: Request, status: str = "", user: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    f: Dict[str, Any] = {}
    if status:
        f["status"] = status
    rows = await db.support_tickets.find(f, {"_id": 0}).sort("created_at", -1).limit(200).to_list(200)
    return {"items": rows}


@router.put("/support/tickets/{ticket_id}")
async def support_update(ticket_id: str, body: Dict[str, Any] = Body(...), request: Request = None, actor: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    patch: Dict[str, Any] = {}
    for k in ("status", "priority", "assignee_email", "resolution_notes"):
        if k in body:
            patch[k] = body[k]
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    r = await db.support_tickets.update_one({"id": ticket_id}, {"$set": patch})
    if r.matched_count == 0:
        raise HTTPException(404, "Ticket not found")
    await audit(db, actor=actor, action="ticket.updated", target=ticket_id, new=patch, ip=_client_ip(request))
    return {"ok": True}


# ==================== Indexes + bootstrap defaults ====================
async def ensure_indexes(db) -> None:
    await db.admin_audit.create_index("created_at")
    await db.admin_audit.create_index("actor_id")
    await db.admin_ai_providers.create_index("name", unique=True)
    await db.admin_feature_models.create_index("feature", unique=True)
    await db.admin_ai_usage.create_index("created_at")
    await db.admin_ai_usage.create_index("provider")
    await db.admin_feature_flags.create_index("key", unique=True)
    await db.admin_prompts.create_index("key")
    await db.admin_prompts.create_index("created_at")
    await db.admin_notifications.create_index("created_at")
    await db.admin_subscriptions.create_index("key", unique=True)


DEFAULT_PLANS = [
    {"key": "free", "label": "Free", "price_usd_monthly": 0.0, "storage_gb": 0.5, "monthly_token_limit": 50000, "upload_limit_mb": 20, "ai_requests_per_day": 50, "features": ["chat", "memories", "journal"]},
    {"key": "pro", "label": "Pro", "price_usd_monthly": 9.0, "storage_gb": 5.0, "monthly_token_limit": 500000, "upload_limit_mb": 100, "ai_requests_per_day": 500, "features": ["chat", "memories", "journal", "voice", "knowledge", "calls"]},
    {"key": "premium", "label": "Premium", "price_usd_monthly": 19.0, "storage_gb": 25.0, "monthly_token_limit": 2_000_000, "upload_limit_mb": 250, "ai_requests_per_day": 2000, "features": ["everything"]},
    {"key": "enterprise", "label": "Enterprise", "price_usd_monthly": 99.0, "storage_gb": 200.0, "monthly_token_limit": 20_000_000, "upload_limit_mb": 1024, "ai_requests_per_day": 20000, "features": ["everything", "sso", "priority_support"]},
]

DEFAULT_FEATURE_FLAGS = [
    "chat", "voice_assistant", "ai_calls", "journal", "memory_bank",
    "knowledge_vault", "knowledge_graph", "family_hub", "health",
    "finance_brain", "career_copilot", "digital_twin", "daily_briefing",
    "chief_of_staff", "search_everything",
]


async def bootstrap_defaults(db) -> None:
    for plan in DEFAULT_PLANS:
        await db.admin_subscriptions.update_one(
            {"key": plan["key"]},
            {"$setOnInsert": plan},
            upsert=True,
        )
    for k in DEFAULT_FEATURE_FLAGS:
        await db.admin_feature_flags.update_one(
            {"key": k},
            {"$setOnInsert": {
                "key": k, "label": k.replace("_", " ").title(),
                "status": "enabled", "rollout_pct": 100, "audience": [],
                "created_at": datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True,
        )
    # default provider stub (no keys) for Bedrock so dashboard isn't empty
    if await db.admin_ai_providers.count_documents({}) == 0:
        await db.admin_ai_providers.insert_one({
            "id": str(uuid.uuid4()),
            "name": "bedrock",
            "label": PROVIDER_LABELS["bedrock"],
            "api_key_enc": "",
            "secret_key_enc": "",
            "endpoint": "",
            "region": os.environ.get("AWS_REGION", "us-east-1"),
            "enabled": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
    # default feature -> model mapping (chat -> bedrock nova-lite)
    if await db.admin_feature_models.count_documents({}) == 0:
        await db.admin_feature_models.insert_one({
            "feature": "chat",
            "primary_model_id": os.environ.get("BEDROCK_MODEL_ID", "amazon.nova-lite-v1:0"),
            "fallback_model_ids": [],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })



# ==================== PHASE 4 — live routing, per-user analytics, finance, impersonation, infra ====================

# ---- Per-user usage analytics ----
@router.get("/users/{user_id}/usage")
async def user_usage(user_id: str, request: Request, days: int = 30, user: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(404, "User not found")
    since = (datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 365)))).isoformat()
    # Counts
    counts: Dict[str, int] = {}
    for k, coll, field in [
        ("chat_sessions", "chat_sessions", "user_id"),
        ("messages", "chat_messages", "user_id"),
        ("memories", "memories", "user_id"),
        ("documents", "knowledge_docs", "user_id"),
        ("voice_calls", "phone_calls", "user_id"),
        ("missed_calls", "missed_call_reminders", "user_id"),
        ("journal_entries", "journal_entries", "user_id"),
        ("goals", "goals", "user_id"),
        ("reminders", "reminders", "user_id"),
        ("applications", "career_applications", "user_id"),
        ("transactions", "transactions", "user_id"),
        ("calendar_events", "calendar_events", "user_id"),
    ]:
        try:
            counts[k] = await db[coll].count_documents({field: user_id})
        except Exception:
            counts[k] = 0
    # AI usage rolled up
    pipe = [
        {"$match": {"user_id": user_id, "created_at": {"$gte": since}}},
        {"$group": {"_id": None,
                       "requests": {"$sum": 1},
                       "input_tokens": {"$sum": "$input_tokens"},
                       "output_tokens": {"$sum": "$output_tokens"},
                       "cost_usd": {"$sum": "$cost_usd"},
                       "errors": {"$sum": {"$cond": ["$success", 0, 1]}}}},
    ]
    agg = await db.admin_ai_usage.aggregate(pipe).to_list(1)
    a = agg[0] if agg else {}
    ai_stats = {
        "requests": int(a.get("requests", 0)),
        "input_tokens": int(a.get("input_tokens", 0)),
        "output_tokens": int(a.get("output_tokens", 0)),
        "total_tokens": int(a.get("input_tokens", 0)) + int(a.get("output_tokens", 0)),
        "cost_usd": round(float(a.get("cost_usd", 0.0)), 4),
        "errors": int(a.get("errors", 0)),
    }
    # By-feature breakdown
    feat_pipe = [
        {"$match": {"user_id": user_id, "created_at": {"$gte": since}}},
        {"$group": {"_id": "$feature", "requests": {"$sum": 1}, "cost_usd": {"$sum": "$cost_usd"}, "tokens": {"$sum": {"$add": ["$input_tokens", "$output_tokens"]}}}},
        {"$sort": {"requests": -1}},
    ]
    by_feature = []
    async for r in db.admin_ai_usage.aggregate(feat_pipe):
        by_feature.append({"feature": r["_id"] or "unknown", "requests": r["requests"],
                                  "cost_usd": round(float(r.get("cost_usd", 0.0)), 4),
                                  "tokens": int(r.get("tokens", 0))})
    # Storage estimate
    storage_bytes = 0
    try:
        cur = db.knowledge_docs.aggregate([
            {"$match": {"user_id": user_id}},
            {"$group": {"_id": None, "bytes": {"$sum": {"$ifNull": ["$file_size", 0]}}}},
        ])
        row = await cur.to_list(1)
        if row:
            storage_bytes = int(row[0].get("bytes", 0))
    except Exception:
        pass
    # Active sessions / last login / devices
    sessions = await db.login_sessions.find({"user_id": user_id, "revoked": {"$ne": True}}, {"_id": 0}).sort("last_seen_at", -1).to_list(20)
    last_seen = sessions[0]["last_seen_at"] if sessions else target.get("updated_at")
    devices = list({(s.get("device_label") or "?") for s in sessions})

    return {
        "user": {
            "id": target["id"], "email": target.get("email"), "name": target.get("name"),
            "plan": target.get("plan"), "role": target.get("role"),
            "status": target.get("status", "active"),
            "created_at": target.get("created_at"),
            "last_seen_at": last_seen,
            "last_device": devices[0] if devices else None,
            "devices": devices,
        },
        "counts": counts,
        "ai": ai_stats,
        "by_feature": by_feature,
        "storage": {"bytes": storage_bytes, "mb": round(storage_bytes / 1024 / 1024, 2)},
        "active_sessions": len(sessions),
    }


# ---- Finance intelligence: revenue / cost / margin ----
@router.get("/finance/intelligence")
async def finance_intelligence(request: Request, days: int = 30, user: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    days = max(7, min(days, 365))
    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=days)).isoformat()

    # Revenue from plans × user_count
    plans = await db.admin_subscriptions.find({}, {"_id": 0}).to_list(50)
    plan_price = {p["key"]: float(p.get("price_usd_monthly", 0.0)) for p in plans}
    plan_dist: Dict[str, int] = {}
    async for u in db.users.find({}, {"plan": 1}):
        k = u.get("plan") or "free"
        plan_dist[k] = plan_dist.get(k, 0) + 1
    mrr = sum(plan_dist.get(k, 0) * v for k, v in plan_price.items())
    revenue = round(mrr * (days / 30.0), 2)

    # AI cost
    cur = db.admin_ai_usage.aggregate([
        {"$match": {"created_at": {"$gte": since}}},
        {"$group": {"_id": None, "cost": {"$sum": "$cost_usd"}}},
    ])
    rows = await cur.to_list(1)
    ai_cost = round(float(rows[0]["cost"]) if rows else 0.0, 4)

    # Storage cost — rough estimate from dbStats * $0.10/GB/mo
    try:
        st = await db.command("dbStats")
        storage_gb = float(st.get("storageSize", 0)) / (1024 ** 3)
    except Exception:
        storage_gb = 0.0
    storage_cost = round(storage_gb * 0.10 * (days / 30.0), 4)

    # Voice cost — rough estimate $0.18/min from phone_calls.duration_sec
    voice_pipe = [
        {"$match": {"created_at": {"$gte": since}, "duration_sec": {"$exists": True}}},
        {"$group": {"_id": None, "secs": {"$sum": "$duration_sec"}, "calls": {"$sum": 1}}},
    ]
    vrow = await db.phone_calls.aggregate(voice_pipe).to_list(1)
    voice_secs = int(vrow[0]["secs"]) if vrow else 0
    voice_calls = int(vrow[0]["calls"]) if vrow else 0
    voice_cost = round((voice_secs / 60.0) * 0.18, 4)

    total_cost = round(ai_cost + storage_cost + voice_cost, 4)
    profit = round(revenue - total_cost, 4)
    margin_pct = round(100.0 * profit / revenue, 2) if revenue > 0 else 0.0

    # Time series
    series = []
    for i in range(days - 1, -1, -1):
        day = (now - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        nxt = day + timedelta(days=1)
        cur2 = db.admin_ai_usage.aggregate([
            {"$match": {"created_at": {"$gte": day.isoformat(), "$lt": nxt.isoformat()}}},
            {"$group": {"_id": None, "cost": {"$sum": "$cost_usd"}}},
        ])
        rr = await cur2.to_list(1)
        c = round(float(rr[0]["cost"]) if rr else 0.0, 4)
        series.append({"date": day.date().isoformat(),
                              "revenue": round(mrr / 30.0, 2), "cost": c,
                              "profit": round(mrr / 30.0 - c, 4)})
    return {
        "window_days": days,
        "revenue": revenue, "mrr": round(mrr, 2),
        "ai_cost": ai_cost, "storage_cost": storage_cost, "voice_cost": voice_cost,
        "total_cost": total_cost, "profit": profit, "margin_pct": margin_pct,
        "voice": {"calls": voice_calls, "minutes": round(voice_secs / 60.0, 1)},
        "plan_distribution": plan_dist, "plan_prices": plan_price,
        "series": series,
    }


# ---- User-growth series (new + active per day) ----
@router.get("/metrics/user-growth")
async def user_growth(request: Request, days: int = 30, user: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    days = max(7, min(days, 365))
    now = datetime.now(timezone.utc)
    series = []
    for i in range(days - 1, -1, -1):
        day = (now - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        nxt = day + timedelta(days=1)
        n_new = await db.users.count_documents({"created_at": {"$gte": day.isoformat(), "$lt": nxt.isoformat()}})
        active_ids = await db.login_sessions.distinct("user_id", {"last_seen_at": {"$gte": day.isoformat(), "$lt": nxt.isoformat()}})
        churned = await db.users.count_documents({"updated_at": {"$gte": day.isoformat(), "$lt": nxt.isoformat()}, "status": {"$in": ["suspended", "banned"]}})
        series.append({"date": day.date().isoformat(),
                              "new_users": n_new, "active": len(active_ids), "churn": churned})
    return {"series": series}


# ---- AI usage heatmap (hour × day-of-week) ----
@router.get("/metrics/usage-heatmap")
async def usage_heatmap(request: Request, days: int = 30, user: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    days = max(7, min(days, 90))
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    pipe = [
        {"$match": {"created_at": {"$gte": since}}},
        {"$project": {"d": {"$dateFromString": {"dateString": "$created_at"}}, "cost_usd": 1}},
        {"$group": {
            "_id": {"hour": {"$hour": "$d"}, "dow": {"$dayOfWeek": "$d"}},
            "requests": {"$sum": 1},
            "cost": {"$sum": "$cost_usd"},
        }},
    ]
    # 7 (Sun..Sat) × 24 grid
    grid = [[0 for _ in range(24)] for _ in range(7)]
    cost_grid = [[0.0 for _ in range(24)] for _ in range(7)]
    async for r in db.admin_ai_usage.aggregate(pipe):
        dow = int(r["_id"]["dow"]) - 1  # 1..7 -> 0..6
        h = int(r["_id"]["hour"])
        grid[dow][h] = int(r["requests"])
        cost_grid[dow][h] = round(float(r["cost"]), 4)
    return {"grid": grid, "cost_grid": cost_grid, "rows": ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]}


# ---- Live provider health (real ping) ----
@router.get("/health/providers-live")
async def providers_live(request: Request, user: Dict[str, Any] = Depends(require_admin)):
    import httpx
    import time
    db = get_db(request)
    providers = await db.admin_ai_providers.find({}, {"_id": 0}).to_list(100)
    out: List[Dict[str, Any]] = []
    timeout = httpx.Timeout(4.0, connect=2.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as http:
        for p in providers:
            name = p.get("name")
            url = None
            if name == "bedrock":
                region = p.get("region") or os.environ.get("AWS_REGION", "us-east-1")
                url = f"https://bedrock-runtime.{region}.amazonaws.com"
            elif name == "openai":
                url = "https://api.openai.com/v1/models"
            elif name == "anthropic":
                url = "https://api.anthropic.com/v1/models"
            elif name == "gemini":
                url = "https://generativelanguage.googleapis.com/"
            elif name == "azure":
                url = p.get("endpoint") or None
            elif name == "groq":
                url = "https://api.groq.com/openai/v1/models"
            elif name == "deepseek":
                url = "https://api.deepseek.com"
            elif name == "ollama":
                url = p.get("endpoint") or "http://localhost:11434"
            status = "unknown"
            latency = None
            detail = ""
            if not p.get("enabled"):
                status = "disabled"
            elif not url:
                status = "warning"
                detail = "no endpoint configured"
            else:
                try:
                    t0 = time.perf_counter()
                    r = await http.get(url)
                    latency = int((time.perf_counter() - t0) * 1000)
                    # Many endpoints respond 401/403 without creds — that still means the service is up
                    if r.status_code < 500:
                        status = "healthy"
                        detail = f"HTTP {r.status_code}"
                    else:
                        status = "critical"
                        detail = f"HTTP {r.status_code}"
                except Exception as e:
                    status = "critical"
                    detail = str(e)[:140]
            out.append({"name": name, "label": p.get("label"), "enabled": p.get("enabled", False),
                              "status": status, "latency_ms": latency, "detail": detail,
                              "url": url})
    return {"providers": out, "checked_at": datetime.now(timezone.utc).isoformat()}


# ---- Infrastructure (CPU / memory / disk / DB / latency) ----
@router.get("/infrastructure")
async def infrastructure(request: Request, user: Dict[str, Any] = Depends(require_admin)):
    import time
    db = get_db(request)
    info: Dict[str, Any] = {"checked_at": datetime.now(timezone.utc).isoformat()}
    try:
        import psutil  # type: ignore
        cpu_pct = psutil.cpu_percent(interval=0.2)
        vm = psutil.virtual_memory()
        du = psutil.disk_usage("/")
        load = list(getattr(psutil, "getloadavg", lambda: (0, 0, 0))())
        info["cpu"] = {"percent": cpu_pct, "count": psutil.cpu_count(), "load_avg": load}
        info["memory"] = {"percent": vm.percent, "used_mb": int(vm.used / 1024 / 1024), "total_mb": int(vm.total / 1024 / 1024)}
        info["disk"] = {"percent": du.percent, "used_gb": round(du.used / 1024 / 1024 / 1024, 2), "total_gb": round(du.total / 1024 / 1024 / 1024, 2)}
    except Exception as e:
        info["cpu"] = {"error": str(e)}
        info["memory"] = {}
        info["disk"] = {}
    # DB ping latency
    try:
        t0 = time.perf_counter()
        await db.command("ping")
        info["database"] = {"status": "healthy", "ping_ms": int((time.perf_counter() - t0) * 1000)}
        stats = await db.command("dbStats")
        info["database"]["objects"] = stats.get("objects", 0)
        info["database"]["data_size_mb"] = round(float(stats.get("dataSize", 0)) / 1024 / 1024, 2)
        info["database"]["storage_size_mb"] = round(float(stats.get("storageSize", 0)) / 1024 / 1024, 2)
    except Exception as e:
        info["database"] = {"status": "critical", "error": str(e)}
    # Redis (best-effort) — not configured here but check env
    redis_url = os.environ.get("REDIS_URL")
    info["redis"] = {"configured": bool(redis_url), "status": "not_configured" if not redis_url else "unknown"}
    # API latency proxy — sample last 50 ai_usage rows
    cur = db.admin_ai_usage.find({}, {"_id": 0, "latency_ms": 1}).sort("created_at", -1).limit(100)
    lat_list = [r["latency_ms"] async for r in cur if r.get("latency_ms")]
    if lat_list:
        lat_list.sort()
        info["api_latency_ms"] = {
            "samples": len(lat_list),
            "p50": lat_list[len(lat_list) // 2],
            "p95": lat_list[int(len(lat_list) * 0.95)] if len(lat_list) > 1 else lat_list[-1],
            "max": lat_list[-1],
        }
    else:
        info["api_latency_ms"] = {"samples": 0}
    return info


# ---- User impersonation (super-admin only) ----
class ImpersonateBody(BaseModel):
    reason: str = "support"
    duration_minutes: int = 60


@router.post("/users/{user_id}/impersonate")
async def impersonate(user_id: str, body: ImpersonateBody, request: Request, actor: Dict[str, Any] = Depends(require_super_admin)):
    db = get_db(request)
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(404, "User not found")
    sanitized = auth_mod._sanitize(target)
    sanitized["impersonated_by"] = actor.get("id")
    sanitized["impersonated_by_email"] = actor.get("email")
    tokens = auth_mod.issue_tokens(sanitized)
    ua = (request.headers.get("user-agent") or "")[:300]
    ip = _client_ip(request)
    await sec.create_session(db, user_id=target["id"], refresh_jti=tokens["refresh_jti"], ip=ip, user_agent=ua)
    await audit(db, actor=actor, action="user.impersonated", target=user_id,
                  new={"reason": body.reason, "duration_min": body.duration_minutes, "target_email": target.get("email")},
                  ip=ip, user_agent=ua)
    return {
        "ok": True,
        "user": {k: target.get(k) for k in ("id", "email", "name", "plan", "role", "status")},
        "access_token": tokens["access_token"],
        "refresh_token": tokens["refresh_token"],
        "token_type": "bearer",
        "impersonated_by": actor.get("email"),
    }


# ---- Login alerts (last N login events with new_country/new_device flags) ----
@router.get("/security/login-alerts")
async def login_alerts(request: Request, days: int = 7, user: Dict[str, Any] = Depends(require_admin)):
    db = get_db(request)
    since = (datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 90)))).isoformat()
    rows = await db.audit_events.find(
        {"event": {"$in": ["login.email_otp", "login.google", "admin.login"]},
          "created_at": {"$gte": since}},
        {"_id": 0}
    ).sort("created_at", -1).limit(200).to_list(200)
    # tag each row with flags
    out = []
    seen_pairs: set = set()
    seen_countries: set = set()
    for r in rows:
        uid = r.get("user_id")
        dev = (r.get("meta") or {}).get("device_label") or r.get("device_label") or "?"
        country = (r.get("meta") or {}).get("country") or "?"
        pair = (uid, dev)
        new_device = pair not in seen_pairs
        new_country = (uid, country) not in seen_countries and country != "?"
        seen_pairs.add(pair)
        seen_countries.add((uid, country))
        out.append({**r, "new_device": new_device, "new_country": new_country})
    return {"items": out}


# ==================== PUBLIC FEATURE FLAGS (consumed by end-user clients) ====================

# This sub-router is exposed at /api/features/* (no admin auth required).
public_router = APIRouter()


def _hash_bucket(s: str) -> int:
    """Stable 0-99 bucket for percentage rollouts."""
    import hashlib
    return int(hashlib.md5((s or "").encode()).hexdigest(), 16) % 100


@public_router.get("/public")
async def features_for_current_user(request: Request):
    """Returns {feature_key: enabled_bool} for the calling user.
    Anonymous callers get the public defaults. Authenticated callers get
    per-user evaluation that honors percentage rollout, audience, and status.
    """
    db = get_db(request)
    user: Optional[Dict[str, Any]] = None
    try:
        user = await auth_mod.current_user(request, db)
    except Exception:
        user = None
    rows = await db.admin_feature_flags.find({}, {"_id": 0}).to_list(200)
    result: Dict[str, Any] = {}
    uid = (user or {}).get("id") or request.client.host if request.client else "anon"
    plan = (user or {}).get("plan") or "free"
    role = (user or {}).get("role") or "user"
    for f in rows:
        key = f["key"]
        status = f.get("status", "enabled")
        pct = int(f.get("rollout_pct", 100) or 0)
        audience = f.get("audience") or []
        enabled = False
        if status == "enabled":
            enabled = True
        elif status == "disabled":
            enabled = False
        elif status == "internal":
            enabled = role in ("admin", "super_admin")
        elif status == "beta":
            enabled = role in ("admin", "super_admin", "beta") or "beta" in audience or plan in audience
        elif status == "rollout":
            in_audience = (plan in audience) or (uid in audience) or role in ("admin", "super_admin")
            enabled = in_audience or (_hash_bucket(f"{key}:{uid}") < pct)
        # Audience override always wins (if specific uid included)
        if uid and uid in audience:
            enabled = True
        result[key] = enabled
    return {"features": result, "evaluated_for": (user or {}).get("id"), "plan": plan}
