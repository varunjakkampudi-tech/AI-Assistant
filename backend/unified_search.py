"""
PERSONAL SEARCH ENGINE
======================
Unified semantic-ish search across the user's data:
- Chat messages (every Nova chat)
- Long-term memories
- Goals + Reminders
- Knowledge Vault documents
- Notifications (incl. parsed transactions)
- Calendar events (cached via Google sync if available)
- Gmail messages (live fetch if Google connected)

After ranking, Bedrock (Nova Lite) synthesizes an answer that cites the sources.
"""

from __future__ import annotations
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _tokenize(s: str) -> List[str]:
    return [t for t in re.split(r"\W+", (s or "").lower()) if len(t) > 2]


def _score(query_tokens: List[str], text: str, recency_iso: Optional[str] = None) -> float:
    """Very lightweight ranking: token overlap + log recency bonus.

    Recency bonus only applies when at least one token matches, so unrelated recent
    items never leak into the result set.
    """
    if not text:
        return 0.0
    text_l = text.lower()
    hits = sum(1 for t in query_tokens if t in text_l)
    if hits == 0:
        return 0.0
    score = float(hits)
    if recency_iso:
        try:
            t = datetime.fromisoformat(recency_iso.replace("Z", "+00:00"))
            days = max(0, (datetime.now(timezone.utc) - t).days)
            score += max(0.0, 1.0 - days / 90.0)
        except Exception:
            pass
    return score


def _snip(text: str, query_tokens: List[str], window: int = 220) -> str:
    if not text:
        return ""
    t = text.strip().replace("\n", " ")
    low = t.lower()
    for tok in query_tokens:
        i = low.find(tok)
        if i >= 0:
            start = max(0, i - window // 2)
            end = min(len(t), i + window // 2)
            prefix = "…" if start > 0 else ""
            suffix = "…" if end < len(t) else ""
            return prefix + t[start:end] + suffix
    return t[: window * 2] + ("…" if len(t) > window * 2 else "")


class PersonalSearchEngine:
    def __init__(self, db, google_helper=None):
        self.db = db
        self.gh = google_helper

    # ---------- per-source scanners ----------

    async def _search_messages(self, q_tokens: List[str], limit: int = 8) -> List[dict]:
        results: List[dict] = []
        cur = self.db.messages.find({}, {"_id": 0}).sort("created_at", -1).limit(2000)
        async for m in cur:
            text = m.get("content") or ""
            s = _score(q_tokens, text, m.get("created_at"))
            if s > 0:
                # Try to fetch session title for context
                sess = await self.db.sessions.find_one({"id": m.get("session_id")}, {"title": 1, "_id": 0})
                results.append({
                    "type": "chat",
                    "id": m.get("id"),
                    "title": (sess or {}).get("title") or "Chat",
                    "snippet": _snip(text, q_tokens),
                    "timestamp": m.get("created_at"),
                    "score": s,
                    "ref": {"session_id": m.get("session_id"), "role": m.get("role")},
                })
        return sorted(results, key=lambda x: x["score"], reverse=True)[:limit]

    async def _search_memories(self, q_tokens: List[str], limit: int = 6) -> List[dict]:
        out: List[dict] = []
        async for m in self.db.memories.find({}, {"_id": 0}):
            text = f"{m.get('subject','')} {m.get('detail','')}"
            s = _score(q_tokens, text, m.get("created_at"))
            if s > 0:
                out.append({
                    "type": "memory",
                    "id": m.get("id"),
                    "title": m.get("subject") or "Memory",
                    "snippet": _snip(m.get("detail") or "", q_tokens) or m.get("subject", ""),
                    "timestamp": m.get("created_at"),
                    "score": s + 0.5,  # personal memories slightly prioritized
                    "ref": {"category": m.get("category")},
                })
        return sorted(out, key=lambda x: x["score"], reverse=True)[:limit]

    async def _search_goals_reminders(self, q_tokens: List[str], limit: int = 6) -> List[dict]:
        out: List[dict] = []
        async for g in self.db.goals.find({}, {"_id": 0}):
            text = f"{g.get('title','')} {g.get('description','')}"
            s = _score(q_tokens, text, g.get("created_at"))
            if s > 0:
                out.append({
                    "type": "goal",
                    "id": g.get("id"),
                    "title": g.get("title"),
                    "snippet": _snip(g.get("description") or g.get("title", ""), q_tokens),
                    "timestamp": g.get("created_at"),
                    "score": s,
                    "ref": {"progress": g.get("progress"), "status": g.get("status")},
                })
        async for r in self.db.reminders.find({}, {"_id": 0}):
            text = f"{r.get('text','')} {r.get('condition','')}"
            s = _score(q_tokens, text, r.get("created_at"))
            if s > 0:
                out.append({
                    "type": "reminder",
                    "id": r.get("id"),
                    "title": r.get("text", "")[:80],
                    "snippet": (r.get("condition") and f"When: {r['condition']}") or r.get("text", ""),
                    "timestamp": r.get("created_at"),
                    "score": s,
                    "ref": {"status": r.get("status")},
                })
        return sorted(out, key=lambda x: x["score"], reverse=True)[:limit]

    async def _search_knowledge(self, q_tokens: List[str], limit: int = 6) -> List[dict]:
        out: List[dict] = []
        # Naive text search across chunks
        async for chunk in self.db.knowledge_chunks.find({}, {"_id": 0}).limit(3000):
            text = chunk.get("text") or ""
            s = _score(q_tokens, text)
            if s > 0:
                out.append({
                    "type": "knowledge",
                    "id": chunk.get("document_id"),
                    "title": chunk.get("document_name") or "Document",
                    "snippet": _snip(text, q_tokens),
                    "timestamp": chunk.get("created_at"),
                    "score": s + 0.3,
                    "ref": {"chunk_index": chunk.get("chunk_index"), "page": chunk.get("page")},
                })
        # De-duplicate per document by best score
        seen: Dict[str, dict] = {}
        for r in out:
            k = r["id"] or r["title"]
            if k not in seen or seen[k]["score"] < r["score"]:
                seen[k] = r
        return sorted(seen.values(), key=lambda x: x["score"], reverse=True)[:limit]

    async def _search_notifications_finance(self, q_tokens: List[str], limit: int = 6) -> List[dict]:
        out: List[dict] = []
        async for tx in self.db.transactions.find({}, {"_id": 0}).limit(2000):
            text = f"{tx.get('merchant','')} {tx.get('category','')} {tx.get('raw_text','')}"
            s = _score(q_tokens, text, tx.get("date"))
            if s > 0:
                amt = tx.get("amount", 0)
                out.append({
                    "type": "transaction",
                    "id": tx.get("id"),
                    "title": f"{tx.get('merchant','Transaction')} · ₹{int(amt) if amt else 0}",
                    "snippet": _snip(tx.get("raw_text") or "", q_tokens) or tx.get("category", ""),
                    "timestamp": tx.get("date"),
                    "score": s,
                    "ref": {"amount": amt, "category": tx.get("category"), "type": tx.get("type")},
                })
        async for n in self.db.notifications.find({}, {"_id": 0}).sort("created_at", -1).limit(500):
            text = f"{n.get('title','')} {n.get('text','')} {n.get('app_name','')}"
            s = _score(q_tokens, text, n.get("created_at"))
            if s > 0:
                out.append({
                    "type": "notification",
                    "id": n.get("id"),
                    "title": n.get("title") or n.get("app_name") or "Notification",
                    "snippet": _snip(n.get("text") or "", q_tokens),
                    "timestamp": n.get("created_at"),
                    "score": s - 0.2,
                    "ref": {"app": n.get("app_name"), "category": n.get("category")},
                })
        return sorted(out, key=lambda x: x["score"], reverse=True)[:limit]

    async def _search_calendar(self, q_tokens: List[str], limit: int = 4) -> List[dict]:
        out: List[dict] = []
        if not self.gh:
            return out
        try:
            token = await self.gh.get_valid_token(self.db)
            if not token:
                return out
            events = await self.gh.list_upcoming_events(token, max_results=50)
            for ev in events or []:
                text = f"{ev.get('summary','')} {ev.get('description','')} {ev.get('location','')}"
                s = _score(q_tokens, text, ev.get("start", {}).get("dateTime"))
                if s > 0:
                    out.append({
                        "type": "calendar",
                        "id": ev.get("id"),
                        "title": ev.get("summary") or "Calendar event",
                        "snippet": _snip((ev.get("description") or "") + " " + (ev.get("location") or ""), q_tokens) or ev.get("location", ""),
                        "timestamp": ev.get("start", {}).get("dateTime") or ev.get("start", {}).get("date"),
                        "score": s,
                        "ref": {"location": ev.get("location")},
                    })
        except Exception as e:
            logger.warning("Calendar search failed: %s", e)
        return sorted(out, key=lambda x: x["score"], reverse=True)[:limit]

    async def _search_gmail(self, q_tokens: List[str], q_text: str, limit: int = 5) -> List[dict]:
        out: List[dict] = []
        if not self.gh:
            return out
        try:
            token = await self.gh.get_valid_token(self.db)
            if not token:
                return out
            # google_helper has list_recent_messages; we filter client-side by tokens
            messages = await self.gh.list_recent_messages(token, max_results=25)
            for m in messages or []:
                text = f"{m.get('subject','')} {m.get('snippet','')} {m.get('from','')}"
                s = _score(q_tokens, text)
                if s > 0:
                    out.append({
                        "type": "email",
                        "id": m.get("id"),
                        "title": m.get("subject") or "(no subject)",
                        "snippet": (m.get("snippet") or "")[:280],
                        "timestamp": m.get("date"),
                        "score": s + 0.2,
                        "ref": {"from": m.get("from"), "to": m.get("to")},
                    })
        except Exception as e:
            logger.warning("Gmail search failed: %s", e)
        return sorted(out, key=lambda x: x["score"], reverse=True)[:limit]

    # ---------- public API ----------

    async def search(self, query: str, sources: Optional[List[str]] = None, top_k: int = 12, synthesize: bool = True) -> Dict[str, Any]:
        query = (query or "").strip()
        if not query:
            return {"query": "", "answer": "", "sources": [], "stats": {}}

        q_tokens = _tokenize(query)
        wanted = set(sources or ["chat", "memory", "goal", "reminder", "knowledge", "finance", "calendar", "email"])

        # Run scanners in dependency order (cheap first)
        results: List[dict] = []
        try:
            if "chat" in wanted:
                results += await self._search_messages(q_tokens)
            if "memory" in wanted:
                results += await self._search_memories(q_tokens)
            if {"goal", "reminder"} & wanted:
                results += await self._search_goals_reminders(q_tokens)
            if "knowledge" in wanted:
                results += await self._search_knowledge(q_tokens)
            if "finance" in wanted:
                results += await self._search_notifications_finance(q_tokens)
            if "calendar" in wanted:
                results += await self._search_calendar(q_tokens)
            if "email" in wanted:
                results += await self._search_gmail(q_tokens, query)
        except Exception as e:
            logger.warning("Search scan failed: %s", e)

        # Filter by wanted types post-hoc
        type_map = {
            "chat": "chat", "memory": "memory", "goal": "goal", "reminder": "reminder",
            "knowledge": "knowledge", "finance": "transaction", "calendar": "calendar", "email": "email",
        }
        keep_types = {type_map[s] for s in wanted if s in type_map}
        # transactions + notifications both come from "finance"
        if "finance" in wanted:
            keep_types.add("notification")

        results = [r for r in results if r["type"] in keep_types]
        results.sort(key=lambda x: x["score"], reverse=True)
        results = results[:top_k]

        stats: Dict[str, int] = {}
        for r in results:
            stats[r["type"]] = stats.get(r["type"], 0) + 1

        answer = ""
        if synthesize and results:
            try:
                # local import to avoid cycle
                from server import _bedrock_converse  # type: ignore
                context_lines = []
                for i, r in enumerate(results[:8], 1):
                    context_lines.append(
                        f"[{i}] ({r['type']}) {r['title']}\n    {r['snippet']}"
                    )
                prompt = (
                    f"User question: {query}\n\n"
                    f"Sources from the user's personal data (highest-ranked first):\n"
                    + "\n".join(context_lines)
                    + "\n\nAnswer the user concisely (2-4 sentences). "
                    "Cite sources using bracketed numbers like [1], [3]. "
                    "If the sources don't contain the answer, say so honestly."
                )
                answer = await _bedrock_converse(
                    messages=[{"role": "user", "content": [{"text": prompt}]}],
                    system_text="You are a precise research assistant for Varun's personal data. Be factual and brief.",
                    max_tokens=350,
                    temperature=0.3,
                )
                answer = (answer or "").strip()
            except Exception as e:
                logger.warning("Synthesis failed: %s", e)

        return {
            "query": query,
            "answer": answer,
            "sources": results,
            "stats": stats,
            "generated_at": _now_iso(),
        }
