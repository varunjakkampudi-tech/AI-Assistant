"""
LIFE OS — TIMELINE & TIME MACHINE
=================================
Aggregates a single day (or range) across all collections so the user can ask:

    "What happened on June 10?"
    "What was I doing one year ago today?"
    "How productive was I in March?"

Sources stitched together (all read-only):
  - Chat messages          (db.chat_messages)
  - Memories               (db.memories)
  - Reminders              (db.reminders)
  - Goals                  (db.goals)             (created / completed)
  - Notifications + Tx     (db.notifications)     (transactions, device notifs)
  - Calls (made/received)  (db.calls, db.incoming_calls)
  - Voice notes            (db.voice_notes)       (if present)
  - Knowledge documents    (db.knowledge_documents)
  - Health logs            (db.health_logs)
  - Google Calendar events (live)                 (passed in)
  - Gmail recent           (live)                 (passed in)
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional


def _iso(d: datetime) -> str:
    return d.astimezone(timezone.utc).isoformat()


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None


def _day_bounds(date_str: str, tz_offset_minutes: int = 0) -> tuple[datetime, datetime]:
    """Return [start_of_day, end_of_day) in UTC for the given local-date string YYYY-MM-DD."""
    y, m, d = (int(x) for x in date_str.split("-"))
    # User-local midnight -> UTC
    offset = timedelta(minutes=tz_offset_minutes)
    start_local = datetime(y, m, d, 0, 0, 0, tzinfo=timezone.utc)
    start_utc = start_local - offset
    end_utc = start_utc + timedelta(days=1)
    return start_utc, end_utc


async def build_day_timeline(
    db,
    date_str: str,
    tz_offset_minutes: int = 0,
    google_helper=None,
    google_token: Optional[str] = None,
) -> Dict[str, Any]:
    """Build a chronological timeline for a single date."""
    start, end = _day_bounds(date_str, tz_offset_minutes)
    start_iso, end_iso = _iso(start), _iso(end)

    events: List[Dict[str, Any]] = []

    # --- Chat messages ---
    msgs = await db.chat_messages.find(
        {"created_at": {"$gte": start_iso, "$lt": end_iso}}, {"_id": 0}
    ).sort("created_at", 1).to_list(2000)
    chat_pairs: Dict[str, Dict[str, Any]] = {}
    for m in msgs:
        sid = m.get("session_id", "")
        if sid not in chat_pairs:
            chat_pairs[sid] = {"first": m, "count": 0, "user_words": 0}
        chat_pairs[sid]["count"] += 1
        if m.get("role") == "user":
            chat_pairs[sid]["user_words"] += len((m.get("content") or "").split())

    for sid, info in chat_pairs.items():
        f = info["first"]
        events.append({
            "kind": "chat",
            "icon": "chatbubbles",
            "title": (f.get("content") or "")[:80] or "Chat session",
            "subtitle": f"{info['count']} message{'s' if info['count'] != 1 else ''} · {info['user_words']} words",
            "at": f.get("created_at"),
            "ref_id": sid,
        })

    # --- Memories created today ---
    mems = await db.memories.find(
        {"created_at": {"$gte": start_iso, "$lt": end_iso}}, {"_id": 0}
    ).sort("created_at", 1).to_list(500)
    for m in mems:
        events.append({
            "kind": "memory",
            "icon": "bookmark",
            "title": m.get("subject") or "Memory",
            "subtitle": (m.get("content") or "")[:120],
            "category": m.get("category"),
            "at": m.get("created_at"),
            "ref_id": m.get("id"),
        })

    # --- Reminders created / completed today ---
    rems_created = await db.reminders.find(
        {"created_at": {"$gte": start_iso, "$lt": end_iso}}, {"_id": 0}
    ).to_list(500)
    for r in rems_created:
        events.append({
            "kind": "reminder_created",
            "icon": "alarm",
            "title": (r.get("text") or "Reminder"),
            "subtitle": r.get("condition") or "",
            "at": r.get("created_at"),
            "ref_id": r.get("id"),
        })
    rems_done = await db.reminders.find({
        "status": "done",
        "updated_at": {"$gte": start_iso, "$lt": end_iso}
    }, {"_id": 0}).to_list(500)
    for r in rems_done:
        events.append({
            "kind": "reminder_done",
            "icon": "checkmark-circle",
            "title": f"Completed: {r.get('text', '')[:80]}",
            "subtitle": "Reminder done",
            "at": r.get("updated_at"),
            "ref_id": r.get("id"),
        })

    # --- Goals created / progressed today ---
    goals_created = await db.goals.find(
        {"created_at": {"$gte": start_iso, "$lt": end_iso}}, {"_id": 0}
    ).to_list(500)
    for g in goals_created:
        events.append({
            "kind": "goal_created",
            "icon": "trophy",
            "title": f"Goal: {g.get('title', '')[:80]}",
            "subtitle": g.get("description") or g.get("target") or "",
            "at": g.get("created_at"),
            "ref_id": g.get("id"),
        })
    goals_updated = await db.goals.find({
        "status": {"$in": ["completed", "active"]},
        "updated_at": {"$gte": start_iso, "$lt": end_iso}
    }, {"_id": 0}).to_list(500)
    for g in goals_updated:
        if g.get("created_at") in (g.get("updated_at"), None):
            continue
        events.append({
            "kind": "goal_progress" if g.get("status") == "active" else "goal_completed",
            "icon": "trending-up" if g.get("status") == "active" else "ribbon",
            "title": f"{'Completed' if g.get('status') == 'completed' else 'Progressed'}: {g.get('title', '')[:80]}",
            "subtitle": f"{g.get('progress', 0)}%",
            "at": g.get("updated_at"),
            "ref_id": g.get("id"),
        })

    # --- Transactions & notifications ---
    notifs = await db.notifications.find(
        {"posted_at": {"$gte": start_iso, "$lt": end_iso}}, {"_id": 0}
    ).sort("posted_at", 1).to_list(1000)
    for n in notifs:
        if n.get("kind") == "transaction":
            direction = n.get("direction", "")
            amount = n.get("amount") or 0
            sign = "−" if direction == "debit" else "+"
            events.append({
                "kind": "transaction",
                "icon": "card",
                "title": f"{sign}₹{int(amount):,} {n.get('merchant', '')[:50]}",
                "subtitle": f"{n.get('category', 'other')} · {n.get('source', '')}",
                "at": n.get("posted_at"),
                "ref_id": n.get("id"),
            })
        else:
            events.append({
                "kind": "notification",
                "icon": "notifications",
                "title": (n.get("title") or n.get("app_name") or "Notification")[:80],
                "subtitle": (n.get("text") or "")[:120],
                "at": n.get("posted_at"),
                "ref_id": n.get("id"),
            })

    # --- Calls (outbound + incoming) ---
    for call in await db.calls.find(
        {"created_at": {"$gte": start_iso, "$lt": end_iso}}, {"_id": 0}
    ).to_list(500):
        events.append({
            "kind": "call_out",
            "icon": "call",
            "title": f"Called {call.get('phone_number', '')}",
            "subtitle": call.get("purpose") or "",
            "at": call.get("created_at"),
            "ref_id": call.get("id"),
        })
    for call in await db.incoming_calls.find(
        {"started_at": {"$gte": start_iso, "$lt": end_iso}}, {"_id": 0}
    ).to_list(500):
        events.append({
            "kind": "call_in",
            "icon": "call-outline",
            "title": f"Call from {call.get('contact_name') or call.get('phone_number') or 'Unknown'}",
            "subtitle": call.get("call_type") or call.get("status") or "",
            "at": call.get("started_at"),
            "ref_id": call.get("id"),
        })

    # --- Voice notes ---
    if "voice_notes" in await db.list_collection_names():
        for v in await db.voice_notes.find(
            {"created_at": {"$gte": start_iso, "$lt": end_iso}}, {"_id": 0}
        ).to_list(500):
            events.append({
                "kind": "voice_note",
                "icon": "mic",
                "title": (v.get("transcript") or "Voice note")[:80],
                "subtitle": f"{v.get('duration_sec', 0)}s",
                "at": v.get("created_at"),
                "ref_id": v.get("id"),
            })

    # --- Knowledge documents added ---
    for kd in await db.knowledge_documents.find(
        {"created_at": {"$gte": start_iso, "$lt": end_iso}}, {"_id": 0}
    ).to_list(500):
        events.append({
            "kind": "document",
            "icon": "document-text",
            "title": kd.get("filename") or "Document",
            "subtitle": kd.get("summary") or kd.get("mime_type") or "",
            "at": kd.get("created_at"),
            "ref_id": kd.get("id"),
        })

    # --- Health logs ---
    if "health_logs" in await db.list_collection_names():
        for h in await db.health_logs.find(
            {"logged_at": {"$gte": start_iso, "$lt": end_iso}}, {"_id": 0}
        ).to_list(500):
            events.append({
                "kind": "health",
                "icon": "fitness",
                "title": f"{h.get('metric', '').title()}: {h.get('value')} {h.get('unit', '')}",
                "subtitle": h.get("note") or "",
                "at": h.get("logged_at"),
                "ref_id": h.get("id"),
            })

    # --- Google Calendar events for this day ---
    if google_helper and google_token:
        try:
            cal_events = await google_helper.list_upcoming_events(google_token, max_results=50)
            for ev in cal_events:
                ev_start = ev.get("start") or ""
                d = _parse_iso(ev_start)
                if d and start <= d.astimezone(timezone.utc) < end:
                    events.append({
                        "kind": "calendar",
                        "icon": "calendar",
                        "title": ev.get("summary") or "Event",
                        "subtitle": ev.get("location") or "",
                        "at": ev_start,
                        "ref_id": ev.get("id"),
                    })
        except Exception:
            pass

    # --- Gmail (today only) ---
    if google_helper and google_token:
        try:
            mails = await google_helper.list_recent_messages(google_token, max_results=20)
            for em in mails:
                # crude same-day check using internalDate isn't available here, but we can keep it lightweight
                # we will just include it if user is querying today; for past dates we rely on memories/tx
                events.append({
                    "kind": "email",
                    "icon": "mail",
                    "title": (em.get("subject") or "(no subject)")[:80],
                    "subtitle": em.get("from", "")[:80],
                    "at": em.get("date") or "",
                    "ref_id": em.get("id"),
                    "unread": bool(em.get("unread")),
                }) if date_str == datetime.now(timezone.utc).date().isoformat() else None
        except Exception:
            pass

    # Sort chronologically (events without a parseable time go last)
    def _sort_key(e):
        d = _parse_iso(e.get("at"))
        return (0 if d else 1, d.timestamp() if d else 0)
    events.sort(key=_sort_key)

    # Quick stats
    by_kind: Dict[str, int] = {}
    for e in events:
        by_kind[e["kind"]] = by_kind.get(e["kind"], 0) + 1

    spent = 0.0
    received = 0.0
    for n in notifs:
        if n.get("kind") != "transaction":
            continue
        amt = n.get("amount") or 0
        if n.get("direction") == "debit":
            spent += amt
        elif n.get("direction") == "credit":
            received += amt

    return {
        "date": date_str,
        "events": events,
        "stats": {
            "event_count": len(events),
            "by_kind": by_kind,
            "spent": round(spent, 2),
            "received": round(received, 2),
        },
    }


async def on_this_day(
    db,
    months_back: int = 12,
    tz_offset_minutes: int = 0,
    google_helper=None,
    google_token: Optional[str] = None,
) -> Dict[str, Any]:
    """'Memory time machine': what happened today X months ago?"""
    today = datetime.now(timezone.utc) + timedelta(minutes=tz_offset_minutes)
    year = today.year
    month = today.month - months_back
    while month <= 0:
        month += 12
        year -= 1
    day = today.day
    # Clamp day to month length (e.g., 31 -> 28/30)
    try:
        target = datetime(year, month, day)
    except ValueError:
        # Day doesn't exist (e.g., Feb 30) → use last day of that month
        if month == 12:
            target = datetime(year + 1, 1, 1) - timedelta(days=1)
        else:
            target = datetime(year, month + 1, 1) - timedelta(days=1)
    return await build_day_timeline(
        db, target.strftime("%Y-%m-%d"), tz_offset_minutes, google_helper, google_token
    )


async def range_summary(
    db,
    from_date: str,
    to_date: str,
    tz_offset_minutes: int = 0,
) -> Dict[str, Any]:
    """Aggregate counts/totals across a date range (used for monthly views)."""
    start, _ = _day_bounds(from_date, tz_offset_minutes)
    _, end = _day_bounds(to_date, tz_offset_minutes)
    start_iso, end_iso = _iso(start), _iso(end)

    chat_msgs = await db.chat_messages.count_documents(
        {"created_at": {"$gte": start_iso, "$lt": end_iso}, "role": "user"}
    )
    mems = await db.memories.count_documents(
        {"created_at": {"$gte": start_iso, "$lt": end_iso}}
    )
    rems_done = await db.reminders.count_documents(
        {"status": "done", "updated_at": {"$gte": start_iso, "$lt": end_iso}}
    )
    goals_completed = await db.goals.count_documents(
        {"status": "completed", "updated_at": {"$gte": start_iso, "$lt": end_iso}}
    )
    calls_out = await db.calls.count_documents(
        {"created_at": {"$gte": start_iso, "$lt": end_iso}}
    )
    docs = await db.knowledge_documents.count_documents(
        {"created_at": {"$gte": start_iso, "$lt": end_iso}}
    )

    # Spend totals
    spent = 0.0
    received = 0.0
    async for n in db.notifications.find(
        {"kind": "transaction", "posted_at": {"$gte": start_iso, "$lt": end_iso}},
        {"_id": 0, "amount": 1, "direction": 1},
    ):
        amt = n.get("amount") or 0
        if n.get("direction") == "debit":
            spent += amt
        elif n.get("direction") == "credit":
            received += amt

    return {
        "from": from_date,
        "to": to_date,
        "totals": {
            "user_messages": chat_msgs,
            "memories": mems,
            "reminders_completed": rems_done,
            "goals_completed": goals_completed,
            "calls_made": calls_out,
            "documents_added": docs,
            "spent": round(spent, 2),
            "received": round(received, 2),
        },
    }
