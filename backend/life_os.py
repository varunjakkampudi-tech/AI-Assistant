"""
LIFE OPERATING SYSTEM
=====================
Computes a single dashboard of life scores across multiple dimensions
and generates AI-curated daily recommendations.

Dimensions (each 0-100):
- Health     — health/fitness goals + reminders + activity streaks
- Career     — work goals progress + completed reminders + email responsiveness proxy
- Finance    — net cash flow, savings rate, recurring control, no-overspend streak
- Learning   — learning goals progress + knowledge documents added + skill items in memories
- Relationships — frequent-contact interaction recency + diversity

Recommendations are concrete next actions (max 5) generated daily.
"""

from __future__ import annotations
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso_to_dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None


def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> int:
    return int(round(max(lo, min(hi, v))))


def _grade(score: int) -> str:
    if score >= 90:
        return "Excellent"
    if score >= 75:
        return "Strong"
    if score >= 60:
        return "On track"
    if score >= 40:
        return "Needs care"
    return "Critical"


HEALTH_KEYWORDS = {"health", "fitness", "gym", "workout", "yoga", "weight", "run", "walk", "meditate", "sleep", "diet", "nutrition"}
CAREER_KEYWORDS = {"career", "work", "job", "project", "deployment", "certification", "promotion", "performance", "client", "aws", "aem"}
LEARNING_KEYWORDS = {"learn", "learning", "study", "course", "skill", "playwright", "book", "read", "tutorial", "module", "training"}
FINANCE_KEYWORDS = {"finance", "money", "save", "saving", "budget", "invest", "investment", "tax", "expense", "spending"}


def _category_match(title: str, description: str, keywords: set) -> bool:
    text = f"{title or ''} {description or ''}".lower()
    return any(k in text for k in keywords)


class LifeOperatingSystem:
    def __init__(self, db, finance_brain=None, digital_twin=None):
        self.db = db
        self.fb = finance_brain
        self.dt = digital_twin

    # ---------- per-dimension scorers ----------

    async def _health_score(self) -> Dict[str, Any]:
        score = 50.0
        signals: List[str] = []
        health_goals: List[dict] = []
        async for g in self.db.goals.find({}, {"_id": 0}):
            if _category_match(g.get("title", ""), g.get("description", ""), HEALTH_KEYWORDS):
                health_goals.append(g)
        if health_goals:
            avg_progress = sum(g.get("progress", 0) for g in health_goals) / len(health_goals)
            # 50 baseline → goes UP with progress, never DROPS below baseline for tracking the goal
            score = max(50.0, 50 + avg_progress * 0.5)
            signals.append(f"{len(health_goals)} active health goal(s), avg progress {int(avg_progress)}%")
        else:
            signals.append("No health goals tracked — add one to start scoring")

        # Bonus: health-related memories
        health_mems = 0
        async for m in self.db.memories.find({"category": {"$in": ["health", "personal"]}}, {"_id": 0}).limit(50):
            health_mems += 1
        if health_mems:
            score += min(5, health_mems)
            signals.append(f"{health_mems} health-related memory point(s)")

        return {"score": _clamp(score), "signals": signals, "items_tracked": len(health_goals)}

    async def _career_score(self) -> Dict[str, Any]:
        score = 55.0
        signals: List[str] = []
        career_goals: List[dict] = []
        async for g in self.db.goals.find({}, {"_id": 0}):
            if _category_match(g.get("title", ""), g.get("description", ""), CAREER_KEYWORDS):
                career_goals.append(g)
        if career_goals:
            avg_progress = sum(g.get("progress", 0) for g in career_goals) / len(career_goals)
            completed = sum(1 for g in career_goals if (g.get("status") or "") == "completed")
            score = 50 + avg_progress * 0.4 + completed * 5
            signals.append(f"{len(career_goals)} career goal(s) · {completed} completed · avg {int(avg_progress)}%")

        # Reminder discipline (completed vs pending)
        total_rem = await self.db.reminders.count_documents({})
        done_rem = await self.db.reminders.count_documents({"status": "completed"})
        if total_rem:
            ratio = done_rem / max(1, total_rem)
            score += ratio * 10
            signals.append(f"Reminder completion: {int(ratio * 100)}% ({done_rem}/{total_rem})")
        return {"score": _clamp(score), "signals": signals, "items_tracked": len(career_goals)}

    async def _finance_score(self) -> Dict[str, Any]:
        score = 60.0
        signals: List[str] = []
        items_tracked = 0
        try:
            if self.fb:
                summary = await self.fb.get_spending_summary(days=30)
                if summary.get("has_data") and summary.get("summary"):
                    s = summary["summary"]
                    items_tracked = int(s.get("transaction_count", 0))
                    spent = s.get("total_spent", 0)
                    received = s.get("total_received", 0)
                    net = s.get("net_flow", 0)
                    if received > 0:
                        savings_rate = max(-1.0, min(1.0, net / received))
                        # +/-50 around 60 baseline
                        score = 60 + savings_rate * 30
                        signals.append(
                            f"Savings rate {int(savings_rate * 100)}% · spent ₹{int(spent)} of ₹{int(received)} received"
                        )
                    else:
                        # No income reported but expense tracking still ok
                        signals.append(f"Tracked ₹{int(spent)} spending across {items_tracked} txns (no income data)")
                        score = 55
                else:
                    signals.append("No bank/UPI notifications yet — connect to start scoring")
        except Exception as e:
            logger.warning("Finance scoring failed: %s", e)

        return {"score": _clamp(score), "signals": signals, "items_tracked": items_tracked}

    async def _learning_score(self) -> Dict[str, Any]:
        score = 50.0
        signals: List[str] = []
        learning_goals: List[dict] = []
        async for g in self.db.goals.find({}, {"_id": 0}):
            if _category_match(g.get("title", ""), g.get("description", ""), LEARNING_KEYWORDS):
                learning_goals.append(g)
        if learning_goals:
            avg = sum(g.get("progress", 0) for g in learning_goals) / len(learning_goals)
            score = 45 + avg * 0.5
            signals.append(f"{len(learning_goals)} learning goal(s) · avg {int(avg)}% progress")

        # Knowledge vault documents
        kdocs = await self.db.knowledge_documents.count_documents({})
        if kdocs:
            score += min(15, kdocs * 2)
            signals.append(f"{kdocs} document(s) in Knowledge Vault")

        # Skill memories
        skill_mems = await self.db.memories.count_documents({"category": "skill"})
        if skill_mems:
            score += min(10, skill_mems * 2)
            signals.append(f"{skill_mems} skill memory point(s)")

        return {"score": _clamp(score), "signals": signals, "items_tracked": len(learning_goals)}

    async def _relationships_score(self) -> Dict[str, Any]:
        score = 55.0
        signals: List[str] = []
        contact_count = 0
        try:
            if self.dt:
                profile = await self.dt.get_profile()
                contacts = (profile or {}).get("frequent_contacts") or []
                contact_count = len(contacts)
                if contacts:
                    # Diversity (number of distinct contacts) + recent interaction
                    score = 50 + min(30, contact_count * 4)
                    recent = 0
                    cutoff = _utcnow() - timedelta(days=14)
                    for c in contacts:
                        last = _iso_to_dt(c.get("last_contact"))
                        if last and last >= cutoff:
                            recent += 1
                    if recent:
                        score += min(15, recent * 3)
                        signals.append(f"{recent} contact(s) reached in last 14 days")
                    signals.append(f"{contact_count} frequent contacts tracked")
        except Exception as e:
            logger.warning("Relationships scoring failed: %s", e)

        # Family memories
        fam = await self.db.memories.count_documents({"category": {"$in": ["family", "personal"]}})
        if fam:
            score += min(10, fam)
            signals.append(f"{fam} family/personal memory point(s)")

        return {"score": _clamp(score), "signals": signals, "items_tracked": contact_count}

    # ---------- public ----------

    async def get_scores(self) -> Dict[str, Any]:
        health = await self._health_score()
        career = await self._career_score()
        finance = await self._finance_score()
        learning = await self._learning_score()
        relationships = await self._relationships_score()

        dims = {
            "health": health,
            "career": career,
            "finance": finance,
            "learning": learning,
            "relationships": relationships,
        }
        overall = int(round(sum(d["score"] for d in dims.values()) / len(dims)))

        # Identify weakest + strongest
        sorted_dims = sorted(dims.items(), key=lambda kv: kv[1]["score"])
        weakest = sorted_dims[0]
        strongest = sorted_dims[-1]

        return {
            "overall": overall,
            "overall_grade": _grade(overall),
            "dimensions": {
                k: {"score": v["score"], "grade": _grade(v["score"]), "signals": v["signals"], "items_tracked": v["items_tracked"]}
                for k, v in dims.items()
            },
            "weakest": {"name": weakest[0], "score": weakest[1]["score"]},
            "strongest": {"name": strongest[0], "score": strongest[1]["score"]},
            "generated_at": _utcnow().isoformat(),
        }

    async def get_recommendations(self, max_items: int = 5) -> List[Dict[str, Any]]:
        """AI-generated daily recommendations. Falls back to rule-based if Bedrock unavailable."""
        scores = await self.get_scores()
        # Rule-based recs first
        recs: List[Dict[str, Any]] = []
        for name, d in scores["dimensions"].items():
            s = d["score"]
            if s < 60:
                if name == "health":
                    recs.append({
                        "dimension": name,
                        "title": "Add a 20-minute walk today",
                        "why": "Health score is low. A short walk boosts mood and counts toward your fitness goal.",
                        "icon": "fitness",
                        "priority": "medium",
                    })
                elif name == "career":
                    recs.append({
                        "dimension": name,
                        "title": "Pick the smallest pending career task and ship it",
                        "why": "Career momentum drops without a daily completion. Aim for one small win.",
                        "icon": "briefcase",
                        "priority": "high",
                    })
                elif name == "finance":
                    recs.append({
                        "dimension": name,
                        "title": "Review your top 3 spend categories",
                        "why": "Spending exceeds income or no data yet. Review what's driving outflow.",
                        "icon": "wallet",
                        "priority": "high",
                    })
                elif name == "learning":
                    recs.append({
                        "dimension": name,
                        "title": "Spend 25 min on your current course module",
                        "why": "Daily 25-min focus (Pomodoro) compounds quickly.",
                        "icon": "school",
                        "priority": "medium",
                    })
                elif name == "relationships":
                    recs.append({
                        "dimension": name,
                        "title": "Send a quick check-in to one frequent contact",
                        "why": "You haven't reached out to many people lately — relationships need cadence.",
                        "icon": "people",
                        "priority": "medium",
                    })

        # If everything is above 60, suggest pushing the weakest forward
        if not recs:
            w = scores["weakest"]["name"]
            recs.append({
                "dimension": w,
                "title": f"Push your {w} score above {scores['weakest']['score'] + 10}",
                "why": "All dimensions are healthy. Focus on the lowest to round out your life OS.",
                "icon": "trending-up",
                "priority": "low",
            })

        # Try Bedrock for one personalized rec
        try:
            from server import _bedrock_converse  # type: ignore
            bullet = "\n".join(
                f"- {k}: {v['score']} ({v['grade']}) — {'; '.join(v['signals'][:2]) or 'no signals'}"
                for k, v in scores["dimensions"].items()
            )
            prompt = (
                "Your job is to write ONE short, concrete next action for the user today "
                "(<= 1 sentence, action-first verb). Personalize to the weakest dimension.\n\n"
                f"Current scores:\n{bullet}\n\nReturn ONLY the action sentence, no preamble."
            )
            ai_action = await _bedrock_converse(
                messages=[{"role": "user", "content": [{"text": prompt}]}],
                system_text="You write punchy 1-sentence daily actions for a personal life-OS dashboard.",
                max_tokens=80,
                temperature=0.5,
            )
            ai_action = (ai_action or "").strip().split("\n")[0]
            if ai_action and len(ai_action) > 5:
                recs.insert(0, {
                    "dimension": scores["weakest"]["name"],
                    "title": ai_action.lstrip("- ").strip(),
                    "why": "Personalized by Nova based on your current scores.",
                    "icon": "sparkles",
                    "priority": "high",
                })
        except Exception as e:
            logger.warning("AI recommendation failed: %s", e)

        return recs[:max_items]

    async def get_dashboard(self) -> Dict[str, Any]:
        scores = await self.get_scores()
        recs = await self.get_recommendations()
        return {**scores, "recommendations": recs}
