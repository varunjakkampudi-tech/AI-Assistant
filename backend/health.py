"""
HEALTH INTELLIGENCE
===================
Logs simple metrics (sleep_hours, water_glasses, workout_minutes, weight_kg,
steps, mood) and detects trends.

Each metric is normalised:
  { id, metric, value (float), unit, note?, logged_at (UTC ISO) }

Goals like "Gym 4 days/week" already live in db.goals — we cross-reference them.
"""
from __future__ import annotations
import uuid
import statistics
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional


SUPPORTED_METRICS = {
    "sleep_hours": "hours",
    "water_glasses": "glasses",
    "workout_minutes": "min",
    "steps": "steps",
    "weight_kg": "kg",
    "mood": "level",
    "calories": "kcal",
}


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def log_metric(db, metric: str, value: float, note: Optional[str] = None,
                     logged_at: Optional[str] = None) -> Dict[str, Any]:
    metric = (metric or "").lower().strip()
    if metric not in SUPPORTED_METRICS:
        raise ValueError(f"Unsupported metric '{metric}'. Use one of: {list(SUPPORTED_METRICS)}")
    doc = {
        "id": str(uuid.uuid4()),
        "metric": metric,
        "value": float(value),
        "unit": SUPPORTED_METRICS[metric],
        "note": (note or "")[:240],
        "logged_at": logged_at or _utcnow_iso(),
    }
    await db.health_logs.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def list_logs(db, metric: Optional[str] = None, days: int = 30) -> List[Dict[str, Any]]:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    q: Dict[str, Any] = {"logged_at": {"$gte": cutoff}}
    if metric:
        q["metric"] = metric
    rows = await db.health_logs.find(q, {"_id": 0}).sort("logged_at", -1).to_list(2000)
    return rows


async def delete_log(db, log_id: str) -> bool:
    res = await db.health_logs.delete_one({"id": log_id})
    return res.deleted_count > 0


async def summarize(db, days: int = 30) -> Dict[str, Any]:
    """Return per-metric trends + cross-metric insights."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    logs = await db.health_logs.find(
        {"logged_at": {"$gte": cutoff}}, {"_id": 0}
    ).sort("logged_at", 1).to_list(5000)

    # Bucket by metric
    by_metric: Dict[str, List[Dict[str, Any]]] = {}
    for l in logs:
        by_metric.setdefault(l["metric"], []).append(l)

    summary: Dict[str, Any] = {}
    for m, items in by_metric.items():
        values = [i["value"] for i in items if isinstance(i.get("value"), (int, float))]
        if not values:
            continue
        # Split into halves to detect a recent trend
        mid = len(values) // 2 or 1
        first_avg = statistics.mean(values[:mid]) if values[:mid] else 0
        second_avg = statistics.mean(values[mid:]) if values[mid:] else 0
        delta_pct = ((second_avg - first_avg) / first_avg * 100) if first_avg else 0
        summary[m] = {
            "count": len(values),
            "latest": values[-1],
            "average": round(statistics.mean(values), 2),
            "min": round(min(values), 2),
            "max": round(max(values), 2),
            "trend_pct": round(delta_pct, 1),
            "unit": SUPPORTED_METRICS.get(m, ""),
            "last_logged_at": items[-1].get("logged_at"),
        }

    insights = _insights(summary, by_metric)
    streaks = _streaks(by_metric)

    return {
        "days": days,
        "summary": summary,
        "insights": insights,
        "streaks": streaks,
        "log_count": len(logs),
    }


def _insights(summary: Dict[str, Any], by_metric: Dict[str, List[Dict[str, Any]]]) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []

    # Sleep < 6 hrs for 3+ consecutive days
    sleep = by_metric.get("sleep_hours") or []
    if sleep:
        recent = sleep[-7:]
        low = sum(1 for s in recent if (s.get("value") or 0) < 6)
        if low >= 3:
            out.append({
                "type": "sleep",
                "priority": "high",
                "icon": "moon",
                "message": f"You slept under 6 hours on {low} of the last {len(recent)} days.",
                "detail": "Aim for 7+ tonight — under-sleep compounds.",
            })

    # Water average low
    water = summary.get("water_glasses")
    if water and water["average"] < 6:
        out.append({
            "type": "water",
            "priority": "medium",
            "icon": "water",
            "message": f"Average water intake: {water['average']} glasses/day.",
            "detail": "Try logging at least 8 glasses tomorrow.",
        })

    # Workouts trending down
    workouts = summary.get("workout_minutes")
    if workouts and workouts["trend_pct"] < -25:
        out.append({
            "type": "workout",
            "priority": "high",
            "icon": "barbell",
            "message": f"Workout minutes are down {abs(workouts['trend_pct'])}% recently.",
            "detail": "A short 20-min session today restarts the streak.",
        })

    # Weight change
    weight = summary.get("weight_kg")
    if weight and abs(weight["max"] - weight["min"]) >= 2:
        out.append({
            "type": "weight",
            "priority": "low",
            "icon": "trending-up",
            "message": f"Weight ranged {weight['min']}-{weight['max']} kg over this period.",
            "detail": "Trend tracking helps you spot patterns.",
        })

    return out


def _streaks(by_metric: Dict[str, List[Dict[str, Any]]]) -> Dict[str, int]:
    """How many consecutive days the user has logged each metric, counting today backwards."""
    today = datetime.now(timezone.utc).date()
    streaks: Dict[str, int] = {}
    for m, items in by_metric.items():
        # Set of dates logged
        days_logged = set()
        for it in items:
            ts = it.get("logged_at") or ""
            try:
                d = datetime.fromisoformat(ts.replace("Z", "+00:00")).date()
                days_logged.add(d)
            except Exception:
                continue
        streak = 0
        cursor = today
        while cursor in days_logged:
            streak += 1
            cursor -= timedelta(days=1)
        streaks[m] = streak
    return streaks
