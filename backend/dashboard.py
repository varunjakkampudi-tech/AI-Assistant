"""
Personal AI Dashboard Analytics for Nova AI Assistant
Provides usage stats, spending insights, and productivity analytics.
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
from collections import defaultdict

logger = logging.getLogger(__name__)


async def get_usage_stats(db, days: int = 30) -> Dict[str, Any]:
    """Get usage statistics for the dashboard."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    
    # Total counts
    total_sessions = await db.chat_sessions.count_documents({})
    total_messages = await db.chat_messages.count_documents({})
    total_memories = await db.memories.count_documents({})
    total_goals = await db.goals.count_documents({})
    total_reminders = await db.reminders.count_documents({})
    
    # Recent activity
    recent_sessions = await db.chat_sessions.count_documents({"created_at": {"$gte": cutoff}})
    recent_messages = await db.chat_messages.count_documents({"created_at": {"$gte": cutoff}})
    
    # Messages by day (last 7 days)
    daily_messages = []
    for i in range(7):
        day_start = (datetime.now(timezone.utc) - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        count = await db.chat_messages.count_documents({
            "created_at": {"$gte": day_start.isoformat(), "$lt": day_end.isoformat()}
        })
        daily_messages.append({
            "date": day_start.strftime("%Y-%m-%d"),
            "day": day_start.strftime("%a"),
            "count": count
        })
    daily_messages.reverse()
    
    # Goal progress
    active_goals = await db.goals.count_documents({"status": "active"})
    completed_goals = await db.goals.count_documents({"status": "completed"})
    
    # Average goal progress
    pipeline = [
        {"$match": {"status": "active"}},
        {"$group": {"_id": None, "avg_progress": {"$avg": "$progress"}}}
    ]
    avg_progress = 0
    async for doc in db.goals.aggregate(pipeline):
        avg_progress = round(doc.get("avg_progress", 0), 1)
    
    # Reminder stats
    pending_reminders = await db.reminders.count_documents({"status": "pending"})
    done_reminders = await db.reminders.count_documents({"status": "done"})
    
    # Memory categories
    memory_pipeline = [
        {"$group": {"_id": "$category", "count": {"$sum": 1}}}
    ]
    memory_by_category = {}
    async for doc in db.memories.aggregate(memory_pipeline):
        memory_by_category[doc["_id"] or "other"] = doc["count"]
    
    return {
        "period_days": days,
        "totals": {
            "sessions": total_sessions,
            "messages": total_messages,
            "memories": total_memories,
            "goals": total_goals,
            "reminders": total_reminders
        },
        "recent": {
            "sessions": recent_sessions,
            "messages": recent_messages
        },
        "daily_messages": daily_messages,
        "goals": {
            "active": active_goals,
            "completed": completed_goals,
            "average_progress": avg_progress
        },
        "reminders": {
            "pending": pending_reminders,
            "completed": done_reminders
        },
        "memories_by_category": memory_by_category
    }


async def get_spending_insights(db, days: int = 30) -> Dict[str, Any]:
    """Get spending insights from banking notifications."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    
    # Get all transactions
    transactions = await db.notifications.find({
        "kind": "transaction",
        "posted_at": {"$gte": cutoff}
    }, {"_id": 0}).to_list(1000)
    
    if not transactions:
        return {
            "period_days": days,
            "has_data": False,
            "message": "No transaction data available. Connect banking notifications to see insights."
        }
    
    # Calculate totals
    total_spent = 0
    total_received = 0
    by_merchant: Dict[str, float] = defaultdict(float)
    by_day: Dict[str, Dict[str, float]] = defaultdict(lambda: {"spent": 0, "received": 0})
    currency = "INR"  # Default
    
    for tx in transactions:
        amount = tx.get("amount") or 0
        direction = (tx.get("direction") or "").lower()
        merchant = tx.get("merchant", "Unknown")
        
        if tx.get("currency"):
            currency = tx["currency"]
        
        # Parse date
        posted = tx.get("posted_at", "")
        try:
            day = posted[:10]  # YYYY-MM-DD
        except:
            day = "unknown"
        
        if direction == "debit":
            total_spent += amount
            by_merchant[merchant] += amount
            by_day[day]["spent"] += amount
        elif direction == "credit":
            total_received += amount
            by_day[day]["received"] += amount
    
    # Top spending categories
    top_merchants = sorted(by_merchant.items(), key=lambda x: x[1], reverse=True)[:10]
    
    # Daily spending trend (last 7 days)
    daily_spending = []
    for i in range(7):
        day = (datetime.now(timezone.utc) - timedelta(days=i)).strftime("%Y-%m-%d")
        daily_spending.append({
            "date": day,
            "spent": round(by_day[day]["spent"], 2),
            "received": round(by_day[day]["received"], 2)
        })
    daily_spending.reverse()
    
    # Calculate averages
    days_with_data = len([d for d in by_day.values() if d["spent"] > 0])
    avg_daily_spend = total_spent / max(days_with_data, 1)
    
    return {
        "period_days": days,
        "has_data": True,
        "currency": currency,
        "summary": {
            "total_spent": round(total_spent, 2),
            "total_received": round(total_received, 2),
            "net_flow": round(total_received - total_spent, 2),
            "transaction_count": len(transactions),
            "avg_daily_spend": round(avg_daily_spend, 2)
        },
        "top_merchants": [
            {"name": name, "amount": round(amt, 2), "percentage": round((amt / total_spent) * 100, 1) if total_spent > 0 else 0}
            for name, amt in top_merchants
        ],
        "daily_trend": daily_spending
    }


async def get_productivity_analytics(db, days: int = 7) -> Dict[str, Any]:
    """Get productivity analytics."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    
    # Get recent messages
    messages = await db.chat_messages.find(
        {"created_at": {"$gte": cutoff}},
        {"_id": 0, "role": 1, "created_at": 1, "emotion": 1}
    ).to_list(5000)
    
    if not messages:
        return {
            "period_days": days,
            "has_data": False,
            "message": "No activity data for this period."
        }
    
    # Activity by hour
    by_hour = defaultdict(int)
    by_emotion = defaultdict(int)
    user_messages = 0
    ai_messages = 0
    
    for msg in messages:
        role = msg.get("role", "")
        emotion = msg.get("emotion", "neutral")
        
        if role == "user":
            user_messages += 1
            by_emotion[emotion or "neutral"] += 1
            
            # Parse hour
            try:
                created = msg.get("created_at", "")
                if created:
                    hour = int(created[11:13])
                    by_hour[hour] += 1
            except:
                pass
        elif role == "assistant":
            ai_messages += 1
    
    # Find peak hours
    peak_hours = sorted(by_hour.items(), key=lambda x: x[1], reverse=True)[:3]
    
    # Active hours distribution
    hourly_activity = [{"hour": h, "count": by_hour.get(h, 0)} for h in range(24)]
    
    # Emotion distribution
    emotion_dist = dict(by_emotion)
    
    # Calculate streaks (consecutive days with activity)
    active_days = set()
    for msg in messages:
        try:
            day = msg.get("created_at", "")[:10]
            active_days.add(day)
        except:
            pass
    
    # Goal completion rate
    completed_goals = await db.goals.count_documents({"status": "completed"})
    total_goals = await db.goals.count_documents({})
    completion_rate = (completed_goals / total_goals * 100) if total_goals > 0 else 0
    
    # Reminder completion rate
    done_reminders = await db.reminders.count_documents({"status": "done"})
    total_reminders = await db.reminders.count_documents({})
    reminder_rate = (done_reminders / total_reminders * 100) if total_reminders > 0 else 0
    
    return {
        "period_days": days,
        "has_data": True,
        "activity": {
            "total_interactions": user_messages + ai_messages,
            "user_messages": user_messages,
            "ai_responses": ai_messages,
            "active_days": len(active_days)
        },
        "peak_hours": [{"hour": h, "count": c, "label": f"{h:02d}:00"} for h, c in peak_hours],
        "hourly_activity": hourly_activity,
        "emotion_distribution": emotion_dist,
        "completion_rates": {
            "goals": round(completion_rate, 1),
            "reminders": round(reminder_rate, 1)
        }
    }


async def get_ai_insights(db) -> Dict[str, Any]:
    """Get AI-generated insights about user patterns."""
    # This could be enhanced with actual AI analysis
    
    # Get recent data
    recent_goals = await db.goals.find({"status": "active"}, {"_id": 0}).limit(5).to_list(5)
    pending_reminders = await db.reminders.find({"status": "pending"}, {"_id": 0}).limit(5).to_list(5)
    
    insights = []
    
    # Goal insights
    for goal in recent_goals:
        progress = goal.get("progress", 0)
        title = goal.get("title", "")
        if progress == 0:
            insights.append({
                "type": "goal",
                "priority": "medium",
                "message": f"You haven't started on '{title}' yet. Would you like some help getting started?"
            })
        elif progress >= 80:
            insights.append({
                "type": "goal",
                "priority": "low",
                "message": f"Great progress on '{title}'! You're {progress}% there."
            })
    
    # Reminder insights
    if len(pending_reminders) > 5:
        insights.append({
            "type": "reminder",
            "priority": "high",
            "message": f"You have {len(pending_reminders)} pending reminders. Want me to help prioritize them?"
        })
    
    # Memory insights
    memory_count = await db.memories.count_documents({})
    if memory_count > 50:
        insights.append({
            "type": "memory",
            "priority": "low",
            "message": f"I've learned {memory_count} things about you! Our conversations are getting more personalized."
        })
    
    return {
        "insights": insights,
        "generated_at": datetime.now(timezone.utc).isoformat()
    }


async def get_full_dashboard(db, days: int = 30) -> Dict[str, Any]:
    """Get complete dashboard data."""
    usage = await get_usage_stats(db, days)
    spending = await get_spending_insights(db, days)
    productivity = await get_productivity_analytics(db, min(days, 7))
    insights = await get_ai_insights(db)
    
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "usage": usage,
        "spending": spending,
        "productivity": productivity,
        "insights": insights
    }
