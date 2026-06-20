"""
Unified Cost Intelligence Platform — backend.

Single financial control center that tracks every API call, infrastructure component,
and per-user spend across the platform.

Provider-agnostic cost event store (`cost_events`) + reads from the legacy
`admin_ai_usage` collection so historical AI usage is included without migration.

Mount under '/api/admin' — protected by the same require_admin / require_super_admin
dependencies as admin_routes.
"""
from __future__ import annotations

import logging
import os
import re
import statistics
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from pydantic import BaseModel, Field

import admin_routes as admin_mod

logger = logging.getLogger(__name__)
router = APIRouter()


# =====================================================================
# Pricing catalogue
# Conservative public list prices in USD. Editable via env / admin UI later.
# Unit conventions:
#   ai providers:        per 1k input / output tokens
#   voice providers:     per 1000 characters OR per minute
#   google apis:         per 1000 requests (or per request for paid endpoints)
#   communications:      per message / per email / per minute
#   storage:             per GB per month
#   payment processors:  pct + flat per transaction
# =====================================================================
PRICING: Dict[str, Dict[str, Any]] = {
    # AI - per 1k tokens (input, output)
    "bedrock:amazon.nova-micro-v1:0":   {"unit": "tokens",     "in_per_1k": 0.000035, "out_per_1k": 0.00014},
    "bedrock:amazon.nova-lite-v1:0":    {"unit": "tokens",     "in_per_1k": 0.00006,  "out_per_1k": 0.00024},
    "bedrock:amazon.nova-pro-v1:0":     {"unit": "tokens",     "in_per_1k": 0.0008,   "out_per_1k": 0.0032},
    "bedrock:anthropic.claude-3-5-sonnet-20241022-v2:0": {"unit": "tokens", "in_per_1k": 0.003, "out_per_1k": 0.015},
    "openai:gpt-5.2":                   {"unit": "tokens",     "in_per_1k": 0.0025,   "out_per_1k": 0.01},
    "openai:gpt-5.4":                   {"unit": "tokens",     "in_per_1k": 0.003,    "out_per_1k": 0.012},
    "openai:gpt-5.4-mini":              {"unit": "tokens",     "in_per_1k": 0.00015,  "out_per_1k": 0.0006},
    "openai:gpt-4o":                    {"unit": "tokens",     "in_per_1k": 0.0025,   "out_per_1k": 0.01},
    "openai:gpt-4o-mini":               {"unit": "tokens",     "in_per_1k": 0.00015,  "out_per_1k": 0.0006},
    "openai:whisper-1":                 {"unit": "minutes",    "per_min": 0.006},
    "anthropic:claude-sonnet-4-6":      {"unit": "tokens",     "in_per_1k": 0.003,    "out_per_1k": 0.015},
    "anthropic:claude-sonnet-4-5":      {"unit": "tokens",     "in_per_1k": 0.003,    "out_per_1k": 0.015},
    "anthropic:claude-haiku-4-5":       {"unit": "tokens",     "in_per_1k": 0.0008,   "out_per_1k": 0.004},
    "gemini:gemini-3.1-pro":            {"unit": "tokens",     "in_per_1k": 0.00125,  "out_per_1k": 0.005},
    "gemini:gemini-3-flash":            {"unit": "tokens",     "in_per_1k": 0.000075, "out_per_1k": 0.0003},
    "gemini:gemini-3.5-flash":          {"unit": "tokens",     "in_per_1k": 0.000075, "out_per_1k": 0.0003},
    "azure:gpt-4o":                     {"unit": "tokens",     "in_per_1k": 0.0025,   "out_per_1k": 0.01},
    "groq:llama-3.3-70b":               {"unit": "tokens",     "in_per_1k": 0.00059,  "out_per_1k": 0.00079},
    "deepseek:deepseek-chat":           {"unit": "tokens",     "in_per_1k": 0.00014,  "out_per_1k": 0.00028},
    "ollama:default":                   {"unit": "tokens",     "in_per_1k": 0.0,      "out_per_1k": 0.0},

    # Voice - per 1k characters (TTS) or per minute (STT)
    "elevenlabs:eleven_multilingual_v2":  {"unit": "characters", "per_1k": 0.30},  # ~$0.30 per 1k chars on Pro tier
    "elevenlabs:eleven_turbo_v2_5":       {"unit": "characters", "per_1k": 0.15},
    "openai:tts-1":                       {"unit": "characters", "per_1k": 0.015},
    "openai:tts-1-hd":                    {"unit": "characters", "per_1k": 0.030},
    "google_speech:tts-wavenet":          {"unit": "characters", "per_1k": 0.016},
    "google_speech:stt-standard":         {"unit": "minutes",    "per_min": 0.024},
    "aws_polly:standard":                 {"unit": "characters", "per_1k": 0.004},
    "aws_polly:neural":                   {"unit": "characters", "per_1k": 0.016},
    "deepgram:nova-2":                    {"unit": "minutes",    "per_min": 0.0043},

    # Google services - per 1000 requests
    "google_maps:maps":                {"unit": "requests", "per_1k": 7.00},
    "google_maps:places":              {"unit": "requests", "per_1k": 17.00},
    "google_maps:geocoding":           {"unit": "requests", "per_1k": 5.00},
    "google_maps:directions":          {"unit": "requests", "per_1k": 5.00},
    "google_workspace:gmail":          {"unit": "requests", "per_1k": 0.00},  # quota-based, no per-call cost
    "google_workspace:calendar":       {"unit": "requests", "per_1k": 0.00},
    "google_workspace:drive":          {"unit": "requests", "per_1k": 0.00},
    "google_workspace:youtube":        {"unit": "requests", "per_1k": 0.00},
    "google_workspace:custom_search":  {"unit": "requests", "per_1k": 5.00},
    "google_workspace:vision":         {"unit": "requests", "per_1k": 1.50},
    "google_workspace:speech":         {"unit": "minutes",  "per_min": 0.024},

    # Communications
    "twilio:sms":                     {"unit": "messages", "per_msg": 0.0079},
    "twilio:voice_min":               {"unit": "minutes",  "per_min": 0.013},
    "sendgrid:email":                 {"unit": "messages", "per_msg": 0.00098},
    "resend:email":                   {"unit": "messages", "per_msg": 0.001},
    "mailgun:email":                  {"unit": "messages", "per_msg": 0.0008},
    "firebase_messaging:push":        {"unit": "messages", "per_msg": 0.0},
    "onesignal:push":                 {"unit": "messages", "per_msg": 0.0},

    # Storage - per GB-month
    "s3:standard":                    {"unit": "gb_month", "per_gb": 0.023},
    "cloudflare_r2:standard":         {"unit": "gb_month", "per_gb": 0.015},
    "gcs:standard":                   {"unit": "gb_month", "per_gb": 0.020},

    # Infrastructure
    "ec2:t3.medium":                  {"unit": "hours",    "per_hour": 0.0416},
    "lambda:invocation":              {"unit": "requests", "per_1k": 0.20},
    "rds:db.t3.medium":               {"unit": "hours",    "per_hour": 0.068},
    "aurora:serverless":              {"unit": "acu_hour", "per_unit": 0.06},
    "dynamodb:on_demand":             {"unit": "requests", "per_1k": 0.25},
    "redis:cache.t3.micro":           {"unit": "hours",    "per_hour": 0.017},
    "cloudfront:bandwidth":           {"unit": "gb",       "per_gb": 0.085},
    "vercel:invocation":              {"unit": "requests", "per_1k": 0.40},
    "railway:execution":              {"unit": "hours",    "per_hour": 0.0008},
    "render:standard":                {"unit": "hours",    "per_hour": 0.010},

    # Payments — percentage + flat
    "stripe:charge":                  {"unit": "txn", "pct": 0.029,  "flat": 0.30},
    "razorpay:charge":                {"unit": "txn", "pct": 0.020,  "flat": 0.0},
    "apple_iap:charge":               {"unit": "txn", "pct": 0.300,  "flat": 0.0},
    "google_play:charge":             {"unit": "txn", "pct": 0.300,  "flat": 0.0},
}

# Provider category mapping used in dashboards
CATEGORY = {
    "bedrock": "ai", "openai": "ai", "anthropic": "ai", "gemini": "ai", "azure": "ai",
    "groq": "ai", "deepseek": "ai", "ollama": "ai",
    "elevenlabs": "voice", "google_speech": "voice", "aws_polly": "voice", "deepgram": "voice",
    "google_maps": "google", "google_workspace": "google",
    "twilio": "communication", "sendgrid": "communication", "resend": "communication",
    "mailgun": "communication", "firebase_messaging": "communication", "onesignal": "communication",
    "s3": "storage", "cloudflare_r2": "storage", "gcs": "storage",
    "ec2": "infrastructure", "lambda": "infrastructure", "rds": "infrastructure",
    "aurora": "infrastructure", "dynamodb": "infrastructure", "redis": "infrastructure",
    "cloudfront": "infrastructure", "vercel": "infrastructure", "railway": "infrastructure",
    "render": "infrastructure",
    "stripe": "payments", "razorpay": "payments", "apple_iap": "payments", "google_play": "payments",
}

ALL_PROVIDERS = sorted(set(CATEGORY.keys()))


def _key(provider: str, service: str) -> str:
    return f"{provider}:{service}"


def estimate_cost(*, provider: str, service: str,
                  input_tokens: int = 0, output_tokens: int = 0,
                  characters: int = 0, minutes: float = 0.0,
                  requests: int = 0, messages: int = 0,
                  gb: float = 0.0, gb_month: float = 0.0,
                  hours: float = 0.0, amount: float = 0.0,
                  acu_hour: float = 0.0) -> float:
    """Compute USD cost for one usage event from the pricing table."""
    p = PRICING.get(_key(provider, service))
    if not p:
        # Try fallback by provider prefix
        for k, v in PRICING.items():
            if k.split(":", 1)[0] == provider:
                p = v
                break
    if not p:
        return 0.0
    unit = p.get("unit", "")
    try:
        if unit == "tokens":
            return round(
                (input_tokens * p.get("in_per_1k", 0.0) + output_tokens * p.get("out_per_1k", 0.0)) / 1000.0,
                6,
            )
        if unit == "characters":
            return round(characters * p.get("per_1k", 0.0) / 1000.0, 6)
        if unit == "minutes":
            return round(minutes * p.get("per_min", 0.0), 6)
        if unit == "requests":
            return round(requests * p.get("per_1k", 0.0) / 1000.0, 6)
        if unit == "messages":
            return round(messages * p.get("per_msg", 0.0), 6)
        if unit == "gb_month":
            return round(gb_month * p.get("per_gb", 0.0), 6)
        if unit == "gb":
            return round(gb * p.get("per_gb", 0.0), 6)
        if unit == "hours":
            return round(hours * p.get("per_hour", 0.0), 6)
        if unit == "acu_hour":
            return round(acu_hour * p.get("per_unit", 0.0), 6)
        if unit == "txn":
            return round(amount * p.get("pct", 0.0) + p.get("flat", 0.0), 6)
    except Exception:
        return 0.0
    return 0.0


async def log_cost_event(db, *, provider: str, service: str, feature: str = "other",
                         user_id: Optional[str] = None, plan: Optional[str] = None,
                         region: Optional[str] = None, device: Optional[str] = None,
                         success: bool = True, error: Optional[str] = None,
                         latency_ms: int = 0,
                         input_tokens: int = 0, output_tokens: int = 0,
                         characters: int = 0, minutes: float = 0.0,
                         requests: int = 0, messages: int = 0,
                         gb: float = 0.0, gb_month: float = 0.0,
                         hours: float = 0.0, amount: float = 0.0,
                         acu_hour: float = 0.0,
                         cost_override: Optional[float] = None,
                         api_key_id: Optional[str] = None,
                         extra: Optional[Dict[str, Any]] = None) -> str:
    """Insert a single cost event. Returns the event id."""
    cost = cost_override if cost_override is not None else estimate_cost(
        provider=provider, service=service,
        input_tokens=input_tokens, output_tokens=output_tokens,
        characters=characters, minutes=minutes, requests=requests, messages=messages,
        gb=gb, gb_month=gb_month, hours=hours, amount=amount, acu_hour=acu_hour,
    )
    doc = {
        "id": str(uuid.uuid4()),
        "provider": provider, "service": service, "category": CATEGORY.get(provider, "other"),
        "feature": feature,
        "user_id": user_id, "plan": plan,
        "region": region, "device": device,
        "input_tokens": int(input_tokens), "output_tokens": int(output_tokens),
        "characters": int(characters), "minutes": float(minutes),
        "requests": int(requests), "messages": int(messages),
        "gb": float(gb), "gb_month": float(gb_month),
        "hours": float(hours), "amount": float(amount), "acu_hour": float(acu_hour),
        "cost_usd": float(cost),
        "success": bool(success), "error": (error or "")[:300],
        "latency_ms": int(latency_ms),
        "api_key_id": api_key_id,
        "extra": extra or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await db.cost_events.insert_one(doc)
    except Exception as e:
        logger.warning("cost_event insert failed: %s", e)
    return doc["id"]


# =====================================================================
# Pydantic bodies
# =====================================================================
class CostIngest(BaseModel):
    provider: str
    service: str
    feature: str = "other"
    user_id: Optional[str] = None
    input_tokens: int = 0
    output_tokens: int = 0
    characters: int = 0
    minutes: float = 0.0
    requests: int = 0
    messages: int = 0
    gb: float = 0.0
    gb_month: float = 0.0
    hours: float = 0.0
    amount: float = 0.0
    acu_hour: float = 0.0
    cost_override: Optional[float] = None
    api_key_id: Optional[str] = None
    success: bool = True
    error: Optional[str] = None
    latency_ms: int = 0
    region: Optional[str] = None


class BudgetBody(BaseModel):
    scope: Literal["global", "provider", "feature", "user", "plan", "category"] = "global"
    key: str = ""  # provider name / feature name / user id / plan / category. Empty for global.
    monthly_usd: float = 500.0
    alert_pct: List[int] = [50, 75, 90, 100]
    email_to: str = ""
    enabled: bool = True


class APIKeyBody(BaseModel):
    name: str  # human label
    provider: str
    api_key: str = ""
    secret_key: str = ""
    project: str = ""
    endpoint: str = ""
    region: str = ""
    enabled: bool = True
    quota_monthly_usd: Optional[float] = None
    expires_at: Optional[str] = None  # ISO date


class APIKeyPatch(BaseModel):
    name: Optional[str] = None
    api_key: Optional[str] = None
    secret_key: Optional[str] = None
    project: Optional[str] = None
    endpoint: Optional[str] = None
    region: Optional[str] = None
    enabled: Optional[bool] = None
    quota_monthly_usd: Optional[float] = None
    expires_at: Optional[str] = None


# =====================================================================
# Aggregation helpers — pull from BOTH cost_events and admin_ai_usage
# =====================================================================
async def _gather_events(db, since_iso: str) -> List[Dict[str, Any]]:
    """Return a unified normalised view of cost events from cost_events + admin_ai_usage."""
    rows: List[Dict[str, Any]] = []
    async for r in db.cost_events.find({"created_at": {"$gte": since_iso}}, {"_id": 0}):
        rows.append(r)
    # Bring in legacy AI usage rows
    async for r in db.admin_ai_usage.find({"created_at": {"$gte": since_iso}}, {"_id": 0}):
        rows.append({
            "id": r.get("id"),
            "provider": r.get("provider") or "bedrock",
            "service": r.get("model_id") or "unknown",
            "category": "ai",
            "feature": r.get("feature") or "chat",
            "user_id": r.get("user_id"),
            "input_tokens": int(r.get("input_tokens") or 0),
            "output_tokens": int(r.get("output_tokens") or 0),
            "characters": 0, "minutes": 0, "requests": 1, "messages": 0,
            "gb": 0, "gb_month": 0, "hours": 0, "amount": 0, "acu_hour": 0,
            "cost_usd": float(r.get("cost_usd") or 0.0),
            "success": bool(r.get("success", True)),
            "latency_ms": int(r.get("latency_ms") or 0),
            "created_at": r.get("created_at"),
        })
    return rows


def _group(rows: List[Dict[str, Any]], by: str) -> Dict[str, Dict[str, float]]:
    out: Dict[str, Dict[str, float]] = {}
    for r in rows:
        k = str(r.get(by) or "unknown")
        b = out.setdefault(k, {"requests": 0, "cost_usd": 0.0, "tokens": 0,
                              "characters": 0, "minutes": 0.0, "errors": 0,
                              "users": set()})
        b["requests"] += 1
        b["cost_usd"] += float(r.get("cost_usd") or 0.0)
        b["tokens"] += int(r.get("input_tokens") or 0) + int(r.get("output_tokens") or 0)
        b["characters"] += int(r.get("characters") or 0)
        b["minutes"] += float(r.get("minutes") or 0.0)
        if not r.get("success", True):
            b["errors"] += 1
        if r.get("user_id"):
            b["users"].add(r["user_id"])
    # finalize
    for k, v in out.items():
        v["users"] = len(v["users"])
        v["cost_usd"] = round(v["cost_usd"], 4)
        v["minutes"] = round(v["minutes"], 2)
    return out


# =====================================================================
# Endpoints
# =====================================================================
@router.get("/intel/overview")
async def overview(request: Request, days: int = 30,
                   user: Dict[str, Any] = Depends(admin_mod.require_admin)):
    db = admin_mod.get_db(request)
    days = max(1, min(days, 365))
    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=days)).isoformat()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()

    rows = await _gather_events(db, since)
    month_rows = [r for r in rows if (r.get("created_at") or "") >= month_start]

    total_cost = round(sum(float(r.get("cost_usd") or 0.0) for r in rows), 4)
    month_cost = round(sum(float(r.get("cost_usd") or 0.0) for r in month_rows), 4)
    by_category: Dict[str, float] = {}
    for r in rows:
        by_category[r.get("category") or "other"] = by_category.get(r.get("category") or "other", 0.0) + float(r.get("cost_usd") or 0.0)
    by_category = {k: round(v, 4) for k, v in by_category.items()}

    # Revenue from plans × user counts
    plans = await db.admin_subscriptions.find({}, {"_id": 0}).to_list(50)
    plan_price = {p["key"]: float(p.get("price_usd_monthly", 0.0)) for p in plans}
    plan_dist: Dict[str, int] = {}
    async for u in db.users.find({}, {"plan": 1}):
        plan_dist[u.get("plan") or "free"] = plan_dist.get(u.get("plan") or "free", 0) + 1
    mrr = round(sum(plan_dist.get(k, 0) * v for k, v in plan_price.items()), 2)
    arr = round(mrr * 12, 2)
    revenue_window = round(mrr * (days / 30.0), 2)

    profit = round(revenue_window - total_cost, 4)
    margin_pct = round(100.0 * profit / revenue_window, 2) if revenue_window > 0 else 0.0
    burn_rate_daily = round(total_cost / days, 4) if days else 0.0

    # Runway = (cash balance assumed = 12*MRR baseline) / burn  — purely indicative
    assumed_cash = mrr * 12.0
    runway_days = round(assumed_cash / max(burn_rate_daily, 0.01)) if burn_rate_daily > 0 else None

    # Top cost drivers
    by_prov = _group(rows, "provider")
    by_feat = _group(rows, "feature")
    top_drivers = sorted([{"provider": k, **v} for k, v in by_prov.items()], key=lambda x: x["cost_usd"], reverse=True)[:8]

    # Time series (cost per day)
    series = []
    for i in range(days - 1, -1, -1):
        day = (now - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        day_iso = day.isoformat()
        nxt = (day + timedelta(days=1)).isoformat()
        c = sum(float(r.get("cost_usd") or 0.0) for r in rows
                if day_iso <= (r.get("created_at") or "") < nxt)
        series.append({"date": day.date().isoformat(),
                       "cost": round(c, 4),
                       "revenue": round(mrr / 30.0, 2),
                       "profit": round(mrr / 30.0 - c, 4)})

    return {
        "window_days": days,
        "revenue": {"mrr": mrr, "arr": arr, "window": revenue_window},
        "costs": {
            "window": total_cost, "month": month_cost,
            "by_category": by_category, "burn_rate_daily": burn_rate_daily,
        },
        "profit": {"value": profit, "margin_pct": margin_pct},
        "runway_days": runway_days,
        "plan_distribution": plan_dist,
        "top_cost_drivers": top_drivers,
        "feature_breakdown": [{"feature": k, **v} for k, v in by_feat.items()],
        "series": series,
    }


@router.get("/intel/providers")
async def providers(request: Request, days: int = 30,
                    user: Dict[str, Any] = Depends(admin_mod.require_admin)):
    db = admin_mod.get_db(request)
    days = max(1, min(days, 365))
    now = datetime.now(timezone.utc)
    since = (now - timedelta(days=days)).isoformat()
    rows = await _gather_events(db, since)
    by_prov = _group(rows, "provider")
    by_cat: Dict[str, Dict[str, Any]] = {}
    for k, v in by_prov.items():
        cat = CATEGORY.get(k, "other")
        slot = by_cat.setdefault(cat, {"category": cat, "providers": [], "cost_usd": 0.0, "requests": 0})
        slot["providers"].append({"provider": k, **v})
        slot["cost_usd"] += v["cost_usd"]
        slot["requests"] += v["requests"]
    for v in by_cat.values():
        v["cost_usd"] = round(v["cost_usd"], 4)
        v["providers"].sort(key=lambda p: p["cost_usd"], reverse=True)
    # Listed catalog so the UI can show providers with $0 too
    seen = set(by_prov.keys())
    catalog = [{"provider": p, "category": CATEGORY.get(p, "other"), "tracked": p in seen} for p in ALL_PROVIDERS]
    return {"categories": list(by_cat.values()), "catalog": catalog}


@router.get("/intel/features")
async def features(request: Request, days: int = 30,
                   user: Dict[str, Any] = Depends(admin_mod.require_admin)):
    db = admin_mod.get_db(request)
    days = max(1, min(days, 365))
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rows = await _gather_events(db, since)
    by_feat = _group(rows, "feature")

    # Allocate revenue across features proportional to cost (until we have per-feature attribution)
    plans = await db.admin_subscriptions.find({}, {"_id": 0}).to_list(50)
    plan_price = {p["key"]: float(p.get("price_usd_monthly", 0.0)) for p in plans}
    plan_dist: Dict[str, int] = {}
    async for u in db.users.find({}, {"plan": 1}):
        plan_dist[u.get("plan") or "free"] = plan_dist.get(u.get("plan") or "free", 0) + 1
    mrr = sum(plan_dist.get(k, 0) * v for k, v in plan_price.items())
    revenue_window = mrr * (days / 30.0)
    total_cost = sum(v["cost_usd"] for v in by_feat.values()) or 1.0

    items = []
    for k, v in by_feat.values() if False else by_feat.items():
        share = v["cost_usd"] / total_cost if total_cost > 0 else 0
        feat_revenue = round(revenue_window * share, 2)
        profit = round(feat_revenue - v["cost_usd"], 4)
        margin = round(100.0 * profit / feat_revenue, 2) if feat_revenue > 0 else 0.0
        items.append({
            "feature": k,
            "requests": v["requests"],
            "users": v["users"],
            "cost_usd": v["cost_usd"],
            "avg_cost": round(v["cost_usd"] / max(v["requests"], 1), 6),
            "revenue_attributed": feat_revenue,
            "profit": profit,
            "margin_pct": margin,
            "errors": v["errors"],
        })
    items.sort(key=lambda r: r["cost_usd"], reverse=True)
    return {"items": items, "window_days": days}


@router.get("/intel/users/top")
async def users_top(request: Request, days: int = 30, limit: int = 25, sort: str = "cost",
                    user: Dict[str, Any] = Depends(admin_mod.require_admin)):
    db = admin_mod.get_db(request)
    days = max(1, min(days, 365))
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rows = await _gather_events(db, since)
    by_user: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        uid = r.get("user_id")
        if not uid:
            continue
        u = by_user.setdefault(uid, {
            "user_id": uid, "requests": 0, "cost_usd": 0.0, "tokens": 0,
            "characters": 0, "minutes": 0.0, "errors": 0,
            "features": {}, "providers": {},
        })
        u["requests"] += 1
        u["cost_usd"] += float(r.get("cost_usd") or 0.0)
        u["tokens"] += int(r.get("input_tokens") or 0) + int(r.get("output_tokens") or 0)
        u["characters"] += int(r.get("characters") or 0)
        u["minutes"] += float(r.get("minutes") or 0.0)
        u["features"][r.get("feature") or "other"] = u["features"].get(r.get("feature") or "other", 0) + 1
        u["providers"][r.get("provider") or "other"] = u["providers"].get(r.get("provider") or "other", 0) + 1
        if not r.get("success", True):
            u["errors"] += 1

    # Hydrate with user info + plan revenue
    plans = await db.admin_subscriptions.find({}, {"_id": 0}).to_list(50)
    plan_price = {p["key"]: float(p.get("price_usd_monthly", 0.0)) for p in plans}
    user_ids = list(by_user.keys())
    users_map: Dict[str, Dict[str, Any]] = {}
    if user_ids:
        async for u in db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "password_hash": 0}):
            users_map[u["id"]] = u

    rows_out = []
    for uid, u in by_user.items():
        info = users_map.get(uid, {})
        plan = info.get("plan") or "free"
        revenue = round(plan_price.get(plan, 0.0) * (days / 30.0), 4)
        profit = round(revenue - u["cost_usd"], 4)
        margin = round(100.0 * profit / revenue, 2) if revenue > 0 else 0.0
        # risk score: high cost + low plan revenue = risky
        risk = 0
        if revenue == 0 and u["cost_usd"] > 0.50:
            risk = 95
        elif revenue > 0 and (u["cost_usd"] / max(revenue, 0.01)) > 0.7:
            risk = 75
        elif u["errors"] > 20:
            risk = 60
        else:
            risk = max(0, min(50, int(u["cost_usd"] * 20)))
        power = min(100, int(u["requests"] / 5))
        top_features = sorted(u["features"].items(), key=lambda x: x[1], reverse=True)[:3]
        rows_out.append({
            "user_id": uid,
            "email": info.get("email"), "name": info.get("name"), "plan": plan,
            "requests": u["requests"], "cost_usd": round(u["cost_usd"], 4),
            "tokens": u["tokens"], "characters": u["characters"],
            "minutes": round(u["minutes"], 2),
            "revenue_window": revenue, "profit": profit, "margin_pct": margin,
            "risk_score": risk, "power_score": power,
            "top_features": [f for f, _ in top_features],
            "errors": u["errors"],
        })

    if sort == "profit":
        rows_out.sort(key=lambda r: r["profit"], reverse=True)
    elif sort == "risk":
        rows_out.sort(key=lambda r: r["risk_score"], reverse=True)
    else:
        rows_out.sort(key=lambda r: r["cost_usd"], reverse=True)
    return {"items": rows_out[:limit], "total_tracked_users": len(rows_out), "window_days": days}


@router.get("/intel/users/{user_id}")
async def user_detail(user_id: str, request: Request, days: int = 90,
                      user: Dict[str, Any] = Depends(admin_mod.require_admin)):
    db = admin_mod.get_db(request)
    days = max(1, min(days, 365))
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rows = [r for r in await _gather_events(db, since) if r.get("user_id") == user_id]
    target = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(404, "User not found")
    plans = await db.admin_subscriptions.find({}, {"_id": 0}).to_list(50)
    plan_price = {p["key"]: float(p.get("price_usd_monthly", 0.0)) for p in plans}
    plan = target.get("plan") or "free"
    revenue = round(plan_price.get(plan, 0.0) * (days / 30.0), 4)

    total_cost = round(sum(float(r.get("cost_usd") or 0.0) for r in rows), 4)
    tokens = sum(int(r.get("input_tokens") or 0) + int(r.get("output_tokens") or 0) for r in rows)
    chars = sum(int(r.get("characters") or 0) for r in rows)
    minutes = round(sum(float(r.get("minutes") or 0.0) for r in rows), 2)

    by_feat = _group(rows, "feature")
    by_prov = _group(rows, "provider")

    return {
        "user": target,
        "window_days": days,
        "lifetime_revenue": revenue,
        "lifetime_cost": total_cost,
        "profit": round(revenue - total_cost, 4),
        "margin_pct": round(100.0 * (revenue - total_cost) / revenue, 2) if revenue > 0 else 0.0,
        "tokens": tokens, "characters": chars, "voice_minutes": minutes,
        "requests": len(rows),
        "by_feature": [{"feature": k, **v} for k, v in by_feat.items()],
        "by_provider": [{"provider": k, **v} for k, v in by_prov.items()],
    }


# ---------- Provider-specific: Google APIs ----------
@router.get("/intel/google")
async def google_apis(request: Request, days: int = 30,
                      user: Dict[str, Any] = Depends(admin_mod.require_admin)):
    db = admin_mod.get_db(request)
    since = (datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 365)))).isoformat()
    rows = [r for r in await _gather_events(db, since) if (r.get("provider") or "").startswith("google")]
    by_service = _group(rows, "service")
    # alerts vs quota — placeholder: warn if cost > $0 (configurable later)
    items = []
    for svc, v in by_service.items():
        quota_pct = min(100, int(v["cost_usd"] * 10))  # rough proxy
        items.append({
            "service": svc,
            "category": "google",
            "requests": v["requests"], "users": v["users"],
            "cost_usd": v["cost_usd"], "errors": v["errors"],
            "quota_pct": quota_pct,
            "status": "ok" if quota_pct < 75 else ("warn" if quota_pct < 90 else "crit"),
        })
    items.sort(key=lambda x: x["cost_usd"], reverse=True)
    keys = await db.cost_api_keys.find({"provider": {"$regex": "^google"}}, {"_id": 0}).to_list(50)
    return {"items": items, "keys": [_mask_key(k) for k in keys], "window_days": days}


# ---------- Provider-specific: ElevenLabs ----------
@router.get("/intel/elevenlabs")
async def elevenlabs_intel(request: Request, days: int = 30,
                           user: Dict[str, Any] = Depends(admin_mod.require_admin)):
    db = admin_mod.get_db(request)
    since = (datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 365)))).isoformat()
    rows = [r for r in await _gather_events(db, since) if r.get("provider") == "elevenlabs"]
    total_chars = sum(int(r.get("characters") or 0) for r in rows)
    total_cost = round(sum(float(r.get("cost_usd") or 0.0) for r in rows), 4)
    by_voice = _group(rows, "service")
    by_user = _group(rows, "user_id")
    by_day = {}
    for r in rows:
        d = (r.get("created_at") or "")[:10]
        by_day[d] = by_day.get(d, 0.0) + float(r.get("cost_usd") or 0.0)
    daily_series = sorted([{"date": d, "cost": round(c, 4)} for d, c in by_day.items()], key=lambda x: x["date"])

    daily_avg = total_cost / max(len(daily_series), 1)
    projected_month = round(daily_avg * 30, 4)
    budget_doc = await db.cost_budgets.find_one({"scope": "provider", "key": "elevenlabs"}, {"_id": 0})
    budget_amt = (budget_doc or {}).get("monthly_usd", 0)
    remaining = max(0.0, budget_amt - total_cost) if budget_amt else None
    minutes_est = round(total_chars / 1000, 2)  # ~ 1k chars ≈ 1 min spoken

    return {
        "window_days": days,
        "characters": total_chars,
        "minutes_estimated": minutes_est,
        "cost_total": total_cost,
        "by_voice": [{"voice": k, **v} for k, v in by_voice.items()],
        "by_user": [{"user_id": k, **v} for k, v in by_user.items()][:25],
        "series": daily_series,
        "projected_monthly_cost": projected_month,
        "budget_amount": budget_amt,
        "budget_remaining": remaining,
    }


# =====================================================================
# Budgets — multi-scope
# =====================================================================
@router.get("/intel/budgets")
async def list_budgets(request: Request, user: Dict[str, Any] = Depends(admin_mod.require_admin)):
    db = admin_mod.get_db(request)
    rows = await db.cost_budgets.find({}, {"_id": 0}).to_list(200)
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    rows_with_spend = []
    for b in rows:
        match_filter = {"created_at": {"$gte": month_start}}
        if b["scope"] == "provider":
            match_filter["provider"] = b["key"]
        elif b["scope"] == "feature":
            match_filter["feature"] = b["key"]
        elif b["scope"] == "user":
            match_filter["user_id"] = b["key"]
        elif b["scope"] == "category":
            match_filter["category"] = b["key"]
        # else global → no extra filter
        cur = db.cost_events.aggregate([{"$match": match_filter},
                                        {"$group": {"_id": None, "spent": {"$sum": "$cost_usd"}}}])
        spent_doc = await cur.to_list(1)
        spent = round(float(spent_doc[0]["spent"]) if spent_doc else 0.0, 4)
        # Legacy admin_ai_usage for global / ai-related scopes
        if b["scope"] in ("global", "category") and b.get("key") in ("", "ai"):
            cur2 = db.admin_ai_usage.aggregate([{"$match": {"created_at": {"$gte": month_start}}},
                                                {"$group": {"_id": None, "spent": {"$sum": "$cost_usd"}}}])
            r2 = await cur2.to_list(1)
            spent += round(float(r2[0]["spent"]) if r2 else 0.0, 4)
        pct = round(100.0 * spent / max(0.0001, b["monthly_usd"]), 2)
        rows_with_spend.append({**b, "spent_usd": spent, "spent_pct": pct,
                                "status": "exceeded" if pct >= 100 else ("alert" if pct >= 90 else ("warn" if pct >= 75 else "ok"))})
    return {"items": rows_with_spend}


@router.put("/intel/budgets")
async def upsert_budget(body: BudgetBody, request: Request,
                        actor: Dict[str, Any] = Depends(admin_mod.require_admin)):
    db = admin_mod.get_db(request)
    doc = body.model_dump()
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    doc["alert_pct"] = sorted(set([int(p) for p in (body.alert_pct or []) if 1 <= int(p) <= 100])) or [50, 75, 90, 100]
    doc["created_at"] = doc.get("created_at") or doc["updated_at"]
    await db.cost_budgets.update_one(
        {"scope": body.scope, "key": body.key},
        {"$set": doc, "$setOnInsert": {"id": str(uuid.uuid4())}},
        upsert=True,
    )
    await admin_mod.audit(db, actor=actor, action="budget.upserted",
                          target=f"{body.scope}:{body.key}", new=doc,
                          ip=admin_mod._client_ip(request))
    return {"ok": True, "item": doc}


@router.delete("/intel/budgets/{scope}/{key}")
async def delete_budget(scope: str, key: str, request: Request,
                        actor: Dict[str, Any] = Depends(admin_mod.require_admin)):
    db = admin_mod.get_db(request)
    r = await db.cost_budgets.delete_one({"scope": scope, "key": key})
    await admin_mod.audit(db, actor=actor, action="budget.deleted",
                          target=f"{scope}:{key}", ip=admin_mod._client_ip(request))
    return {"ok": r.deleted_count > 0}


# =====================================================================
# API Key Vault (encrypted)
# =====================================================================
def _mask_key(doc: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(doc)
    out.pop("api_key_enc", None)
    out.pop("secret_key_enc", None)
    out["api_key_masked"] = admin_mod.mask(admin_mod.dec(doc.get("api_key_enc", "")))
    if doc.get("secret_key_enc"):
        out["secret_key_masked"] = admin_mod.mask(admin_mod.dec(doc.get("secret_key_enc", "")))
    return out


@router.get("/intel/keys")
async def list_keys(request: Request, user: Dict[str, Any] = Depends(admin_mod.require_admin)):
    db = admin_mod.get_db(request)
    rows = await db.cost_api_keys.find({}, {"_id": 0}).to_list(200)
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    items = []
    for k in rows:
        cur = db.cost_events.aggregate([
            {"$match": {"api_key_id": k["id"], "created_at": {"$gte": month_start}}},
            {"$group": {"_id": None, "cost": {"$sum": "$cost_usd"}, "requests": {"$sum": 1}}},
        ])
        sp = await cur.to_list(1)
        spent_month = round(float(sp[0]["cost"]) if sp else 0.0, 4)
        requests_month = int(sp[0]["requests"]) if sp else 0
        last_used = await db.cost_events.find_one({"api_key_id": k["id"]}, sort=[("created_at", -1)], projection={"created_at": 1})
        quota = k.get("quota_monthly_usd") or 0
        quota_pct = round(100.0 * spent_month / quota, 2) if quota else None
        health = "healthy"
        if not k.get("enabled"):
            health = "disabled"
        elif quota_pct is not None and quota_pct >= 90:
            health = "critical"
        elif quota_pct is not None and quota_pct >= 75:
            health = "warning"
        items.append({
            **_mask_key(k),
            "spent_month": spent_month,
            "requests_month": requests_month,
            "last_used": (last_used or {}).get("created_at"),
            "quota_pct": quota_pct,
            "health": health,
        })
    return {"items": items, "providers": ALL_PROVIDERS}


@router.post("/intel/keys")
async def create_key(body: APIKeyBody, request: Request,
                     actor: Dict[str, Any] = Depends(admin_mod.require_super_admin)):
    db = admin_mod.get_db(request)
    doc = {
        "id": str(uuid.uuid4()),
        "name": body.name,
        "provider": body.provider,
        "project": body.project,
        "endpoint": body.endpoint,
        "region": body.region,
        "enabled": body.enabled,
        "quota_monthly_usd": body.quota_monthly_usd,
        "expires_at": body.expires_at,
        "api_key_enc": admin_mod.enc(body.api_key) if body.api_key else "",
        "secret_key_enc": admin_mod.enc(body.secret_key) if body.secret_key else "",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "created_by": actor.get("email"),
        "rotated_at": None,
    }
    await db.cost_api_keys.insert_one(doc)
    await admin_mod.audit(db, actor=actor, action="key.created",
                          target=f"{body.provider}:{body.name}",
                          ip=admin_mod._client_ip(request))
    return {"ok": True, "item": _mask_key(doc)}


@router.patch("/intel/keys/{key_id}")
async def update_key(key_id: str, body: APIKeyPatch, request: Request,
                     actor: Dict[str, Any] = Depends(admin_mod.require_super_admin)):
    db = admin_mod.get_db(request)
    existing = await db.cost_api_keys.find_one({"id": key_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "API key not found")
    patch: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for field in ("name", "project", "endpoint", "region", "enabled",
                  "quota_monthly_usd", "expires_at"):
        v = getattr(body, field)
        if v is not None:
            patch[field] = v
    if body.api_key:
        patch["api_key_enc"] = admin_mod.enc(body.api_key)
        patch["rotated_at"] = patch["updated_at"]
    if body.secret_key:
        patch["secret_key_enc"] = admin_mod.enc(body.secret_key)
    await db.cost_api_keys.update_one({"id": key_id}, {"$set": patch})
    await admin_mod.audit(db, actor=actor, action="key.updated",
                          target=key_id, new=list(patch.keys()),
                          ip=admin_mod._client_ip(request))
    fresh = await db.cost_api_keys.find_one({"id": key_id}, {"_id": 0})
    return {"ok": True, "item": _mask_key(fresh)}


@router.post("/intel/keys/{key_id}/rotate")
async def rotate_key(key_id: str, request: Request, body: Dict[str, Any] = Body(...),
                     actor: Dict[str, Any] = Depends(admin_mod.require_super_admin)):
    db = admin_mod.get_db(request)
    new_key = body.get("api_key")
    if not new_key:
        raise HTTPException(400, "api_key required")
    existing = await db.cost_api_keys.find_one({"id": key_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "API key not found")
    patch = {
        "api_key_enc": admin_mod.enc(new_key),
        "rotated_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.cost_api_keys.update_one({"id": key_id}, {"$set": patch})
    await admin_mod.audit(db, actor=actor, action="key.rotated", target=key_id,
                          ip=admin_mod._client_ip(request))
    return {"ok": True}


@router.delete("/intel/keys/{key_id}")
async def delete_key(key_id: str, request: Request,
                     actor: Dict[str, Any] = Depends(admin_mod.require_super_admin)):
    db = admin_mod.get_db(request)
    r = await db.cost_api_keys.delete_one({"id": key_id})
    await admin_mod.audit(db, actor=actor, action="key.deleted", target=key_id,
                          ip=admin_mod._client_ip(request))
    return {"ok": r.deleted_count > 0}


# =====================================================================
# Alerts — auto-derived from budget thresholds & abnormal usage
# =====================================================================
@router.get("/intel/alerts")
async def alerts(request: Request, days: int = 7,
                 user: Dict[str, Any] = Depends(admin_mod.require_admin)):
    db = admin_mod.get_db(request)
    out: List[Dict[str, Any]] = []
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    day_ago = (now - timedelta(days=1)).isoformat()

    # 1) Budget threshold crossings
    budgets = await db.cost_budgets.find({}, {"_id": 0}).to_list(200)
    for b in budgets:
        match_filter = {"created_at": {"$gte": month_start}}
        if b["scope"] == "provider":
            match_filter["provider"] = b["key"]
        elif b["scope"] == "feature":
            match_filter["feature"] = b["key"]
        elif b["scope"] == "user":
            match_filter["user_id"] = b["key"]
        elif b["scope"] == "category":
            match_filter["category"] = b["key"]
        sp = await db.cost_events.aggregate([{"$match": match_filter}, {"$group": {"_id": None, "v": {"$sum": "$cost_usd"}}}]).to_list(1)
        spent = round(float(sp[0]["v"]) if sp else 0.0, 4)
        pct = round(100.0 * spent / max(0.0001, b["monthly_usd"]), 2)
        thresholds = sorted(b.get("alert_pct") or [50, 75, 90, 100])
        for t in thresholds:
            if pct >= t:
                severity = "critical" if t >= 100 else ("warning" if t >= 90 else "info")
                out.append({
                    "type": "budget_threshold",
                    "severity": severity,
                    "title": f"{b['scope'].title()} budget {b.get('key') or 'global'} at {pct}%",
                    "detail": f"Spent ${spent:.2f} of ${b['monthly_usd']:.2f} budget ({t}% threshold crossed)",
                    "scope": b["scope"], "key": b["key"], "pct": pct,
                    "created_at": now.isoformat(),
                })
                break  # only highest threshold crossed

    # 2) Cost spike alert — today vs 7-day median
    today_iso = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    today_sp = await db.cost_events.aggregate([{"$match": {"created_at": {"$gte": today_iso}}},
                                              {"$group": {"_id": None, "v": {"$sum": "$cost_usd"}}}]).to_list(1)
    today_cost = float(today_sp[0]["v"]) if today_sp else 0.0
    week_sp = []
    for i in range(1, 8):
        d = (now - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        nd = d + timedelta(days=1)
        rr = await db.cost_events.aggregate([{"$match": {"created_at": {"$gte": d.isoformat(), "$lt": nd.isoformat()}}},
                                            {"$group": {"_id": None, "v": {"$sum": "$cost_usd"}}}]).to_list(1)
        week_sp.append(float(rr[0]["v"]) if rr else 0.0)
    median_cost = statistics.median(week_sp) if week_sp else 0.0
    if median_cost > 0.01 and today_cost > 2 * median_cost:
        out.append({
            "type": "cost_spike", "severity": "warning",
            "title": "Daily cost spike detected",
            "detail": f"Today ${today_cost:.2f} is {round(today_cost/median_cost, 1)}× the 7-day median (${median_cost:.2f})",
            "created_at": now.isoformat(),
        })

    # 3) Abnormal user consumption — any user spending > $5 in last 24h
    rows = await _gather_events(db, day_ago)
    by_user: Dict[str, float] = {}
    for r in rows:
        if r.get("user_id"):
            by_user[r["user_id"]] = by_user.get(r["user_id"], 0.0) + float(r.get("cost_usd") or 0.0)
    for uid, c in by_user.items():
        if c > 5.0:
            info = await db.users.find_one({"id": uid}, {"_id": 0, "email": 1, "plan": 1})
            out.append({
                "type": "abnormal_usage", "severity": "warning",
                "title": f"User {(info or {}).get('email', uid[:8])} spent ${c:.2f} in 24h",
                "detail": f"Plan: {(info or {}).get('plan', 'free')}",
                "user_id": uid, "cost_24h": round(c, 4),
                "created_at": now.isoformat(),
            })

    # 4) API Key health (over quota)
    keys = await db.cost_api_keys.find({"enabled": True}, {"_id": 0}).to_list(200)
    for k in keys:
        quota = k.get("quota_monthly_usd") or 0
        if not quota:
            continue
        cur = db.cost_events.aggregate([{"$match": {"api_key_id": k["id"], "created_at": {"$gte": month_start}}},
                                        {"$group": {"_id": None, "v": {"$sum": "$cost_usd"}}}])
        sp = await cur.to_list(1)
        spent = float(sp[0]["v"]) if sp else 0.0
        pct = 100.0 * spent / quota
        if pct >= 75:
            out.append({
                "type": "key_quota", "severity": "critical" if pct >= 90 else "warning",
                "title": f"API key '{k.get('name')}' at {pct:.0f}% of monthly quota",
                "detail": f"Spent ${spent:.2f} of ${quota:.2f} quota",
                "key_id": k["id"], "provider": k.get("provider"),
                "created_at": now.isoformat(),
            })

    out.sort(key=lambda x: {"critical": 0, "warning": 1, "info": 2}.get(x["severity"], 3))
    return {"items": out}


# =====================================================================
# Forecast — simple linear projection
# =====================================================================
@router.get("/intel/forecast")
async def forecast(request: Request, user: Dict[str, Any] = Depends(admin_mod.require_admin)):
    db = admin_mod.get_db(request)
    now = datetime.now(timezone.utc)
    # last 14 days daily series
    rows = await _gather_events(db, (now - timedelta(days=14)).isoformat())
    by_day: Dict[str, float] = {}
    for r in rows:
        d = (r.get("created_at") or "")[:10]
        by_day[d] = by_day.get(d, 0.0) + float(r.get("cost_usd") or 0.0)
    series = [by_day.get((now - timedelta(days=i)).date().isoformat(), 0.0) for i in range(13, -1, -1)]
    avg7 = round(sum(series[-7:]) / 7, 4) if series else 0.0
    avg14 = round(sum(series) / max(len(series), 1), 4)
    # Simple growth = (avg7 - avg(first 7))
    early7 = round(sum(series[:7]) / 7, 4) if len(series) >= 7 else avg14
    growth_rate = (avg7 - early7) / max(early7, 0.0001)

    def project(days_out: int) -> float:
        return round(avg7 * days_out * (1 + max(min(growth_rate, 0.10), -0.10)), 4)

    # Revenue projection
    plans = await db.admin_subscriptions.find({}, {"_id": 0}).to_list(50)
    plan_price = {p["key"]: float(p.get("price_usd_monthly", 0.0)) for p in plans}
    plan_dist: Dict[str, int] = {}
    async for u in db.users.find({}, {"plan": 1}):
        plan_dist[u.get("plan") or "free"] = plan_dist.get(u.get("plan") or "free", 0) + 1
    mrr = round(sum(plan_dist.get(k, 0) * v for k, v in plan_price.items()), 2)

    # Provider growth — last 7 vs prior 7
    by_prov_recent: Dict[str, float] = {}
    by_prov_prior: Dict[str, float] = {}
    cutoff = (now - timedelta(days=7)).isoformat()
    for r in rows:
        c = float(r.get("cost_usd") or 0.0)
        p = r.get("provider") or "?"
        if (r.get("created_at") or "") >= cutoff:
            by_prov_recent[p] = by_prov_recent.get(p, 0.0) + c
        else:
            by_prov_prior[p] = by_prov_prior.get(p, 0.0) + c
    prov_growth = []
    for p in set(list(by_prov_recent.keys()) + list(by_prov_prior.keys())):
        rec = by_prov_recent.get(p, 0.0)
        pr = by_prov_prior.get(p, 0.0)
        growth = (rec - pr) / max(pr, 0.0001) if pr > 0 else (1.0 if rec > 0 else 0.0)
        prov_growth.append({"provider": p, "recent": round(rec, 4), "prior": round(pr, 4),
                            "growth_pct": round(growth * 100, 2)})
    prov_growth.sort(key=lambda x: x["growth_pct"], reverse=True)

    return {
        "daily_avg_7d": avg7,
        "daily_avg_14d": avg14,
        "growth_rate_pct": round(growth_rate * 100, 2),
        "tomorrow": project(1),
        "weekly": project(7),
        "monthly": project(30),
        "yearly": project(365),
        "expected_revenue_monthly": mrr,
        "expected_revenue_yearly": round(mrr * 12, 2),
        "expected_profit_monthly": round(mrr - project(30), 4),
        "expected_margin_pct": round(100.0 * (mrr - project(30)) / mrr, 2) if mrr else 0.0,
        "burn_rate_daily": avg7,
        "runway_days": round((mrr * 12) / max(avg7, 0.01)) if avg7 > 0 else None,
        "provider_growth": prov_growth[:10],
        "series_14d": series,
    }


# =====================================================================
# Public ingest endpoint (admin token) — for cron jobs / other services
# =====================================================================
@router.post("/intel/ingest")
async def ingest(body: CostIngest, request: Request,
                 user: Dict[str, Any] = Depends(admin_mod.require_admin)):
    db = admin_mod.get_db(request)
    eid = await log_cost_event(
        db,
        provider=body.provider, service=body.service, feature=body.feature,
        user_id=body.user_id, region=body.region, success=body.success, error=body.error,
        latency_ms=body.latency_ms,
        input_tokens=body.input_tokens, output_tokens=body.output_tokens,
        characters=body.characters, minutes=body.minutes, requests=body.requests,
        messages=body.messages, gb=body.gb, gb_month=body.gb_month, hours=body.hours,
        amount=body.amount, acu_hour=body.acu_hour, cost_override=body.cost_override,
        api_key_id=body.api_key_id,
    )
    return {"ok": True, "id": eid}


# =====================================================================
# Pricing table read-only endpoint
# =====================================================================
@router.get("/intel/pricing")
async def pricing_get(user: Dict[str, Any] = Depends(admin_mod.require_admin)):
    return {"pricing": PRICING, "categories": CATEGORY, "providers": ALL_PROVIDERS}


# =====================================================================
# Index bootstrap
# =====================================================================
async def ensure_indexes(db) -> None:
    await db.cost_events.create_index("created_at")
    await db.cost_events.create_index("provider")
    await db.cost_events.create_index("feature")
    await db.cost_events.create_index("user_id")
    await db.cost_events.create_index("api_key_id")
    await db.cost_budgets.create_index([("scope", 1), ("key", 1)], unique=True)
    await db.cost_api_keys.create_index("id", unique=True)
    await db.cost_api_keys.create_index("provider")
