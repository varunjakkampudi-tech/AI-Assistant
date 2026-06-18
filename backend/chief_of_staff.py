"""
AI Chief of Staff for Nova AI Assistant
Proactively generates daily plans, prioritizes tasks, and provides executive-level briefings.
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
import json

logger = logging.getLogger(__name__)


# ==================== TIME BLOCKS ====================

TIME_BLOCKS = {
    "early_morning": (5, 8),   # 5 AM - 8 AM
    "morning": (8, 12),        # 8 AM - 12 PM
    "afternoon": (12, 17),     # 12 PM - 5 PM
    "evening": (17, 21),       # 5 PM - 9 PM
    "night": (21, 24),         # 9 PM - 12 AM
}


def get_time_block(hour: int) -> str:
    """Get the time block for a given hour."""
    for block, (start, end) in TIME_BLOCKS.items():
        if start <= hour < end:
            return block
    return "night"


def format_time(hour: int, minute: int = 0) -> str:
    """Format time in 12-hour format."""
    period = "AM" if hour < 12 else "PM"
    display_hour = hour % 12 or 12
    return f"{display_hour}:{minute:02d} {period}"


# ==================== AI CHIEF OF STAFF ====================

class AIChiefOfStaff:
    """Proactive AI assistant that plans your day and prioritizes tasks."""
    
    def __init__(self, db, google_helper=None):
        self.db = db
        self.google_helper = google_helper
    
    async def generate_morning_briefing(self, timezone_offset: int = 0) -> Dict[str, Any]:
        """Generate comprehensive morning briefing with proactive suggestions."""
        now = datetime.now(timezone.utc) + timedelta(hours=timezone_offset)
        today = now.date()
        
        briefing = {
            "greeting": self._get_greeting(now.hour),
            "date": today.isoformat(),
            "day_of_week": today.strftime("%A"),
            "sections": []
        }
        
        # 1. Calendar Overview
        calendar_section = await self._get_calendar_summary(timezone_offset)
        if calendar_section:
            briefing["sections"].append(calendar_section)
        
        # 2. Priority Tasks (Goals & Reminders)
        tasks_section = await self._get_priority_tasks()
        if tasks_section:
            briefing["sections"].append(tasks_section)
        
        # 3. Unread Emails Summary
        email_section = await self._get_email_summary()
        if email_section:
            briefing["sections"].append(email_section)
        
        # 4. Missed Calls
        calls_section = await self._get_missed_calls_summary()
        if calls_section:
            briefing["sections"].append(calls_section)
        
        # 5. Overdue Items
        overdue_section = await self._get_overdue_items()
        if overdue_section:
            briefing["sections"].append(overdue_section)
        
        # 6. Streaks & Progress
        progress_section = await self._get_progress_summary()
        if progress_section:
            briefing["sections"].append(progress_section)
        
        # 7. Generate Suggested Plan
        plan = await self._generate_daily_plan(calendar_section, tasks_section)
        briefing["suggested_plan"] = plan
        
        # 8. Quick Actions
        briefing["quick_actions"] = await self._get_quick_actions()
        
        return briefing
    
    def _get_greeting(self, hour: int) -> str:
        """Get contextual greeting based on time."""
        if hour < 5:
            return "You're up early!"
        elif hour < 12:
            return "Good morning"
        elif hour < 17:
            return "Good afternoon"
        elif hour < 21:
            return "Good evening"
        else:
            return "Good night"
    
    async def _get_calendar_summary(self, tz_offset: int) -> Optional[Dict[str, Any]]:
        """Get today's calendar events."""
        try:
            if not self.google_helper:
                return None
            
            token = await self.google_helper.get_valid_token(self.db)
            if not token:
                return None
            
            events = await self.google_helper.list_upcoming_events(token, max_results=10)
            
            # Filter to today's events
            now = datetime.now(timezone.utc) + timedelta(hours=tz_offset)
            today = now.date().isoformat()
            
            today_events = []
            for ev in events:
                start = ev.get("start", "")
                if isinstance(start, dict):
                    start = start.get("dateTime", start.get("date", ""))
                
                if today in str(start):
                    today_events.append({
                        "title": ev.get("summary", "Untitled"),
                        "start": start,
                        "location": ev.get("location"),
                    })
            
            if not today_events:
                return None
            
            return {
                "type": "calendar",
                "title": "Today's Meetings",
                "icon": "calendar",
                "count": len(today_events),
                "items": today_events[:5],
                "summary": f"You have {len(today_events)} meeting{'s' if len(today_events) != 1 else ''} today."
            }
        except Exception as e:
            logger.warning(f"Calendar summary failed: {e}")
            return None
    
    async def _get_priority_tasks(self) -> Optional[Dict[str, Any]]:
        """Get high-priority tasks (active goals and pending reminders)."""
        # Get active goals
        goals = await self.db.goals.find(
            {"status": "active"},
            {"_id": 0}
        ).sort("created_at", -1).limit(5).to_list(5)
        
        # Get pending reminders
        reminders = await self.db.reminders.find(
            {"status": "pending"},
            {"_id": 0}
        ).limit(5).to_list(5)
        
        items = []
        
        for g in goals:
            items.append({
                "type": "goal",
                "title": g.get("title"),
                "progress": g.get("progress", 0),
                "priority": "high" if g.get("progress", 0) < 20 else "medium"
            })
        
        for r in reminders:
            items.append({
                "type": "reminder",
                "title": r.get("text"),
                "condition": r.get("condition"),
                "priority": "medium"
            })
        
        if not items:
            return None
        
        # Sort by priority
        priority_order = {"high": 0, "medium": 1, "low": 2}
        items.sort(key=lambda x: priority_order.get(x.get("priority", "low"), 2))
        
        return {
            "type": "tasks",
            "title": "Priority Tasks",
            "icon": "checkbox",
            "count": len(items),
            "items": items[:6],
            "summary": f"{len(goals)} active goals, {len(reminders)} pending reminders"
        }
    
    async def _get_email_summary(self) -> Optional[Dict[str, Any]]:
        """Get unread/important email summary."""
        try:
            if not self.google_helper:
                return None
            
            token = await self.google_helper.get_valid_token(self.db)
            if not token:
                return None
            
            emails = await self.google_helper.list_recent_messages(token, max_results=10)
            
            unread = [e for e in emails if e.get("unread")]
            
            if not unread:
                return None
            
            return {
                "type": "email",
                "title": "Unread Emails",
                "icon": "mail",
                "count": len(unread),
                "items": [
                    {"from": e.get("from"), "subject": e.get("subject")}
                    for e in unread[:5]
                ],
                "summary": f"{len(unread)} unread email{'s' if len(unread) != 1 else ''} to review"
            }
        except Exception as e:
            logger.warning(f"Email summary failed: {e}")
            return None
    
    async def _get_missed_calls_summary(self) -> Optional[Dict[str, Any]]:
        """Get missed calls."""
        missed = await self.db.missed_call_reminders.find(
            {"status": "pending"},
            {"_id": 0}
        ).to_list(10)
        
        if not missed:
            return None
        
        return {
            "type": "calls",
            "title": "Missed Calls",
            "icon": "call",
            "count": len(missed),
            "items": [
                {"name": m.get("contact_name") or m.get("phone_number"), "time": m.get("missed_at")}
                for m in missed[:5]
            ],
            "summary": f"{len(missed)} missed call{'s' if len(missed) != 1 else ''} to return"
        }
    
    async def _get_overdue_items(self) -> Optional[Dict[str, Any]]:
        """Get overdue goals and reminders."""
        now = datetime.now(timezone.utc).isoformat()
        
        # Check for goals with low progress that were created long ago
        old_goals = await self.db.goals.find({
            "status": "active",
            "progress": {"$lt": 30},
            "created_at": {"$lt": (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()}
        }, {"_id": 0}).limit(5).to_list(5)
        
        if not old_goals:
            return None
        
        return {
            "type": "overdue",
            "title": "Needs Attention",
            "icon": "alert-circle",
            "count": len(old_goals),
            "items": [
                {"title": g.get("title"), "progress": g.get("progress", 0)}
                for g in old_goals
            ],
            "summary": f"{len(old_goals)} goal{'s' if len(old_goals) != 1 else ''} with low progress"
        }
    
    async def _get_progress_summary(self) -> Optional[Dict[str, Any]]:
        """Get progress/streak information."""
        # Count completed goals
        completed = await self.db.goals.count_documents({"status": "completed"})
        
        # Count done reminders
        done_reminders = await self.db.reminders.count_documents({"status": "done"})
        
        # Calculate conversation streak
        week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        recent_sessions = await self.db.chat_sessions.count_documents(
            {"created_at": {"$gte": week_ago}}
        )
        
        if completed == 0 and done_reminders == 0:
            return None
        
        return {
            "type": "progress",
            "title": "Your Progress",
            "icon": "trophy",
            "items": [
                {"label": "Goals Completed", "value": completed},
                {"label": "Tasks Done", "value": done_reminders},
                {"label": "Active Week", "value": f"{recent_sessions} chats"},
            ],
            "summary": f"Keep up the momentum!"
        }
    
    async def _generate_daily_plan(
        self,
        calendar_section: Optional[Dict],
        tasks_section: Optional[Dict]
    ) -> List[Dict[str, Any]]:
        """Generate a suggested daily plan."""
        plan = []
        current_hour = datetime.now(timezone.utc).hour
        
        # Morning routine
        if current_hour < 9:
            plan.append({
                "time": "9:00 AM",
                "activity": "Review emails and messages",
                "type": "routine",
                "duration": 30
            })
        
        # Add calendar events
        if calendar_section and calendar_section.get("items"):
            for event in calendar_section["items"]:
                start = event.get("start", "")
                if isinstance(start, str) and "T" in start:
                    time_part = start.split("T")[1][:5]
                    hour = int(time_part.split(":")[0])
                    minute = int(time_part.split(":")[1])
                    plan.append({
                        "time": format_time(hour, minute),
                        "activity": event.get("title"),
                        "type": "meeting",
                        "location": event.get("location"),
                        "duration": 60
                    })
        
        # Add task blocks
        if tasks_section and tasks_section.get("items"):
            high_priority = [t for t in tasks_section["items"] if t.get("priority") == "high"]
            
            if high_priority and current_hour < 17:
                # Find a free slot
                next_slot = max(current_hour + 1, 10)
                plan.append({
                    "time": format_time(next_slot),
                    "activity": f"Focus: {high_priority[0].get('title')}",
                    "type": "focus",
                    "duration": 90
                })
        
        # Add breaks
        if len(plan) > 2:
            plan.append({
                "time": "1:00 PM",
                "activity": "Lunch break",
                "type": "break",
                "duration": 60
            })
        
        # Evening wrap-up
        if current_hour < 18:
            plan.append({
                "time": "6:00 PM",
                "activity": "Day review & tomorrow planning",
                "type": "routine",
                "duration": 15
            })
        
        # Sort by time
        def time_to_minutes(t: str) -> int:
            try:
                parts = t.replace(" AM", "").replace(" PM", "").split(":")
                hour = int(parts[0])
                minute = int(parts[1]) if len(parts) > 1 else 0
                if "PM" in t and hour != 12:
                    hour += 12
                elif "AM" in t and hour == 12:
                    hour = 0
                return hour * 60 + minute
            except:
                return 0
        
        plan.sort(key=lambda x: time_to_minutes(x.get("time", "0:00")))
        
        return plan
    
    async def _get_quick_actions(self) -> List[Dict[str, Any]]:
        """Get suggested quick actions."""
        actions = []
        
        # Check missed calls
        missed = await self.db.missed_call_reminders.count_documents({"status": "pending"})
        if missed > 0:
            actions.append({
                "label": f"Return {missed} missed call{'s' if missed != 1 else ''}",
                "action": "return_calls",
                "icon": "call"
            })
        
        # Check pending reminders
        reminders = await self.db.reminders.count_documents({"status": "pending"})
        if reminders > 3:
            actions.append({
                "label": "Review pending tasks",
                "action": "review_tasks",
                "icon": "checkbox"
            })
        
        # Suggest goal update
        stale_goals = await self.db.goals.count_documents({
            "status": "active",
            "updated_at": {"$lt": (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()}
        })
        if stale_goals > 0:
            actions.append({
                "label": f"Update {stale_goals} goal progress",
                "action": "update_goals",
                "icon": "trophy"
            })
        
        return actions[:4]
    
    async def get_smart_suggestions(self, context: str = "") -> List[Dict[str, Any]]:
        """Get AI-powered suggestions based on current context."""
        now = datetime.now(timezone.utc)
        hour = now.hour
        
        suggestions = []
        
        # Time-based suggestions
        if 8 <= hour <= 10:
            suggestions.append({
                "type": "routine",
                "text": "Good morning! Would you like me to read your daily briefing?",
                "action": "briefing"
            })
        elif 12 <= hour <= 14:
            suggestions.append({
                "type": "break",
                "text": "Time for a lunch break. Shall I summarize your morning progress?",
                "action": "summary"
            })
        elif 17 <= hour <= 19:
            suggestions.append({
                "type": "review",
                "text": "End of workday approaching. Want to review what's left for tomorrow?",
                "action": "tomorrow_plan"
            })
        
        # Context-based suggestions
        if "meeting" in context.lower():
            suggestions.append({
                "type": "meeting",
                "text": "Shall I prepare meeting notes or set a follow-up reminder?",
                "action": "meeting_notes"
            })
        
        return suggestions[:3]
