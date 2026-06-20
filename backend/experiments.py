"""
A/B Testing Console — backend.

Collections:
  experiments         — definition of each experiment
  experiment_assigns  — sticky per-user variant assignment (so the same user
                        always sees the same variant for a given experiment)
  experiment_events   — conversion events logged by the user app

Endpoints mounted under:
  /api/admin/experiments/...  → admin-only CRUD + results
  /api/experiments/...        → public (signed-in user) assign + event log
"""
from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

import admin_routes as admin_mod
import auth as auth_mod

logger = logging.getLogger(__name__)

admin_router = APIRouter()
public_router = APIRouter()


# =====================================================================
# Schemas
# =====================================================================
class Variant(BaseModel):
    key: str  # "A" | "B" | "control" | ...
    label: str = ""
    config: Dict[str, Any] = Field(default_factory=dict)  # arbitrary payload (model id, prompt id, copy)
    weight: int = 50  # 0-100, must sum to 100 across variants


class ExperimentBody(BaseModel):
    key: str  # unique identifier used from the app
    label: str = ""
    description: str = ""
    status: Literal["draft", "running", "paused", "completed"] = "draft"
    variants: List[Variant] = Field(default_factory=list)
    primary_metric: str = "conversion"  # event name we count for results
    audience: List[str] = Field(default_factory=list)  # plan names / user ids
    starts_at: Optional[str] = None
    ends_at: Optional[str] = None


class ExperimentPatch(BaseModel):
    label: Optional[str] = None
    description: Optional[str] = None
    status: Optional[Literal["draft", "running", "paused", "completed"]] = None
    variants: Optional[List[Variant]] = None
    primary_metric: Optional[str] = None
    audience: Optional[List[str]] = None
    starts_at: Optional[str] = None
    ends_at: Optional[str] = None


class EventBody(BaseModel):
    key: str          # experiment key
    event: str = "conversion"
    value: float = 0.0
    metadata: Dict[str, Any] = Field(default_factory=dict)


# =====================================================================
# Variant assignment (deterministic, sticky)
# =====================================================================
def _bucket(s: str) -> int:
    return int(hashlib.md5(s.encode()).hexdigest(), 16) % 100


def _pick_variant(exp: Dict[str, Any], uid: str) -> str:
    variants: List[Dict[str, Any]] = exp.get("variants") or []
    if not variants:
        return ""
    total = sum(int(v.get("weight", 0)) for v in variants) or 100
    b = _bucket(f"exp:{exp['key']}:{uid}")
    # normalize bucket onto total
    target = (b * total) // 100
    accum = 0
    for v in variants:
        accum += int(v.get("weight", 0))
        if target < accum:
            return v["key"]
    return variants[-1]["key"]


# =====================================================================
# Admin endpoints
# =====================================================================
@admin_router.get("/experiments")
async def experiments_list(request: Request, user: Dict[str, Any] = Depends(admin_mod.require_admin)):
    db = admin_mod.get_db(request)
    rows = await db.experiments.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return {"items": rows}


@admin_router.post("/experiments")
async def experiment_create(body: ExperimentBody, request: Request,
                            actor: Dict[str, Any] = Depends(admin_mod.require_admin)):
    db = admin_mod.get_db(request)
    if not body.variants:
        body.variants = [Variant(key="A", label="Control", weight=50),
                         Variant(key="B", label="Variant", weight=50)]
    total = sum(v.weight for v in body.variants)
    if total <= 0:
        raise HTTPException(400, "Variant weights must sum to a positive number")
    existing = await db.experiments.find_one({"key": body.key}, {"_id": 0})
    if existing:
        raise HTTPException(409, f"Experiment '{body.key}' already exists")
    doc = body.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["created_at"] = datetime.now(timezone.utc).isoformat()
    doc["updated_at"] = doc["created_at"]
    doc["created_by"] = actor.get("email")
    await db.experiments.insert_one(doc)
    await admin_mod.audit(db, actor=actor, action="experiment.created", target=body.key,
                          new=doc, ip=admin_mod._client_ip(request))
    return {"ok": True, "item": doc}


@admin_router.patch("/experiments/{exp_id}")
async def experiment_update(exp_id: str, body: ExperimentPatch, request: Request,
                            actor: Dict[str, Any] = Depends(admin_mod.require_admin)):
    db = admin_mod.get_db(request)
    existing = await db.experiments.find_one({"id": exp_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Experiment not found")
    patch: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for k, v in body.model_dump(exclude_none=True).items():
        if k == "variants":
            patch[k] = [vv.model_dump() if isinstance(vv, Variant) else vv for vv in v]
        else:
            patch[k] = v
    await db.experiments.update_one({"id": exp_id}, {"$set": patch})
    await admin_mod.audit(db, actor=actor, action="experiment.updated", target=exp_id,
                          new=list(patch.keys()), ip=admin_mod._client_ip(request))
    fresh = await db.experiments.find_one({"id": exp_id}, {"_id": 0})
    return {"ok": True, "item": fresh}


@admin_router.delete("/experiments/{exp_id}")
async def experiment_delete(exp_id: str, request: Request,
                            actor: Dict[str, Any] = Depends(admin_mod.require_admin)):
    db = admin_mod.get_db(request)
    exp = await db.experiments.find_one({"id": exp_id}, {"_id": 0})
    if not exp:
        raise HTTPException(404, "Experiment not found")
    await db.experiments.delete_one({"id": exp_id})
    await db.experiment_assigns.delete_many({"experiment_key": exp["key"]})
    await db.experiment_events.delete_many({"experiment_key": exp["key"]})
    await admin_mod.audit(db, actor=actor, action="experiment.deleted", target=exp_id,
                          ip=admin_mod._client_ip(request))
    return {"ok": True}


@admin_router.get("/experiments/{exp_id}/results")
async def experiment_results(exp_id: str, request: Request,
                             user: Dict[str, Any] = Depends(admin_mod.require_admin)):
    db = admin_mod.get_db(request)
    exp = await db.experiments.find_one({"id": exp_id}, {"_id": 0})
    if not exp:
        raise HTTPException(404, "Experiment not found")

    # Count assignments per variant
    assign_pipe = [
        {"$match": {"experiment_key": exp["key"]}},
        {"$group": {"_id": "$variant", "n": {"$sum": 1}}},
    ]
    by_variant: Dict[str, Dict[str, Any]] = {}
    async for r in db.experiment_assigns.aggregate(assign_pipe):
        by_variant[r["_id"]] = {"variant": r["_id"], "assigned": int(r["n"]),
                                "conversions": 0, "value_sum": 0.0, "users_converted": 0}

    # Count conversions per variant + sum value
    primary = exp.get("primary_metric", "conversion")
    conv_pipe = [
        {"$match": {"experiment_key": exp["key"], "event": primary}},
        {"$group": {"_id": "$variant", "n": {"$sum": 1},
                    "value_sum": {"$sum": "$value"},
                    "users": {"$addToSet": "$user_id"}}},
    ]
    async for r in db.experiment_events.aggregate(conv_pipe):
        slot = by_variant.setdefault(r["_id"] or "?", {"variant": r["_id"] or "?", "assigned": 0,
                                                       "conversions": 0, "value_sum": 0.0, "users_converted": 0})
        slot["conversions"] = int(r["n"])
        slot["value_sum"] = round(float(r["value_sum"] or 0.0), 4)
        slot["users_converted"] = len([u for u in (r.get("users") or []) if u])

    variants = []
    for v in (exp.get("variants") or []):
        stats = by_variant.get(v["key"], {"variant": v["key"], "assigned": 0,
                                          "conversions": 0, "value_sum": 0.0, "users_converted": 0})
        cr = round(100.0 * stats["conversions"] / max(stats["assigned"], 1), 2)
        avg_val = round(stats["value_sum"] / max(stats["conversions"], 1), 4)
        variants.append({
            **v, **stats,
            "conversion_rate_pct": cr,
            "avg_value": avg_val,
        })

    # Pick the leader & compute uplift over the first variant
    leader = max(variants, key=lambda r: r["conversion_rate_pct"]) if variants else None
    baseline = variants[0] if variants else None
    if leader and baseline and leader["variant"] != baseline["variant"]:
        base_rate = max(baseline["conversion_rate_pct"], 0.0001)
        uplift_pct = round((leader["conversion_rate_pct"] - baseline["conversion_rate_pct"]) / base_rate * 100, 2)
    else:
        uplift_pct = 0.0

    # Daily timeseries — conversions per day per variant (last 30 days)
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    daily: Dict[str, Dict[str, int]] = {}
    async for r in db.experiment_events.aggregate([
        {"$match": {"experiment_key": exp["key"], "event": primary, "created_at": {"$gte": since}}},
        {"$project": {"day": {"$substr": ["$created_at", 0, 10]}, "variant": 1}},
        {"$group": {"_id": {"day": "$day", "variant": "$variant"}, "n": {"$sum": 1}}},
    ]):
        day = r["_id"]["day"]; v = r["_id"]["variant"] or "?"
        daily.setdefault(day, {})[v] = int(r["n"])
    daily_series = [{"date": d, **vals} for d, vals in sorted(daily.items())]

    return {
        "experiment": exp,
        "variants": variants,
        "leader": leader,
        "uplift_pct": uplift_pct,
        "daily_series": daily_series,
        "total_assigned": sum(v["assigned"] for v in variants),
        "total_conversions": sum(v["conversions"] for v in variants),
    }


# =====================================================================
# Public endpoints (signed-in users)
# =====================================================================
@public_router.get("/experiments/assign")
async def assign_variant(key: str, request: Request):
    """Returns the (sticky) variant for the calling user for experiment `key`.
    Anonymous callers also get a variant keyed off their IP."""
    db = admin_mod.get_db(request)
    exp = await db.experiments.find_one({"key": key}, {"_id": 0})
    if not exp or exp.get("status") not in ("running",):
        return {"variant": None, "config": {}, "reason": "experiment not running"}
    # Resolve user
    user = None
    try:
        user = await auth_mod.current_user(request, db)
    except Exception:
        user = None
    uid = (user or {}).get("id") or (request.client.host if request.client else "anon")
    # Audience filter
    audience = exp.get("audience") or []
    if audience:
        plan = (user or {}).get("plan") or "free"
        ok = (uid in audience) or (plan in audience) or ((user or {}).get("role") in ("admin", "super_admin"))
        if not ok:
            return {"variant": None, "config": {}, "reason": "out of audience"}
    # Sticky lookup
    existing = await db.experiment_assigns.find_one({"experiment_key": key, "user_id": uid}, {"_id": 0})
    if existing:
        variant = existing["variant"]
    else:
        variant = _pick_variant(exp, uid)
        try:
            await db.experiment_assigns.insert_one({
                "id": str(uuid.uuid4()),
                "experiment_key": key, "user_id": uid, "variant": variant,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            pass
    # Find config for that variant
    cfg = {}
    for v in (exp.get("variants") or []):
        if v["key"] == variant:
            cfg = v.get("config") or {}
            break
    return {"variant": variant, "config": cfg, "experiment_key": key}


@public_router.post("/experiments/event")
async def log_event(body: EventBody, request: Request):
    """Log a conversion (or other) event for the current user against an experiment."""
    db = admin_mod.get_db(request)
    user = None
    try:
        user = await auth_mod.current_user(request, db)
    except Exception:
        user = None
    uid = (user or {}).get("id") or (request.client.host if request.client else "anon")
    # Find the user's variant (must have been assigned already)
    assign = await db.experiment_assigns.find_one({"experiment_key": body.key, "user_id": uid}, {"_id": 0})
    variant = assign["variant"] if assign else None
    await db.experiment_events.insert_one({
        "id": str(uuid.uuid4()),
        "experiment_key": body.key,
        "user_id": uid,
        "variant": variant,
        "event": body.event,
        "value": float(body.value or 0.0),
        "metadata": body.metadata or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True, "variant": variant}


# =====================================================================
# Indexes
# =====================================================================
async def ensure_indexes(db) -> None:
    await db.experiments.create_index("key", unique=True)
    await db.experiments.create_index("status")
    await db.experiment_assigns.create_index([("experiment_key", 1), ("user_id", 1)], unique=True)
    await db.experiment_assigns.create_index("experiment_key")
    await db.experiment_events.create_index("experiment_key")
    await db.experiment_events.create_index([("experiment_key", 1), ("event", 1), ("created_at", 1)])
