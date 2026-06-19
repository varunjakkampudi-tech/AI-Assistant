"""
AI JOURNAL
==========
Every night Nova reads the day's timeline + chat highlights + transactions and
writes a journal entry in the user's own voice (using the Digital Twin style).

Entry shape:
    {
      "id": str,
      "date": "YYYY-MM-DD",
      "wins": [str],
      "mistakes": [str],
      "mood": str,
      "highlights": [str],
      "narrative": str,        # 3-5 sentence summary in user's style
      "stats": {...},          # from timeline
      "created_at": iso
    }

Stored in `db.journals`.
"""
from __future__ import annotations
import re
import json
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Callable

logger = logging.getLogger(__name__)


def _safe_json_object(text: str) -> dict:
    if not text:
        return {}
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return {}
    try:
        return json.loads(m.group(0))
    except Exception:
        return {}


JOURNAL_PROMPT = (
    "You are the user's nightly journal writer. You receive a structured summary "
    "of everything that happened today (chats, transactions, goals, reminders, calls, "
    "meetings, documents). Produce a JSON object describing the day from the user's "
    "perspective, written in their own voice. Keep it honest, concrete, and concise. "
    "Output ONLY a JSON object with these keys:\n"
    "  wins        : array of 1-4 short strings (concrete positives)\n"
    "  mistakes    : array of 0-3 short strings (things to fix tomorrow); empty array if none\n"
    "  mood        : one of 'great' | 'good' | 'neutral' | 'tired' | 'frustrated' | 'sad' | 'excited'\n"
    "  highlights  : array of 2-5 short bullet phrases summarising key moments\n"
    "  narrative   : single paragraph 3-5 sentences, first-person, in the user's voice/style.\n"
    "Do NOT invent events that aren't in the input."
)


async def generate_journal_for_date(
    db,
    date_str: str,
    timeline: Dict[str, Any],
    style_prompt: str,
    bedrock_call: Callable,
    overwrite: bool = True,
) -> Dict[str, Any]:
    """Generate (or replace) the journal entry for `date_str`."""
    # If a journal already exists and we're not overwriting, return it
    existing = await db.journals.find_one({"date": date_str}, {"_id": 0})
    if existing and not overwrite:
        return existing

    events = timeline.get("events") or []
    if not events:
        # Nothing happened today
        empty = {
            "id": str(uuid.uuid4()),
            "date": date_str,
            "wins": [],
            "mistakes": [],
            "mood": "neutral",
            "highlights": [],
            "narrative": "A quiet day. Nothing notable was recorded.",
            "stats": timeline.get("stats", {}),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.journals.replace_one({"date": date_str}, empty, upsert=True)
        return empty

    # Build compact input
    lines = [f"Date: {date_str}"]
    stats = timeline.get("stats", {})
    if stats.get("spent"):
        lines.append(f"Total spent today: ₹{stats['spent']:.0f}")
    if stats.get("received"):
        lines.append(f"Total received today: ₹{stats['received']:.0f}")
    lines.append("")
    lines.append("Events (chronological):")
    for e in events[:60]:
        ts = (e.get("at") or "")[:16]
        lines.append(f"  - [{ts}] {e.get('kind')}: {e.get('title')} — {e.get('subtitle') or ''}")
    compact = "\n".join(lines)

    system_text = f"{JOURNAL_PROMPT}\n\nUser style: {style_prompt or 'natural, casual.'}"
    try:
        raw = await bedrock_call(
            messages=[{"role": "user", "content": [{"text": compact}]}],
            system_text=system_text,
            max_tokens=900,
            temperature=0.6,
        )
    except Exception as e:
        logger.warning("Journal LLM call failed: %s", e)
        raw = ""

    obj = _safe_json_object(raw)
    entry = {
        "id": str(uuid.uuid4()),
        "date": date_str,
        "wins": [str(x)[:160] for x in (obj.get("wins") or [])][:4],
        "mistakes": [str(x)[:160] for x in (obj.get("mistakes") or [])][:3],
        "mood": (obj.get("mood") or "neutral").lower(),
        "highlights": [str(x)[:160] for x in (obj.get("highlights") or [])][:5],
        "narrative": (obj.get("narrative") or "").strip()[:1500],
        "stats": stats,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.journals.replace_one({"date": date_str}, entry, upsert=True)
    return entry


async def list_journal_entries(db, limit: int = 60) -> List[Dict[str, Any]]:
    rows = await db.journals.find({}, {"_id": 0}).sort("date", -1).to_list(limit)
    return rows


async def get_journal(db, date_str: str) -> Optional[Dict[str, Any]]:
    return await db.journals.find_one({"date": date_str}, {"_id": 0})
