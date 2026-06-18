from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, BackgroundTasks
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import re
import logging
import tempfile
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timezone
import httpx

from emergentintegrations.llm.openai.speech_to_text import OpenAISpeechToText

import google_helper as gh
import tools as tool_framework
import knowledge_vault as kv
import phone_calls as pc
import dashboard as dash
from fastapi.responses import HTMLResponse, RedirectResponse

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Logger first so background tasks can log safely
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Mongo
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Bedrock
AWS_BEARER_TOKEN_BEDROCK = os.environ['AWS_BEARER_TOKEN_BEDROCK']
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
BEDROCK_MODEL_ID = os.environ.get('BEDROCK_MODEL_ID', 'amazon.nova-lite-v1:0')
BEDROCK_URL = f"https://bedrock-runtime.{AWS_REGION}.amazonaws.com/model/{BEDROCK_MODEL_ID}/converse"

EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']

BASE_SYSTEM_PROMPT = (
    "You are Nova — a warm, articulate, and helpful personal AI assistant. "
    "Speak naturally and concisely; keep replies friendly and easy to read aloud. "
    "Use plain prose; avoid heavy markdown unless asked.\n\n"
    "EMOTIONAL ATTUNEMENT: Read the user's tone from their wording. Adapt your reply:\n"
    "  • frustrated → briefly acknowledge their frustration before solving (e.g. 'That's annoying — let's fix it.')\n"
    "  • urgent → drop pleasantries, lead with the action.\n"
    "  • excited → match their energy with a touch more warmth.\n"
    "  • sad → be gentle and unhurried, don't rush past the feeling.\n"
    "  • neutral → your default warm, concise voice.\n"
    "Never label the emotion out loud — just adapt naturally."
)

MEMORY_CATEGORIES = ["person", "project", "goal", "skill", "meeting", "date", "preference", "other"]

app = FastAPI()
api_router = APIRouter(prefix="/api")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ------------------- Models -------------------
class ChatMessage(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    session_id: str
    role: str
    content: str
    image_b64: Optional[str] = None
    emotion: Optional[str] = None  # neutral | frustrated | urgent | excited | sad
    whatsapp_link: Optional[str] = None  # set on assistant message when a WhatsApp deep-link is generated
    created_at: str = Field(default_factory=utc_now_iso)


class ChatSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str = "New Chat"
    pinned: bool = False
    created_at: str = Field(default_factory=utc_now_iso)
    updated_at: str = Field(default_factory=utc_now_iso)


class CreateSessionRequest(BaseModel):
    title: Optional[str] = None


class ChatRequest(BaseModel):
    session_id: str
    message: str
    image_b64: Optional[str] = None
    image_mime: Optional[str] = None  # "image/jpeg" or "image/png"


class ChatResponse(BaseModel):
    session_id: str
    user_message: ChatMessage
    assistant_message: ChatMessage


class Memory(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    category: str = "other"
    subject: str
    content: str
    importance: int = 3  # 1-5
    source_session_id: Optional[str] = None
    created_at: str = Field(default_factory=utc_now_iso)


class MemoryCreate(BaseModel):
    category: Optional[str] = "other"
    subject: str
    content: str
    importance: Optional[int] = 3


class Goal(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    description: str = ""
    target: str = ""
    progress: int = 0  # 0-100
    status: str = "active"  # active | paused | completed
    created_at: str = Field(default_factory=utc_now_iso)
    updated_at: str = Field(default_factory=utc_now_iso)


class GoalCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    target: Optional[str] = ""


class GoalUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    target: Optional[str] = None
    progress: Optional[int] = None
    status: Optional[str] = None


class Reminder(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    text: str
    condition: str = ""  # free-form condition, e.g. "after certification approval arrives"
    status: str = "pending"  # pending | done | dismissed
    created_at: str = Field(default_factory=utc_now_iso)
    updated_at: str = Field(default_factory=utc_now_iso)


class ReminderCreate(BaseModel):
    text: str
    condition: Optional[str] = ""


class ReminderUpdate(BaseModel):
    text: Optional[str] = None
    condition: Optional[str] = None
    status: Optional[str] = None


# ------------------- Bedrock helpers -------------------
async def _bedrock_converse(messages: List[dict], system_text: str, max_tokens: int = 800, temperature: float = 0.6) -> str:
    """Generic Bedrock Converse call. messages is a list of {role, content:[{text}|{image}]}."""
    payload = {
        "messages": messages,
        "system": [{"text": system_text}],
        "inferenceConfig": {"maxTokens": max_tokens, "temperature": temperature, "topP": 0.9},
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {AWS_BEARER_TOKEN_BEDROCK}",
    }
    async with httpx.AsyncClient(timeout=60.0) as http:
        r = await http.post(BEDROCK_URL, json=payload, headers=headers)
        if r.status_code != 200:
            logger.error("Bedrock error %s: %s", r.status_code, r.text)
            raise HTTPException(status_code=502, detail=f"Bedrock error: {r.text[:300]}")
        data = r.json()
    try:
        parts = data["output"]["message"]["content"]
        return "".join(p.get("text", "") for p in parts).strip()
    except Exception as e:
        logger.exception("Bedrock parse failed: %s", data)
        raise HTTPException(status_code=502, detail=f"Bedrock parse error: {e}")


def _msg_block(role: str, text: str, image_b64: Optional[str] = None, image_mime: Optional[str] = None) -> dict:
    content: List[dict] = []
    if image_b64:
        fmt = "png"
        if image_mime:
            m = image_mime.lower()
            if "jpeg" in m or "jpg" in m:
                fmt = "jpeg"
            elif "png" in m:
                fmt = "png"
            elif "gif" in m:
                fmt = "gif"
            elif "webp" in m:
                fmt = "webp"
        content.append({"image": {"format": fmt, "source": {"bytes": image_b64}}})
    if text:
        content.append({"text": text})
    if not content:
        content.append({"text": ""})
    return {"role": role, "content": content}


async def _build_system_prompt() -> str:
    """Inject persistent memories + active goals + pending reminders into Nova's system prompt."""
    memories = await db.memories.find({}, {"_id": 0}).sort("created_at", -1).to_list(50)
    goals = await db.goals.find({"status": "active"}, {"_id": 0}).sort("updated_at", -1).to_list(20)
    reminders = await db.reminders.find({"status": "pending"}, {"_id": 0}).sort("created_at", -1).to_list(20)

    sections = [BASE_SYSTEM_PROMPT]
    if memories:
        lines = [f"- [{m.get('category','other')}] {m.get('subject','')}: {m.get('content','')}" for m in memories]
        sections.append("Things you have remembered about the user:\n" + "\n".join(lines))
    if goals:
        glines = [f"- {g['title']} ({g.get('progress',0)}% done) — target: {g.get('target','')}" for g in goals]
        sections.append("Active goals the user is working on:\n" + "\n".join(glines))
    if reminders:
        rlines = [f"- {r['text']}" + (f" (when: {r['condition']})" if r.get('condition') else "") for r in reminders]
        sections.append("Pending reminders to surface naturally if relevant:\n" + "\n".join(rlines))

    sections.append(
        "When the user shares personal facts (family, projects, dates, goals, preferences), naturally "
        "acknowledge them — they will be saved automatically. Refer back to past facts when relevant."
    )
    return "\n\n".join(sections)


# ------------------- Memory extraction -------------------
EMOTION_INSTRUCTIONS = (
    "Classify the emotional tone of the user message. Reply with ONLY one word from this set: "
    "neutral, frustrated, urgent, excited, sad. No explanation, no punctuation."
)


async def _classify_emotion(user_text: str) -> str:
    if not user_text.strip():
        return "neutral"
    try:
        out = await _bedrock_converse(
            messages=[{"role": "user", "content": [{"text": user_text[:1500]}]}],
            system_text=EMOTION_INSTRUCTIONS,
            max_tokens=10,
            temperature=0.0,
        )
        label = (out or "").strip().lower().strip(".,!?\"'")
        if label not in {"neutral", "frustrated", "urgent", "excited", "sad"}:
            return "neutral"
        return label
    except Exception:
        return "neutral"


EXTRACTION_INSTRUCTIONS = (
    "You are an extraction engine. Read the latest USER message and assistant reply, and decide if it "
    "contains durable personal facts worth remembering long-term about the user (people in their life, "
    "ongoing projects, goals, skills they're learning, important dates, meetings, strong preferences). "
    "Return ONLY a JSON array (no prose) of objects with keys: category (one of "
    "person|project|goal|skill|meeting|date|preference|other), subject (short noun), content (1 sentence), "
    "importance (1-5). If nothing is worth remembering, return []. Do NOT include ephemeral chit-chat, "
    "questions the user asked, or generic facts."
)


def _safe_json_array(text: str) -> List[dict]:
    if not text:
        return []
    # Extract first [...] block
    m = re.search(r"\[.*\]", text, re.DOTALL)
    if not m:
        return []
    try:
        data = json.loads(m.group(0))
        return [d for d in data if isinstance(d, dict)]
    except Exception:
        return []


async def _extract_and_store_memories(session_id: str, user_text: str, assistant_text: str) -> None:
    try:
        prompt = (
            f"USER MESSAGE:\n{user_text}\n\nASSISTANT REPLY:\n{assistant_text}\n\n"
            "Now produce the JSON array."
        )
        out = await _bedrock_converse(
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            system_text=EXTRACTION_INSTRUCTIONS,
            max_tokens=400,
            temperature=0.1,
        )
        items = _safe_json_array(out)
        for it in items:
            cat = (it.get("category") or "other").lower()
            if cat not in MEMORY_CATEGORIES:
                cat = "other"
            subj = (it.get("subject") or "").strip()[:80]
            content = (it.get("content") or "").strip()[:400]
            if not subj or not content:
                continue
            try:
                importance = int(it.get("importance", 3))
            except Exception:
                importance = 3
            importance = max(1, min(5, importance))

            # Deduplicate: same category+subject — update content instead
            existing = await db.memories.find_one({"category": cat, "subject": subj}, {"_id": 0})
            if existing:
                await db.memories.update_one(
                    {"id": existing["id"]},
                    {"$set": {"content": content, "importance": importance, "created_at": utc_now_iso(), "source_session_id": session_id}},
                )
            else:
                mem = Memory(
                    category=cat,
                    subject=subj,
                    content=content,
                    importance=importance,
                    source_session_id=session_id,
                )
                await db.memories.insert_one(mem.dict())
        if items:
            logger.info("Stored %d memories from session %s", len(items), session_id)
    except Exception as e:
        logger.warning("Memory extraction failed: %s", e)


# ------------------- Routes -------------------
@api_router.get("/")
async def root():
    return {"message": "Nova AI Assistant API", "model": BEDROCK_MODEL_ID}


# ----- Sessions -----
@api_router.post("/sessions", response_model=ChatSession)
async def create_session(body: CreateSessionRequest):
    session = ChatSession(title=body.title or "New Chat")
    await db.chat_sessions.insert_one(session.dict())
    return session


@api_router.get("/sessions", response_model=List[ChatSession])
async def list_sessions(search: Optional[str] = None):
    query: dict = {}
    if search and search.strip():
        query["title"] = {"$regex": re.escape(search.strip()), "$options": "i"}
    rows = await db.chat_sessions.find(query, {"_id": 0}).to_list(1000)
    # Sort: pinned first, then updated_at desc
    rows.sort(key=lambda r: (not r.get("pinned", False), r.get("updated_at", "")), reverse=False)
    rows.sort(key=lambda r: (r.get("pinned", False), r.get("updated_at", "")), reverse=True)
    return [ChatSession(**r) for r in rows]


@api_router.get("/sessions/{session_id}/messages", response_model=List[ChatMessage])
async def get_messages(session_id: str):
    rows = await db.chat_messages.find({"session_id": session_id}, {"_id": 0}).sort("created_at", 1).to_list(2000)
    return [ChatMessage(**r) for r in rows]


@api_router.post("/sessions/{session_id}/pin", response_model=ChatSession)
async def toggle_pin(session_id: str):
    sess = await db.chat_sessions.find_one({"id": session_id}, {"_id": 0})
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    new_val = not bool(sess.get("pinned", False))
    await db.chat_sessions.update_one({"id": session_id}, {"$set": {"pinned": new_val, "updated_at": utc_now_iso()}})
    sess["pinned"] = new_val
    sess["updated_at"] = utc_now_iso()
    return ChatSession(**sess)


@api_router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    await db.chat_sessions.delete_one({"id": session_id})
    await db.chat_messages.delete_many({"session_id": session_id})
    return {"ok": True}


# ----- Chat -----
@api_router.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest, background: BackgroundTasks):
    if not body.message.strip() and not body.image_b64:
        raise HTTPException(status_code=400, detail="Empty message")

    sess = await db.chat_sessions.find_one({"id": body.session_id}, {"_id": 0})
    if not sess:
        new_sess = ChatSession(id=body.session_id, title=(body.message or "New Chat")[:40])
        await db.chat_sessions.insert_one(new_sess.dict())

    history_rows = await db.chat_messages.find(
        {"session_id": body.session_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(2000)

    bedrock_msgs: List[dict] = []
    for h in history_rows:
        bedrock_msgs.append(_msg_block(h["role"], h.get("content", ""), h.get("image_b64"), "image/jpeg"))
    # Current user message (with optional image)
    bedrock_msgs.append(_msg_block("user", body.message, body.image_b64, body.image_mime))

    system_text = await _build_system_prompt()
    # Run emotion classification and main reply in parallel
    import asyncio
    emotion_task = asyncio.create_task(_classify_emotion(body.message))
    reply = await _bedrock_converse(bedrock_msgs, system_text=system_text, max_tokens=900, temperature=0.6)
    emotion = await emotion_task

    # Try to execute any clear action the user just requested (calendar, email, reminder, whatsapp)
    action_note, whatsapp_link = await _extract_and_execute_action(body.message)
    if action_note:
        reply = (reply or "").rstrip() + action_note

    user_msg = ChatMessage(
        session_id=body.session_id,
        role="user",
        content=body.message,
        image_b64=body.image_b64,
        emotion=emotion,
    )
    ai_msg = ChatMessage(
        session_id=body.session_id,
        role="assistant",
        content=reply,
        whatsapp_link=whatsapp_link,
    )
    await db.chat_messages.insert_one(user_msg.dict())
    await db.chat_messages.insert_one(ai_msg.dict())

    update = {"updated_at": utc_now_iso()}
    if not history_rows:
        update["title"] = (body.message.strip()[:40] or "New Chat")
    await db.chat_sessions.update_one({"id": body.session_id}, {"$set": update})

    # Auto-extract memories in background (don't block response)
    background.add_task(_extract_and_store_memories, body.session_id, body.message, reply)

    return ChatResponse(session_id=body.session_id, user_message=user_msg, assistant_message=ai_msg)


# ----- Transcribe -----
@api_router.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    suffix = Path(file.filename or "audio.m4a").suffix.lower() or ".m4a"
    if suffix.lstrip('.') not in {"mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm"}:
        suffix = ".m4a"
    tmp_path = None
    try:
        contents = await file.read()
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name
        stt = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)
        with open(tmp_path, "rb") as audio_file:
            result = await stt.transcribe(file=audio_file, model="whisper-1", response_format="text")
        text = result if isinstance(result, str) else (getattr(result, "text", "") or str(result))
        return {"text": text.strip()}
    except Exception as e:
        logger.exception("Transcription failed")
        raise HTTPException(status_code=502, detail=f"Transcription failed: {e}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


# ----- Memories -----
@api_router.get("/memories", response_model=List[Memory])
async def list_memories(category: Optional[str] = None, search: Optional[str] = None):
    q: dict = {}
    if category:
        q["category"] = category
    if search and search.strip():
        s = re.escape(search.strip())
        q["$or"] = [
            {"subject": {"$regex": s, "$options": "i"}},
            {"content": {"$regex": s, "$options": "i"}},
        ]
    rows = await db.memories.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [Memory(**r) for r in rows]


@api_router.post("/memories", response_model=Memory)
async def create_memory(body: MemoryCreate):
    cat = (body.category or "other").lower()
    if cat not in MEMORY_CATEGORIES:
        cat = "other"
    mem = Memory(
        category=cat,
        subject=body.subject.strip()[:80],
        content=body.content.strip()[:400],
        importance=max(1, min(5, int(body.importance or 3))),
    )
    await db.memories.insert_one(mem.dict())
    return mem


@api_router.delete("/memories/{memory_id}")
async def delete_memory(memory_id: str):
    await db.memories.delete_one({"id": memory_id})
    return {"ok": True}


# ----- Goals -----
@api_router.get("/goals", response_model=List[Goal])
async def list_goals():
    rows = await db.goals.find({}, {"_id": 0}).sort("updated_at", -1).to_list(500)
    return [Goal(**r) for r in rows]


@api_router.post("/goals", response_model=Goal)
async def create_goal(body: GoalCreate):
    g = Goal(title=body.title.strip()[:120], description=(body.description or "")[:600], target=(body.target or "")[:200])
    await db.goals.insert_one(g.dict())
    return g


@api_router.put("/goals/{goal_id}", response_model=Goal)
async def update_goal(goal_id: str, body: GoalUpdate):
    existing = await db.goals.find_one({"id": goal_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Goal not found")
    patch: dict = {"updated_at": utc_now_iso()}
    if body.title is not None:
        patch["title"] = body.title.strip()[:120]
    if body.description is not None:
        patch["description"] = body.description[:600]
    if body.target is not None:
        patch["target"] = body.target[:200]
    if body.progress is not None:
        patch["progress"] = max(0, min(100, int(body.progress)))
        if patch["progress"] >= 100:
            patch["status"] = "completed"
    if body.status is not None and body.status in {"active", "paused", "completed"}:
        patch["status"] = body.status
    await db.goals.update_one({"id": goal_id}, {"$set": patch})
    merged = {**existing, **patch}
    return Goal(**merged)


@api_router.delete("/goals/{goal_id}")
async def delete_goal(goal_id: str):
    await db.goals.delete_one({"id": goal_id})
    return {"ok": True}


# ----- Reminders -----
@api_router.get("/reminders", response_model=List[Reminder])
async def list_reminders(status: Optional[str] = None):
    q: dict = {}
    if status:
        q["status"] = status
    rows = await db.reminders.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [Reminder(**r) for r in rows]


@api_router.post("/reminders", response_model=Reminder)
async def create_reminder(body: ReminderCreate):
    r = Reminder(text=body.text.strip()[:300], condition=(body.condition or "")[:300])
    await db.reminders.insert_one(r.dict())
    return r


@api_router.put("/reminders/{reminder_id}", response_model=Reminder)
async def update_reminder(reminder_id: str, body: ReminderUpdate):
    existing = await db.reminders.find_one({"id": reminder_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Reminder not found")
    patch: dict = {"updated_at": utc_now_iso()}
    if body.text is not None:
        patch["text"] = body.text[:300]
    if body.condition is not None:
        patch["condition"] = body.condition[:300]
    if body.status is not None and body.status in {"pending", "done", "dismissed"}:
        patch["status"] = body.status
    await db.reminders.update_one({"id": reminder_id}, {"$set": patch})
    merged = {**existing, **patch}
    return Reminder(**merged)


@api_router.delete("/reminders/{reminder_id}")
async def delete_reminder(reminder_id: str):
    await db.reminders.delete_one({"id": reminder_id})
    return {"ok": True}


# ----- Daily Briefing -----
WEATHER_CODES = {
    0: "Clear sky", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Fog", 51: "Drizzle", 53: "Drizzle", 55: "Drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow",
    80: "Showers", 81: "Showers", 82: "Heavy showers",
    95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm",
}


async def _fetch_weather(lat: float, lon: float) -> Optional[dict]:
    try:
        url = (
            f"https://api.open-meteo.com/v1/forecast"
            f"?latitude={lat}&longitude={lon}"
            "&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m"
            "&timezone=auto"
        )
        async with httpx.AsyncClient(timeout=10.0) as http:
            r = await http.get(url)
            if r.status_code != 200:
                return None
            data = r.json()
            cur = data.get("current", {})
            return {
                "temperature_c": cur.get("temperature_2m"),
                "humidity": cur.get("relative_humidity_2m"),
                "wind_kph": cur.get("wind_speed_10m"),
                "code": cur.get("weather_code"),
                "summary": WEATHER_CODES.get(int(cur.get("weather_code") or -1), "Unknown"),
                "timezone": data.get("timezone"),
            }
    except Exception as e:
        logger.warning("Weather fetch failed: %s", e)
        return None


def _greeting_for_now(tz_offset_minutes: int = 0) -> str:
    # Naive: just use UTC hour shifted by offset
    hour = (datetime.now(timezone.utc).hour + tz_offset_minutes // 60) % 24
    if 5 <= hour < 12:
        return "Good morning"
    if 12 <= hour < 17:
        return "Good afternoon"
    if 17 <= hour < 22:
        return "Good evening"
    return "Hello"


@api_router.get("/briefing")
async def briefing(lat: Optional[float] = None, lon: Optional[float] = None, tz_offset: int = 0):
    """Daily briefing aggregating weather, pending reminders, active goals, upcoming dates from memories."""
    # Try to resolve the user's name from memories (preference: name=...)
    name_doc = await db.memories.find_one(
        {"category": "preference", "subject": {"$regex": "name", "$options": "i"}},
        {"_id": 0},
    )
    name = None
    if name_doc:
        # content might be "User's name is Varun" — best-effort grab the last word
        m = re.search(r"(?:is|=|:)\s*([A-Z][A-Za-z'-]+)", name_doc.get("content", ""))
        if m:
            name = m.group(1)

    weather = None
    if lat is not None and lon is not None:
        weather = await _fetch_weather(lat, lon)

    pending = await db.reminders.find({"status": "pending"}, {"_id": 0}).sort("created_at", -1).to_list(10)
    active_goals = await db.goals.find({"status": "active"}, {"_id": 0}).sort("updated_at", -1).to_list(10)
    date_memories = await db.memories.find(
        {"category": {"$in": ["date", "meeting"]}}, {"_id": 0}
    ).sort("created_at", -1).to_list(10)
    session_count = await db.chat_sessions.count_documents({})

    google_connected = False
    upcoming_events: List[dict] = []
    recent_emails: List[dict] = []
    google_email: Optional[str] = None
    try:
        token = await gh.get_valid_token(db)
        if token:
            google_connected = True
            doc = await db.integrations.find_one({"id": "google"}, {"_id": 0})
            google_email = (doc or {}).get("email")
            try:
                upcoming_events = await gh.list_upcoming_events(token, max_results=5)
            except Exception as e:
                logger.warning("Calendar list failed: %s", e)
            try:
                recent_emails = await gh.list_recent_messages(token, max_results=5)
            except Exception as e:
                logger.warning("Gmail list failed: %s", e)
    except Exception as e:
        logger.warning("Google token check failed: %s", e)

    return {
        "greeting": _greeting_for_now(tz_offset),
        "name": name,
        "weather": weather,
        "pending_reminders": pending,
        "active_goals": active_goals,
        "important_dates": date_memories,
        "session_count": session_count,
        "upcoming_events": upcoming_events,
        "recent_emails": recent_emails,
        "integrations": {
            "google_calendar": {"connected": google_connected, "email": google_email},
            "gmail": {"connected": google_connected, "email": google_email},
            "outlook": {"connected": False},
        },
    }


ACTION_INSTRUCTIONS = (
    "You are an intent extractor. Read the USER message and decide if it explicitly asks to do "
    "ONE of these now: create a Google Calendar event, send an email, create a reminder/task, "
    "or send a WhatsApp message. Output ONLY one JSON object (no prose):\n"
    "  - For calendar:  {\"action\":\"create_event\", \"summary\":string, \"start_iso\":ISO8601, \"end_iso\":ISO8601, \"description\":string}\n"
    "  - For email:     {\"action\":\"send_email\", \"to\":string, \"subject\":string, \"body\":string}\n"
    "  - For reminder:  {\"action\":\"create_reminder\", \"text\":string, \"condition\":string}\n"
    "  - For whatsapp:  {\"action\":\"whatsapp_message\", \"phone\":string-or-empty, \"text\":string}  (phone is E.164 like +91...; leave empty if user did not specify)\n"
    "  - Otherwise:     {\"action\":\"none\"}\n"
    "Resolve relative times against the provided NOW. Default duration of a meeting is 30 minutes. "
    "Only return a non-none action when the user's request is unambiguous."
)


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


async def _extract_and_execute_action(user_text: str) -> tuple[Optional[str], Optional[str]]:
    """Detect an actionable intent and execute it. Returns (confirmation_note, whatsapp_link)."""
    if not user_text.strip():
        return None, None
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        prompt = f"NOW: {now_iso}\nUSER MESSAGE:\n{user_text}\n\nReturn the JSON."
        raw = await _bedrock_converse(
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            system_text=ACTION_INSTRUCTIONS,
            max_tokens=300,
            temperature=0.0,
        )
        obj = _safe_json_object(raw)
        action = (obj.get("action") or "none").lower()
        if action == "create_event":
            token = await gh.get_valid_token(db)
            if not token:
                return "\n\n📅 I tried to schedule that, but Google isn't connected yet. Open Daily Briefing → Connect Google.", None
            try:
                ev = await gh.create_event(
                    token, obj.get("summary", "Untitled"),
                    obj["start_iso"], obj["end_iso"], obj.get("description", ""),
                )
                start_h = ev.get("start", {}).get("dateTime", obj.get("start_iso", ""))
                return f"\n\n📅 Done — scheduled “{ev.get('summary')}” for {start_h}.", None
            except Exception as e:
                logger.warning("Auto create_event failed: %s", e)
                return f"\n\n⚠️ Couldn't create that event: {str(e)[:100]}", None
        if action == "send_email":
            token = await gh.get_valid_token(db)
            if not token:
                return "\n\n✉️ I tried to send that, but Google isn't connected yet. Open Daily Briefing → Connect Google.", None
            try:
                await gh.send_email(token, obj.get("to", ""), obj.get("subject", "(no subject)"), obj.get("body", ""))
                return f"\n\n✉️ Sent — “{obj.get('subject', '(no subject)')}” to {obj.get('to')}.", None
            except Exception as e:
                logger.warning("Auto send_email failed: %s", e)
                return f"\n\n⚠️ Couldn't send that email: {str(e)[:100]}", None
        if action == "create_reminder":
            r = Reminder(text=obj.get("text", "")[:300], condition=obj.get("condition", "")[:300])
            if r.text:
                await db.reminders.insert_one(r.dict())
                return f"\n\n🔔 Added reminder: “{r.text}”", None
        if action == "whatsapp_message":
            text = (obj.get("text") or "").strip()
            phone = re.sub(r"[^\d+]", "", obj.get("phone") or "")
            if not text:
                return None, None
            from urllib.parse import quote
            if phone:
                link = f"https://wa.me/{phone.lstrip('+')}?text={quote(text)}"
            else:
                link = f"https://wa.me/?text={quote(text)}"
            return "\n\n💬 I drafted a WhatsApp message for you — tap the button to open it and hit send.", link
    except Exception as e:
        logger.warning("Action extraction failed: %s", e)
    return None, None


# ----- Google OAuth + Gmail + Calendar -----
@api_router.get("/google/auth-url")
async def google_auth_url():
    if not gh.is_configured():
        raise HTTPException(500, "Google OAuth not configured on this server")
    return {"url": gh.auth_url()}


@api_router.get("/google/status")
async def google_status():
    doc = await db.integrations.find_one({"id": "google"}, {"_id": 0})
    if not doc:
        return {"connected": False}
    return {"connected": True, "email": doc.get("email"), "name": doc.get("name")}


@api_router.get("/me")
async def me():
    """Single-user auth gate. Returns Google user profile if connected, else 401."""
    doc = await db.integrations.find_one({"id": "google"}, {"_id": 0})
    if not doc or not doc.get("email"):
        raise HTTPException(status_code=401, detail="Not signed in")
    return {
        "email": doc.get("email"),
        "name": doc.get("name"),
        "picture": doc.get("picture"),
    }


# ----- Device notifications ingest + transaction extraction -----
class NotificationIngest(BaseModel):
    package_name: Optional[str] = None
    title: Optional[str] = ""
    text: Optional[str] = ""
    sub_text: Optional[str] = ""
    posted_at: Optional[str] = None


class DeviceNotification(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    package_name: Optional[str] = None
    title: str = ""
    text: str = ""
    sub_text: str = ""
    posted_at: str = Field(default_factory=utc_now_iso)
    received_at: str = Field(default_factory=utc_now_iso)
    kind: Optional[str] = None  # transaction | message | other
    amount: Optional[float] = None
    currency: Optional[str] = None
    direction: Optional[str] = None  # debit | credit
    merchant: Optional[str] = None
    raw_text: str = ""


TX_EXTRACTION_INSTRUCTIONS = (
    "You analyse a single Android notification from a banking, UPI, payments or messaging app. "
    "Decide if it represents a financial transaction or an important personal message. "
    "Return ONLY one JSON object:\n"
    "  - Transaction:  {\"kind\":\"transaction\", \"amount\":number, \"currency\":\"INR\"|\"USD\"|..., \"direction\":\"debit\"|\"credit\", \"merchant\":string}\n"
    "  - Message:      {\"kind\":\"message\"}\n"
    "  - Otherwise:    {\"kind\":\"other\"}"
)


async def _classify_notification(title: str, text: str) -> dict:
    body = f"TITLE: {title}\nTEXT: {text}"[:1500]
    try:
        raw = await _bedrock_converse(
            messages=[{"role": "user", "content": [{"text": body}]}],
            system_text=TX_EXTRACTION_INSTRUCTIONS,
            max_tokens=200,
            temperature=0.0,
        )
        return _safe_json_object(raw) or {"kind": "other"}
    except Exception:
        return {"kind": "other"}


@api_router.post("/notifications/ingest", response_model=DeviceNotification)
async def ingest_notification(body: NotificationIngest, background: BackgroundTasks):
    raw = f"{body.title or ''} | {body.text or ''}".strip()
    note = DeviceNotification(
        package_name=body.package_name,
        title=body.title or "",
        text=body.text or "",
        sub_text=body.sub_text or "",
        posted_at=body.posted_at or utc_now_iso(),
        raw_text=raw,
    )
    # Classify synchronously (small + fast) so the row stored has the right kind
    cls = await _classify_notification(note.title, note.text)
    note.kind = (cls.get("kind") or "other").lower()
    if note.kind == "transaction":
        try:
            note.amount = float(cls.get("amount")) if cls.get("amount") is not None else None
        except Exception:
            note.amount = None
        note.currency = cls.get("currency") or None
        note.direction = (cls.get("direction") or "").lower() or None
        note.merchant = cls.get("merchant") or None
    await db.notifications.insert_one(note.dict())
    return note


@api_router.get("/notifications", response_model=List[DeviceNotification])
async def list_notifications(kind: Optional[str] = None, limit: int = 100):
    q: dict = {}
    if kind:
        q["kind"] = kind
    rows = await db.notifications.find(q, {"_id": 0}).sort("posted_at", -1).to_list(limit)
    return [DeviceNotification(**r) for r in rows]


@api_router.delete("/notifications/{nid}")
async def delete_notification(nid: str):
    await db.notifications.delete_one({"id": nid})
    return {"ok": True}


@api_router.post("/google/disconnect")
async def google_disconnect():
    await db.integrations.delete_one({"id": "google"})
    return {"ok": True}


@api_router.get("/google/callback")
async def google_callback(code: Optional[str] = None, error: Optional[str] = None):
    if error:
        return HTMLResponse(f"<h2>Google sign-in failed</h2><p>{error}</p>", status_code=400)
    if not code:
        return HTMLResponse("<h2>Missing code</h2>", status_code=400)
    try:
        tok = await gh.exchange_code(code)
    except HTTPException as e:
        return HTMLResponse(f"<h2>Token exchange failed</h2><pre>{e.detail}</pre>", status_code=400)
    access = tok.get("access_token")
    refresh = tok.get("refresh_token")
    expires_in = tok.get("expires_in", 3600)
    info = await gh.get_userinfo(access) if access else {}
    import time as _t
    now = int(_t.time())
    set_doc = {
        "id": "google",
        "access_token": access,
        "expires_at": now + expires_in,
        "scope": tok.get("scope", ""),
        "email": info.get("email"),
        "name": info.get("name"),
        "picture": info.get("picture"),
        "updated_at": utc_now_iso(),
    }
    if refresh:
        set_doc["refresh_token"] = refresh
    await db.integrations.update_one({"id": "google"}, {"$set": set_doc}, upsert=True)
    return HTMLResponse(
        """<html><body style="font-family:system-ui;background:#0a0a0c;color:#F7F7F8;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <div style="text-align:center;padding:32px;">
          <div style="font-size:48px;color:#E1B168;">&#10003;</div>
          <h2 style="font-weight:400;">Google connected</h2>
          <p style="color:#B4B4B8;">You can close this tab and return to Nova.</p>
          <script>setTimeout(function(){window.close()},1500);</script>
        </div></body></html>"""
    )


@api_router.get("/gmail/recent")
async def gmail_recent(limit: int = 5):
    token = await gh.get_valid_token(db)
    if not token:
        raise HTTPException(401, "Google not connected")
    return {"messages": await gh.list_recent_messages(token, max_results=limit)}


class SendEmailReq(BaseModel):
    to: str
    subject: str
    body: str


@api_router.post("/gmail/send")
async def gmail_send(body: SendEmailReq):
    token = await gh.get_valid_token(db)
    if not token:
        raise HTTPException(401, "Google not connected")
    return await gh.send_email(token, body.to, body.subject, body.body)


@api_router.get("/calendar/upcoming")
async def calendar_upcoming(limit: int = 10):
    token = await gh.get_valid_token(db)
    if not token:
        raise HTTPException(401, "Google not connected")
    return {"events": await gh.list_upcoming_events(token, max_results=limit)}


class CreateEventReq(BaseModel):
    summary: str
    start_iso: str
    end_iso: str
    description: Optional[str] = ""


@api_router.post("/calendar/events")
async def calendar_create(body: CreateEventReq):
    token = await gh.get_valid_token(db)
    if not token:
        raise HTTPException(401, "Google not connected")
    return await gh.create_event(token, body.summary, body.start_iso, body.end_iso, body.description or "")


# ==================== TOOL CALLING ENHANCED CHAT ====================

class ChatWithToolsRequest(BaseModel):
    session_id: str
    message: str
    image_b64: Optional[str] = None
    image_mime: Optional[str] = None
    use_tools: bool = True  # Enable/disable tool calling


class ToolCallResult(BaseModel):
    tool_name: str
    params: dict
    result: dict


class ChatWithToolsResponse(BaseModel):
    session_id: str
    user_message: ChatMessage
    assistant_message: ChatMessage
    tool_calls: List[ToolCallResult] = []


async def _build_system_prompt_with_tools() -> str:
    """Build system prompt including tool definitions."""
    base = await _build_system_prompt()
    tools_prompt = tool_framework.get_tools_prompt()
    return f"{base}\n\n{tools_prompt}"


@api_router.post("/chat/tools", response_model=ChatWithToolsResponse)
async def chat_with_tools(body: ChatWithToolsRequest, background: BackgroundTasks):
    """Chat endpoint with tool calling support."""
    if not body.message.strip() and not body.image_b64:
        raise HTTPException(status_code=400, detail="Empty message")

    sess = await db.chat_sessions.find_one({"id": body.session_id}, {"_id": 0})
    if not sess:
        new_sess = ChatSession(id=body.session_id, title=(body.message or "New Chat")[:40])
        await db.chat_sessions.insert_one(new_sess.dict())

    history_rows = await db.chat_messages.find(
        {"session_id": body.session_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(2000)

    bedrock_msgs: List[dict] = []
    for h in history_rows:
        bedrock_msgs.append(_msg_block(h["role"], h.get("content", ""), h.get("image_b64"), "image/jpeg"))
    bedrock_msgs.append(_msg_block("user", body.message, body.image_b64, body.image_mime))

    # Use tool-enhanced system prompt if tools enabled
    if body.use_tools:
        system_text = await _build_system_prompt_with_tools()
    else:
        system_text = await _build_system_prompt()

    import asyncio
    emotion_task = asyncio.create_task(_classify_emotion(body.message))
    
    # Get initial AI response
    reply = await _bedrock_converse(bedrock_msgs, system_text=system_text, max_tokens=1200, temperature=0.6)
    emotion = await emotion_task

    tool_calls = []
    
    # Check for tool calls in response
    if body.use_tools:
        tool_call = tool_framework.extract_tool_call(reply)
        max_tool_iterations = 3  # Prevent infinite loops
        
        while tool_call and len(tool_calls) < max_tool_iterations:
            tool_name = tool_call.get("tool", "")
            params = tool_call.get("params", {})
            
            logger.info(f"Executing tool: {tool_name} with params: {params}")
            
            # Execute the tool
            result = await tool_framework.execute_tool(tool_name, params, db, gh)
            
            tool_calls.append(ToolCallResult(
                tool_name=tool_name,
                params=params,
                result=result
            ))
            
            # Add tool result to conversation and get final response
            tool_result_text = f"Tool '{tool_name}' returned: {json.dumps(result, default=str)}"
            bedrock_msgs.append(_msg_block("assistant", reply))
            bedrock_msgs.append(_msg_block("user", f"[Tool Result]: {tool_result_text}\n\nNow provide a natural response to the user based on this result."))
            
            # Get AI's response to the tool result
            reply = await _bedrock_converse(bedrock_msgs, system_text=system_text, max_tokens=900, temperature=0.6)
            
            # Check if AI wants to call another tool
            tool_call = tool_framework.extract_tool_call(reply)

    # Clean tool call syntax from final reply
    reply = re.sub(r'```tool\s*\n?\{.*?\}\s*\n?```', '', reply, flags=re.DOTALL).strip()

    # Legacy action extraction (for backwards compatibility)
    action_note, whatsapp_link = await _extract_and_execute_action(body.message)
    if action_note:
        reply = (reply or "").rstrip() + action_note

    user_msg = ChatMessage(
        session_id=body.session_id,
        role="user",
        content=body.message,
        image_b64=body.image_b64,
        emotion=emotion,
    )
    ai_msg = ChatMessage(
        session_id=body.session_id,
        role="assistant",
        content=reply,
        whatsapp_link=whatsapp_link,
    )
    await db.chat_messages.insert_one(user_msg.dict())
    await db.chat_messages.insert_one(ai_msg.dict())

    update = {"updated_at": utc_now_iso()}
    if not history_rows:
        update["title"] = (body.message.strip()[:40] or "New Chat")
    await db.chat_sessions.update_one({"id": body.session_id}, {"$set": update})

    background.add_task(_extract_and_store_memories, body.session_id, body.message, reply)

    return ChatWithToolsResponse(
        session_id=body.session_id,
        user_message=user_msg,
        assistant_message=ai_msg,
        tool_calls=tool_calls
    )


# ==================== WEB SEARCH ====================

class WebSearchRequest(BaseModel):
    query: str


@api_router.post("/search/web")
async def web_search(body: WebSearchRequest):
    """Search the web using DuckDuckGo (free, no API key)."""
    result = await tool_framework.tool_web_search(body.query)
    return result


# ==================== KNOWLEDGE VAULT ====================

@api_router.post("/knowledge/upload")
async def upload_document(file: UploadFile = File(...)):
    """Upload a document to the knowledge vault."""
    content = await file.read()
    result = await kv.process_document(
        content,
        file.filename or "document",
        file.content_type or "application/octet-stream",
        db
    )
    return result


@api_router.get("/knowledge/documents")
async def list_knowledge_documents(skip: int = 0, limit: int = 20):
    """List all documents in the knowledge vault."""
    docs = await kv.list_documents(db, skip, limit)
    total = await db.knowledge_docs.count_documents({})
    return {"documents": docs, "total": total}


@api_router.get("/knowledge/documents/{doc_id}")
async def get_knowledge_document(doc_id: str):
    """Get a specific document."""
    doc = await kv.get_document(doc_id, db)
    if not doc:
        raise HTTPException(404, "Document not found")
    return doc


@api_router.delete("/knowledge/documents/{doc_id}")
async def delete_knowledge_document(doc_id: str):
    """Delete a document from the knowledge vault."""
    deleted = await kv.delete_document(doc_id, db)
    if not deleted:
        raise HTTPException(404, "Document not found")
    return {"ok": True}


@api_router.post("/knowledge/search")
async def search_knowledge(body: WebSearchRequest):
    """Search the knowledge vault."""
    results = await kv.search_documents(body.query, db)
    return {"query": body.query, "results": results}


@api_router.get("/knowledge/stats")
async def get_knowledge_stats():
    """Get knowledge vault statistics."""
    return await kv.get_vault_stats(db)


# ==================== PHONE CALLS ====================

@api_router.post("/calls")
async def create_phone_call(body: pc.CallRequest):
    """Create a new AI phone call (mock mode)."""
    return await pc.create_call(body, db)


@api_router.get("/calls")
async def list_phone_calls(status: Optional[str] = None, limit: int = 50, skip: int = 0):
    """List phone calls."""
    calls = await pc.list_calls(db, status, limit, skip)
    total = await db.phone_calls.count_documents({})
    return {"calls": calls, "total": total}


@api_router.get("/calls/{call_id}")
async def get_phone_call(call_id: str):
    """Get a specific phone call."""
    call = await pc.get_call(call_id, db)
    if not call:
        raise HTTPException(404, "Call not found")
    return call


@api_router.put("/calls/{call_id}")
async def update_phone_call(call_id: str, body: pc.CallUpdate):
    """Update a phone call."""
    call = await pc.update_call(call_id, body, db)
    if not call:
        raise HTTPException(404, "Call not found")
    return call


@api_router.post("/calls/{call_id}/cancel")
async def cancel_phone_call(call_id: str):
    """Cancel a pending phone call."""
    cancelled = await pc.cancel_call(call_id, db)
    if not cancelled:
        raise HTTPException(400, "Call cannot be cancelled")
    return {"ok": True}


@api_router.get("/calls/stats/summary")
async def get_call_stats():
    """Get phone call statistics."""
    return await pc.get_call_stats(db)


# ==================== DASHBOARD ====================

@api_router.get("/dashboard")
async def get_dashboard(days: int = 30):
    """Get complete dashboard data."""
    return await dash.get_full_dashboard(db, days)


@api_router.get("/dashboard/usage")
async def get_usage_stats(days: int = 30):
    """Get usage statistics."""
    return await dash.get_usage_stats(db, days)


@api_router.get("/dashboard/spending")
async def get_spending_insights(days: int = 30):
    """Get spending insights from banking notifications."""
    return await dash.get_spending_insights(db, days)


@api_router.get("/dashboard/productivity")
async def get_productivity_analytics(days: int = 7):
    """Get productivity analytics."""
    return await dash.get_productivity_analytics(db, days)


@api_router.get("/dashboard/insights")
async def get_ai_insights():
    """Get AI-generated insights."""
    return await dash.get_ai_insights(db)


# ==================== NATIVE NOTIFICATIONS (Enhanced) ====================

class MockNotificationRequest(BaseModel):
    """For testing notification ingestion from web."""
    app_name: str
    title: str
    text: str


@api_router.post("/notifications/mock")
async def create_mock_notification(body: MockNotificationRequest):
    """Create a mock notification for testing."""
    from datetime import datetime, timezone
    note = {
        "id": str(uuid.uuid4()),
        "package_name": f"com.{body.app_name.lower().replace(' ', '')}",
        "title": body.title,
        "text": body.text,
        "sub_text": "",
        "posted_at": datetime.now(timezone.utc).isoformat(),
        "received_at": datetime.now(timezone.utc).isoformat(),
        "kind": "other",
        "raw_text": f"{body.title} | {body.text}"
    }
    
    # Classify the notification
    cls = await _classify_notification(note["title"], note["text"])
    note["kind"] = (cls.get("kind") or "other").lower()
    if note["kind"] == "transaction":
        try:
            note["amount"] = float(cls.get("amount")) if cls.get("amount") is not None else None
        except:
            note["amount"] = None
        note["currency"] = cls.get("currency") or None
        note["direction"] = (cls.get("direction") or "").lower() or None
        note["merchant"] = cls.get("merchant") or None
    
    await db.notifications.insert_one(note)
    return note


@api_router.get("/notifications/stats")
async def get_notification_stats():
    """Get notification statistics."""
    total = await db.notifications.count_documents({})
    
    pipeline = [
        {"$group": {"_id": "$kind", "count": {"$sum": 1}}}
    ]
    by_kind = {}
    async for doc in db.notifications.aggregate(pipeline):
        by_kind[doc["_id"] or "other"] = doc["count"]
    
    return {
        "total": total,
        "by_kind": by_kind
    }


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
