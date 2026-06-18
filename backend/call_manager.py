"""
Phone Call Management for Nova AI Assistant
Handles incoming calls, missed call reminders, and call answering via AI.
Requires native Android module for real call handling (mocked for Expo Go).
"""
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ==================== MODELS ====================

class IncomingCall(BaseModel):
    """Represents an incoming phone call."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    phone_number: str
    contact_name: Optional[str] = None
    call_type: str = "incoming"  # incoming | missed | answered | rejected
    status: str = "ringing"  # ringing | answered | missed | ended
    
    # Timestamps
    started_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    answered_at: Optional[str] = None
    ended_at: Optional[str] = None
    duration_seconds: int = 0
    
    # AI handling
    ai_answered: bool = False
    ai_transcript: List[Dict[str, str]] = []
    ai_summary: Optional[str] = None
    
    # Reminder
    reminder_created: bool = False
    reminder_sent: bool = False


class MissedCallReminder(BaseModel):
    """Reminder for a missed call."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    call_id: str
    phone_number: str
    contact_name: Optional[str] = None
    missed_at: str
    reminder_count: int = 0
    last_reminded_at: Optional[str] = None
    status: str = "pending"  # pending | reminded | called_back | dismissed
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# ==================== CALL MANAGER ====================

class CallManager:
    """Manages phone calls and missed call reminders."""
    
    def __init__(self, db):
        self.db = db
        self.active_call: Optional[IncomingCall] = None
    
    async def register_incoming_call(
        self,
        phone_number: str,
        contact_name: Optional[str] = None
    ) -> IncomingCall:
        """Register a new incoming call."""
        call = IncomingCall(
            phone_number=phone_number,
            contact_name=contact_name,
            status="ringing"
        )
        
        self.active_call = call
        await self.db.incoming_calls.insert_one(call.dict())
        
        logger.info(f"Incoming call registered: {phone_number}")
        return call
    
    async def answer_call(self, call_id: str, ai_answer: bool = False) -> Optional[IncomingCall]:
        """Answer an incoming call."""
        call = await self.db.incoming_calls.find_one({"id": call_id})
        if not call:
            return None
        
        now = datetime.now(timezone.utc).isoformat()
        update = {
            "status": "answered",
            "answered_at": now,
            "ai_answered": ai_answer
        }
        
        await self.db.incoming_calls.update_one({"id": call_id}, {"$set": update})
        
        if self.active_call and self.active_call.id == call_id:
            self.active_call.status = "answered"
            self.active_call.answered_at = now
            self.active_call.ai_answered = ai_answer
        
        logger.info(f"Call answered: {call_id}, AI: {ai_answer}")
        return await self.get_call(call_id)
    
    async def end_call(self, call_id: str, summary: Optional[str] = None) -> Optional[IncomingCall]:
        """End a call."""
        call = await self.db.incoming_calls.find_one({"id": call_id})
        if not call:
            return None
        
        now = datetime.now(timezone.utc)
        started = datetime.fromisoformat(call["started_at"].replace("Z", "+00:00"))
        duration = int((now - started).total_seconds())
        
        update = {
            "status": "ended",
            "ended_at": now.isoformat(),
            "duration_seconds": duration
        }
        
        if summary:
            update["ai_summary"] = summary
        
        await self.db.incoming_calls.update_one({"id": call_id}, {"$set": update})
        
        if self.active_call and self.active_call.id == call_id:
            self.active_call = None
        
        logger.info(f"Call ended: {call_id}, duration: {duration}s")
        return await self.get_call(call_id)
    
    async def mark_call_missed(self, call_id: str) -> Optional[IncomingCall]:
        """Mark a call as missed and create a reminder."""
        call = await self.db.incoming_calls.find_one({"id": call_id})
        if not call:
            return None
        
        now = datetime.now(timezone.utc).isoformat()
        
        # Update call status
        await self.db.incoming_calls.update_one(
            {"id": call_id},
            {"$set": {
                "status": "missed",
                "call_type": "missed",
                "ended_at": now,
                "reminder_created": True
            }}
        )
        
        # Create missed call reminder
        reminder = MissedCallReminder(
            call_id=call_id,
            phone_number=call["phone_number"],
            contact_name=call.get("contact_name"),
            missed_at=now
        )
        await self.db.missed_call_reminders.insert_one(reminder.dict())
        
        if self.active_call and self.active_call.id == call_id:
            self.active_call = None
        
        logger.info(f"Call marked as missed: {call_id}")
        return await self.get_call(call_id)
    
    async def get_call(self, call_id: str) -> Optional[Dict[str, Any]]:
        """Get a call by ID."""
        return await self.db.incoming_calls.find_one({"id": call_id}, {"_id": 0})
    
    async def get_active_call(self) -> Optional[Dict[str, Any]]:
        """Get the currently active/ringing call."""
        return await self.db.incoming_calls.find_one(
            {"status": {"$in": ["ringing", "answered"]}},
            {"_id": 0}
        )
    
    async def list_calls(
        self,
        call_type: Optional[str] = None,
        limit: int = 50,
        skip: int = 0
    ) -> List[Dict[str, Any]]:
        """List calls with optional filtering."""
        query = {}
        if call_type:
            query["call_type"] = call_type
        
        cursor = self.db.incoming_calls.find(query, {"_id": 0}).sort("started_at", -1).skip(skip).limit(limit)
        return await cursor.to_list(limit)
    
    async def get_missed_calls(self, status: str = "pending") -> List[Dict[str, Any]]:
        """Get missed call reminders."""
        cursor = self.db.missed_call_reminders.find(
            {"status": status},
            {"_id": 0}
        ).sort("missed_at", -1)
        return await cursor.to_list(100)
    
    async def get_pending_reminders(self) -> List[Dict[str, Any]]:
        """Get all pending missed call reminders for briefing."""
        return await self.get_missed_calls("pending")
    
    async def mark_reminder_sent(self, reminder_id: str) -> bool:
        """Mark a reminder as sent."""
        result = await self.db.missed_call_reminders.update_one(
            {"id": reminder_id},
            {"$set": {
                "reminder_count": {"$inc": 1},
                "last_reminded_at": datetime.now(timezone.utc).isoformat(),
                "reminder_sent": True
            }}
        )
        return result.modified_count > 0
    
    async def dismiss_reminder(self, reminder_id: str) -> bool:
        """Dismiss a missed call reminder."""
        result = await self.db.missed_call_reminders.update_one(
            {"id": reminder_id},
            {"$set": {"status": "dismissed"}}
        )
        return result.modified_count > 0
    
    async def mark_called_back(self, reminder_id: str) -> bool:
        """Mark that the user called back."""
        result = await self.db.missed_call_reminders.update_one(
            {"id": reminder_id},
            {"$set": {"status": "called_back"}}
        )
        return result.modified_count > 0
    
    async def add_call_transcript(
        self,
        call_id: str,
        role: str,
        text: str
    ) -> bool:
        """Add a transcript entry to a call."""
        entry = {"role": role, "text": text, "timestamp": datetime.now(timezone.utc).isoformat()}
        result = await self.db.incoming_calls.update_one(
            {"id": call_id},
            {"$push": {"ai_transcript": entry}}
        )
        return result.modified_count > 0
    
    async def get_call_stats(self) -> Dict[str, Any]:
        """Get call statistics."""
        total = await self.db.incoming_calls.count_documents({})
        missed = await self.db.incoming_calls.count_documents({"call_type": "missed"})
        answered = await self.db.incoming_calls.count_documents({"status": "answered"})
        ai_answered = await self.db.incoming_calls.count_documents({"ai_answered": True})
        pending_reminders = await self.db.missed_call_reminders.count_documents({"status": "pending"})
        
        return {
            "total_calls": total,
            "missed_calls": missed,
            "answered_calls": answered,
            "ai_answered_calls": ai_answered,
            "pending_reminders": pending_reminders
        }


# ==================== AI CALL HANDLER ====================

class AICallHandler:
    """Handles AI-powered call answering with ElevenLabs voice."""
    
    def __init__(self, call_manager: CallManager, elevenlabs_voice, bedrock_client):
        self.call_manager = call_manager
        self.voice = elevenlabs_voice
        self.bedrock = bedrock_client
    
    async def generate_greeting(self, contact_name: Optional[str] = None) -> str:
        """Generate a greeting for answering a call."""
        if contact_name:
            return f"Hello! This is Nova, {contact_name}'s AI assistant. They're currently unavailable. How can I help you?"
        return "Hello! This is Nova, an AI assistant. The person you're calling is currently unavailable. How can I help you?"
    
    async def process_caller_speech(self, call_id: str, caller_text: str) -> str:
        """Process what the caller said and generate a response."""
        # Add to transcript
        await self.call_manager.add_call_transcript(call_id, "caller", caller_text)
        
        # Generate AI response (simplified - in production, use full conversation context)
        prompt = f"""You are Nova, an AI assistant answering a phone call on behalf of your user.
The caller said: "{caller_text}"

Respond naturally and helpfully. If they want to leave a message, acknowledge it.
If they have a question, try to help or offer to pass the message along.
Keep responses concise (1-2 sentences) as this is a phone call."""
        
        # In production, call Bedrock here
        response = "I understand. I'll make sure to pass along your message. Is there anything else you'd like me to note?"
        
        # Add AI response to transcript
        await self.call_manager.add_call_transcript(call_id, "ai", response)
        
        return response
    
    async def generate_voice_response(self, text: str) -> Optional[bytes]:
        """Generate voice audio for a response."""
        if self.voice and self.voice.enabled:
            return await self.voice.text_to_speech(text)
        return None
    
    async def summarize_call(self, call_id: str) -> str:
        """Generate a summary of the call."""
        call = await self.call_manager.get_call(call_id)
        if not call or not call.get("ai_transcript"):
            return "No conversation recorded."
        
        transcript = call["ai_transcript"]
        lines = [f"{t['role'].title()}: {t['text']}" for t in transcript]
        
        # In production, use Bedrock to summarize
        summary = f"Call summary: Received {len(transcript)} messages. "
        if any("message" in t.get("text", "").lower() for t in transcript):
            summary += "Caller wanted to leave a message."
        
        # Update call with summary
        await self.call_manager.db.incoming_calls.update_one(
            {"id": call_id},
            {"$set": {"ai_summary": summary}}
        )
        
        return summary


# ==================== COMMAND PARSER ====================

def parse_call_command(user_message: str) -> Optional[Dict[str, Any]]:
    """
    Parse user commands related to calls.
    Returns command info if detected, None otherwise.
    """
    message_lower = user_message.lower().strip()
    
    # "Lift the call" / "Answer the call" / "Pick up"
    answer_patterns = [
        "lift the call", "lift call", "answer the call", "answer call",
        "pick up", "pick up the call", "take the call", "accept call",
        "answer it", "pick it up"
    ]
    for pattern in answer_patterns:
        if pattern in message_lower:
            return {"action": "answer_call", "ai_mode": True}
    
    # "Answer normally" (user wants to answer themselves)
    if "answer normally" in message_lower or "i'll answer" in message_lower:
        return {"action": "answer_call", "ai_mode": False}
    
    # "Reject the call" / "Decline"
    reject_patterns = ["reject", "decline", "ignore", "don't answer", "hang up"]
    for pattern in reject_patterns:
        if pattern in message_lower:
            return {"action": "reject_call"}
    
    # "Check missed calls" / "Any missed calls"
    missed_patterns = ["missed call", "missed calls", "who called", "any calls"]
    for pattern in missed_patterns:
        if pattern in message_lower:
            return {"action": "check_missed_calls"}
    
    # "Call back" + number/contact
    if "call back" in message_lower or "return call" in message_lower:
        return {"action": "call_back"}
    
    return None
