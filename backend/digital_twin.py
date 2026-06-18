"""
Personal Digital Twin for Nova AI Assistant
Learns user's writing style, speaking patterns, decision making, and preferences.
Enables AI to respond "as the user would" without explicit prompting.
"""
import re
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional, Tuple
from collections import defaultdict, Counter

logger = logging.getLogger(__name__)

# ==================== USER PROFILE SCHEMA ====================

DEFAULT_PROFILE = {
    "id": "user_profile",
    
    # Communication Style
    "writing_style": {
        "formality": 0.5,  # 0 = casual, 1 = formal
        "verbosity": 0.5,  # 0 = brief, 1 = detailed
        "emoji_usage": 0.3,  # 0 = never, 1 = frequent
        "common_greetings": [],
        "common_closings": [],
        "favorite_phrases": [],
        "avg_message_length": 50,
    },
    
    # Speaking Patterns (from voice transcriptions)
    "speaking_style": {
        "pace": "normal",  # slow, normal, fast
        "filler_words": [],  # um, uh, like, you know
        "common_expressions": [],
    },
    
    # Decision Patterns
    "decision_patterns": {
        "risk_tolerance": 0.5,  # 0 = conservative, 1 = risk-taker
        "decision_speed": 0.5,  # 0 = deliberate, 1 = quick
        "factors_considered": [],  # price, quality, convenience, etc.
    },
    
    # Priorities & Values
    "priorities": {
        "work_life_balance": 0.5,
        "family_focus": 0.5,
        "career_growth": 0.5,
        "health_fitness": 0.5,
        "financial_security": 0.5,
        "learning": 0.5,
    },
    
    # Frequent Contacts
    "frequent_contacts": [],  # [{name, relationship, last_contact, interaction_count}]
    
    # Work Habits
    "work_habits": {
        "peak_hours": [],  # [9, 10, 11, 14, 15, 16]
        "break_patterns": [],
        "preferred_meeting_times": [],
        "focus_duration": 45,  # minutes
    },
    
    # Response Templates (learned from user)
    "response_templates": {
        # "reply_to_meeting_invite": "Thanks for the invite! Let me check my calendar and get back to you.",
    },
    
    # Metadata
    "created_at": None,
    "updated_at": None,
    "learning_data_points": 0,
}


# ==================== STYLE ANALYZER ====================

class StyleAnalyzer:
    """Analyzes user's communication style from messages."""
    
    @staticmethod
    def analyze_formality(text: str) -> float:
        """Analyze formality level of text (0-1)."""
        formal_indicators = [
            r"\b(please|kindly|would you|could you|regards|sincerely|dear)\b",
            r"\b(furthermore|however|therefore|consequently|nevertheless)\b",
            r"\b(i would|i shall|one might|it appears)\b",
        ]
        
        informal_indicators = [
            r"\b(hey|hi|yo|sup|gonna|wanna|kinda|gotta)\b",
            r"\b(lol|haha|lmao|omg|btw|tbh|ngl)\b",
            r"!{2,}",  # Multiple exclamation marks
            r"\.{3,}",  # Ellipsis
        ]
        
        formal_count = sum(len(re.findall(p, text, re.IGNORECASE)) for p in formal_indicators)
        informal_count = sum(len(re.findall(p, text, re.IGNORECASE)) for p in informal_indicators)
        
        total = formal_count + informal_count
        if total == 0:
            return 0.5
        
        return formal_count / total
    
    @staticmethod
    def analyze_verbosity(text: str) -> float:
        """Analyze verbosity level (0-1)."""
        word_count = len(text.split())
        sentence_count = len(re.split(r'[.!?]+', text))
        
        avg_sentence_length = word_count / max(sentence_count, 1)
        
        # Map to 0-1 scale (5 words = 0.2, 20 words = 0.8)
        return min(1.0, max(0.0, (avg_sentence_length - 5) / 20))
    
    @staticmethod
    def analyze_emoji_usage(text: str) -> float:
        """Analyze emoji frequency (0-1)."""
        # Count emojis
        emoji_pattern = re.compile("["
            u"\U0001F600-\U0001F64F"  # emoticons
            u"\U0001F300-\U0001F5FF"  # symbols & pictographs
            u"\U0001F680-\U0001F6FF"  # transport & map
            u"\U0001F1E0-\U0001F1FF"  # flags
            "]+", flags=re.UNICODE)
        
        emojis = emoji_pattern.findall(text)
        word_count = len(text.split())
        
        if word_count == 0:
            return 0.0
        
        emoji_ratio = len(emojis) / word_count
        return min(1.0, emoji_ratio * 10)  # Scale up since emojis are sparse
    
    @staticmethod
    def extract_greetings(text: str) -> List[str]:
        """Extract greeting patterns."""
        greetings = []
        patterns = [
            r"^(hi|hey|hello|good morning|good afternoon|good evening|dear \w+)[,!]?",
            r"^(hope this|hope you|trust you)",
        ]
        
        for pattern in patterns:
            match = re.match(pattern, text.strip(), re.IGNORECASE)
            if match:
                greetings.append(match.group(0).strip())
        
        return greetings
    
    @staticmethod
    def extract_closings(text: str) -> List[str]:
        """Extract closing patterns."""
        closings = []
        patterns = [
            r"(thanks|thank you|cheers|regards|best|sincerely|take care)[,!]?\s*$",
            r"(let me know|looking forward|talk soon)[.!]?\s*$",
        ]
        
        for pattern in patterns:
            match = re.search(pattern, text.strip(), re.IGNORECASE)
            if match:
                closings.append(match.group(0).strip())
        
        return closings
    
    @staticmethod
    def extract_phrases(text: str) -> List[str]:
        """Extract distinctive phrases."""
        # Common filler phrases that indicate personal style
        phrase_patterns = [
            r"\b(actually|basically|honestly|literally|definitely|absolutely)\b",
            r"\b(i think|i believe|i feel|in my opinion|to be honest)\b",
            r"\b(you know|i mean|like i said|as i mentioned)\b",
        ]
        
        phrases = []
        for pattern in phrase_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            phrases.extend(matches)
        
        return phrases


# ==================== DIGITAL TWIN ====================

class PersonalDigitalTwin:
    """Learns and mimics user's communication style and patterns."""
    
    def __init__(self, db):
        self.db = db
        self.analyzer = StyleAnalyzer()
    
    async def get_profile(self) -> Dict[str, Any]:
        """Get or create user profile."""
        profile = await self.db.user_profile.find_one({"id": "user_profile"})
        
        if not profile:
            profile = DEFAULT_PROFILE.copy()
            profile["created_at"] = datetime.now(timezone.utc).isoformat()
            profile["updated_at"] = profile["created_at"]
            await self.db.user_profile.insert_one(profile)
        else:
            # Remove MongoDB _id field
            if "_id" in profile:
                del profile["_id"]
        
        return profile
    
    async def learn_from_message(self, message: str, context: str = "chat") -> Dict[str, Any]:
        """Learn from a user message to update the digital twin."""
        if len(message.strip()) < 5:
            return {"learned": False, "reason": "Message too short"}
        
        profile = await self.get_profile()
        
        # Analyze the message
        formality = self.analyzer.analyze_formality(message)
        verbosity = self.analyzer.analyze_verbosity(message)
        emoji_usage = self.analyzer.analyze_emoji_usage(message)
        greetings = self.analyzer.extract_greetings(message)
        closings = self.analyzer.extract_closings(message)
        phrases = self.analyzer.extract_phrases(message)
        
        # Update profile with exponential moving average
        alpha = 0.1  # Learning rate
        
        profile["writing_style"]["formality"] = (
            (1 - alpha) * profile["writing_style"]["formality"] + alpha * formality
        )
        profile["writing_style"]["verbosity"] = (
            (1 - alpha) * profile["writing_style"]["verbosity"] + alpha * verbosity
        )
        profile["writing_style"]["emoji_usage"] = (
            (1 - alpha) * profile["writing_style"]["emoji_usage"] + alpha * emoji_usage
        )
        
        # Update message length average
        msg_len = len(message.split())
        old_avg = profile["writing_style"]["avg_message_length"]
        profile["writing_style"]["avg_message_length"] = (
            (1 - alpha) * old_avg + alpha * msg_len
        )
        
        # Add greetings/closings/phrases (dedupe)
        for g in greetings:
            if g.lower() not in [x.lower() for x in profile["writing_style"]["common_greetings"]]:
                profile["writing_style"]["common_greetings"].append(g)
                profile["writing_style"]["common_greetings"] = profile["writing_style"]["common_greetings"][-10:]
        
        for c in closings:
            if c.lower() not in [x.lower() for x in profile["writing_style"]["common_closings"]]:
                profile["writing_style"]["common_closings"].append(c)
                profile["writing_style"]["common_closings"] = profile["writing_style"]["common_closings"][-10:]
        
        for p in phrases:
            if p.lower() not in [x.lower() for x in profile["writing_style"]["favorite_phrases"]]:
                profile["writing_style"]["favorite_phrases"].append(p)
                profile["writing_style"]["favorite_phrases"] = profile["writing_style"]["favorite_phrases"][-20:]
        
        # Update metadata
        profile["learning_data_points"] = profile.get("learning_data_points", 0) + 1
        profile["updated_at"] = datetime.now(timezone.utc).isoformat()
        
        # Save to database
        await self.db.user_profile.update_one(
            {"id": "user_profile"},
            {"$set": profile},
            upsert=True
        )
        
        return {
            "learned": True,
            "updates": {
                "formality": round(profile["writing_style"]["formality"], 2),
                "verbosity": round(profile["writing_style"]["verbosity"], 2),
                "emoji_usage": round(profile["writing_style"]["emoji_usage"], 2),
            }
        }
    
    async def learn_contact_interaction(self, contact_name: str, relationship: str = "unknown") -> None:
        """Track interaction with a contact."""
        profile = await self.get_profile()
        
        contacts = profile.get("frequent_contacts", [])
        
        # Find existing contact
        existing = None
        for i, c in enumerate(contacts):
            if c["name"].lower() == contact_name.lower():
                existing = i
                break
        
        now = datetime.now(timezone.utc).isoformat()
        
        if existing is not None:
            contacts[existing]["last_contact"] = now
            contacts[existing]["interaction_count"] = contacts[existing].get("interaction_count", 0) + 1
            if relationship != "unknown":
                contacts[existing]["relationship"] = relationship
        else:
            contacts.append({
                "name": contact_name,
                "relationship": relationship,
                "last_contact": now,
                "interaction_count": 1
            })
        
        # Keep top 50 contacts by interaction count
        contacts.sort(key=lambda x: x.get("interaction_count", 0), reverse=True)
        profile["frequent_contacts"] = contacts[:50]
        profile["updated_at"] = now
        
        await self.db.user_profile.update_one(
            {"id": "user_profile"},
            {"$set": {"frequent_contacts": profile["frequent_contacts"], "updated_at": now}}
        )
    
    async def learn_work_habits(self, activity_time: datetime) -> None:
        """Track work activity patterns."""
        profile = await self.get_profile()
        
        hour = activity_time.hour
        
        peak_hours = profile["work_habits"].get("peak_hours", [])
        peak_hours.append(hour)
        
        # Count frequency and keep top hours
        hour_counts = Counter(peak_hours)
        profile["work_habits"]["peak_hours"] = [h for h, _ in hour_counts.most_common(6)]
        profile["updated_at"] = datetime.now(timezone.utc).isoformat()
        
        await self.db.user_profile.update_one(
            {"id": "user_profile"},
            {"$set": {
                "work_habits.peak_hours": profile["work_habits"]["peak_hours"],
                "updated_at": profile["updated_at"]
            }}
        )
    
    async def learn_response_template(self, context: str, response: str) -> None:
        """Learn a response template for a specific context."""
        profile = await self.get_profile()
        
        templates = profile.get("response_templates", {})
        templates[context] = response
        
        # Keep only 50 templates
        if len(templates) > 50:
            # Remove oldest (assuming dict maintains insertion order in Python 3.7+)
            keys = list(templates.keys())
            for key in keys[:-50]:
                del templates[key]
        
        profile["response_templates"] = templates
        profile["updated_at"] = datetime.now(timezone.utc).isoformat()
        
        await self.db.user_profile.update_one(
            {"id": "user_profile"},
            {"$set": {"response_templates": templates, "updated_at": profile["updated_at"]}}
        )
    
    async def get_style_prompt(self) -> str:
        """Generate a prompt describing the user's communication style."""
        profile = await self.get_profile()
        
        ws = profile["writing_style"]
        
        # Describe formality
        if ws["formality"] < 0.3:
            formality_desc = "casual and relaxed"
        elif ws["formality"] > 0.7:
            formality_desc = "formal and professional"
        else:
            formality_desc = "moderately formal"
        
        # Describe verbosity
        if ws["verbosity"] < 0.3:
            verbosity_desc = "brief and concise"
        elif ws["verbosity"] > 0.7:
            verbosity_desc = "detailed and thorough"
        else:
            verbosity_desc = "balanced in length"
        
        # Describe emoji usage
        if ws["emoji_usage"] < 0.2:
            emoji_desc = "rarely uses emojis"
        elif ws["emoji_usage"] > 0.5:
            emoji_desc = "frequently uses emojis"
        else:
            emoji_desc = "occasionally uses emojis"
        
        prompt_parts = [
            f"The user's communication style is {formality_desc}, {verbosity_desc}, and {emoji_desc}.",
            f"Average message length: {int(ws['avg_message_length'])} words.",
        ]
        
        if ws["common_greetings"]:
            prompt_parts.append(f"Common greetings: {', '.join(ws['common_greetings'][:3])}")
        
        if ws["common_closings"]:
            prompt_parts.append(f"Common closings: {', '.join(ws['common_closings'][:3])}")
        
        if ws["favorite_phrases"]:
            prompt_parts.append(f"Favorite phrases: {', '.join(ws['favorite_phrases'][:5])}")
        
        # Add contact info
        contacts = profile.get("frequent_contacts", [])[:5]
        if contacts:
            contact_list = [f"{c['name']} ({c.get('relationship', 'contact')})" for c in contacts]
            prompt_parts.append(f"Frequent contacts: {', '.join(contact_list)}")
        
        return " ".join(prompt_parts)
    
    async def generate_reply_suggestion(self, to_contact: str, context: str) -> Optional[str]:
        """Generate a reply suggestion in the user's style."""
        profile = await self.get_profile()
        
        # Check if we have a template for this context
        templates = profile.get("response_templates", {})
        
        # Look for matching template
        for key, template in templates.items():
            if context.lower() in key.lower() or key.lower() in context.lower():
                return template
        
        # Find contact relationship
        relationship = "contact"
        for c in profile.get("frequent_contacts", []):
            if c["name"].lower() == to_contact.lower():
                relationship = c.get("relationship", "contact")
                break
        
        # Return a style guide for AI to use
        return None  # Let AI generate based on style prompt
    
    async def update_priorities(self, updates: Dict[str, float]) -> None:
        """Update user's priorities."""
        profile = await self.get_profile()
        
        for key, value in updates.items():
            if key in profile["priorities"]:
                profile["priorities"][key] = max(0.0, min(1.0, value))
        
        profile["updated_at"] = datetime.now(timezone.utc).isoformat()
        
        await self.db.user_profile.update_one(
            {"id": "user_profile"},
            {"$set": {"priorities": profile["priorities"], "updated_at": profile["updated_at"]}}
        )
