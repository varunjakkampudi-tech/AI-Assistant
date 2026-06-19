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
from typing import List, Optional, Literal, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
import httpx

from emergentintegrations.llm.openai.speech_to_text import OpenAISpeechToText

import google_helper as gh
import tools as tool_framework
import knowledge_vault as kv
import phone_calls as pc
import dashboard as dash
import elevenlabs_voice as el_voice
import call_manager as cm
import finance_brain as fb
import digital_twin as dt
import chief_of_staff as cos
import unified_search as us
import life_os as lifeos
import timeline as tl
import journal as journal_mod
import knowledge_graph as kg
import health as health_mod
import career as career_mod
import auth as auth_mod
import auth_routes as auth_routes_mod
import security as security_mod
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

# ElevenLabs Voice
ELEVENLABS_API_KEY = os.environ.get('ELEVENLABS_API_KEY', '')
ELEVENLABS_VOICE_ID = os.environ.get('ELEVENLABS_VOICE_ID', '')
elevenlabs = el_voice.init_elevenlabs(ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID)

# Call Manager
call_manager: cm.CallManager = None  # Initialized after db

BASE_SYSTEM_PROMPT = (
    "You are ORA — a warm, articulate, and helpful personal AI operating system for your user's life. "
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
    return {"message": "ORA OS API", "model": BEDROCK_MODEL_ID}


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

    # Auto-learn digital twin from this user message
    try:
        twin = get_digital_twin()
        background.add_task(twin.learn_from_message, body.message, "chat")
    except Exception as e:
        logger.warning("Twin learn schedule failed: %s", e)

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
            # Auto Gmail finance scan + frequent-contact learning (rate-limited to once per hour)
            try:
                last_sync = await fb.get_last_sync(db)
                last_run = (last_sync or {}).get("last_run_at") or ""
                should_run = True
                if last_run:
                    try:
                        prev = datetime.fromisoformat(last_run.replace("Z", "+00:00"))
                        should_run = (datetime.now(timezone.utc) - prev).total_seconds() > 3600
                    except Exception:
                        should_run = True
                if should_run:
                    scanner = fb.GmailFinanceScanner(db, get_finance_brain())
                    result = await scanner.scan(token, gh, days=30, max_messages=80)
                    logger.info(
                        "Auto Gmail finance scan: scanned=%s new=%s",
                        result.get("scanned"), result.get("new_transactions"),
                    )
                    # Learn frequent contacts from senders we just touched
                    twin = get_digital_twin()
                    for sender in (result.get("senders_seen") or [])[:20]:
                        name = _name_from_sender(sender)
                        if name:
                            try:
                                await twin.learn_contact_interaction(name, "email")
                            except Exception:
                                pass
            except Exception as e:
                logger.warning("Auto Gmail finance scan failed: %s", e)
    except Exception as e:
        logger.warning("Google token check failed: %s", e)

    # Get missed call reminders
    missed_calls = await db.missed_call_reminders.find(
        {"status": "pending"}, {"_id": 0}
    ).sort("missed_at", -1).to_list(10)

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
        "missed_calls": missed_calls,
        "integrations": {
            "google_calendar": {"connected": google_connected, "email": google_email},
            "gmail": {"connected": google_connected, "email": google_email},
            "outlook": {"connected": False},
            "voice": {"enabled": elevenlabs.enabled if elevenlabs else False},
        },
    }


ACTION_INSTRUCTIONS = (
    "You are an intent extractor. Read the USER message and decide if it explicitly asks to do "
    "ONE of these now: create a Google Calendar event, send an email, create a reminder/task, "
    "send a WhatsApp message, OR ask Nova to draft a reply to a named person in the user's own style. "
    "Output ONLY one JSON object (no prose):\n"
    "  - For calendar:  {\"action\":\"create_event\", \"summary\":string, \"start_iso\":ISO8601, \"end_iso\":ISO8601, \"description\":string}\n"
    "  - For email:     {\"action\":\"send_email\", \"to\":string, \"subject\":string, \"body\":string}\n"
    "  - For reminder:  {\"action\":\"create_reminder\", \"text\":string, \"condition\":string}\n"
    "  - For whatsapp:  {\"action\":\"whatsapp_message\", \"phone\":string-or-empty, \"text\":string}  (phone is E.164 like +91...; leave empty if user did not specify)\n"
    "  - For reply-in-style: {\"action\":\"draft_reply\", \"to_contact\":string, \"context\":string}\n"
    "    Trigger when the user says things like 'Reply to Vijay', 'Draft a reply to mom', "
    "    'Tell Anita that ...', 'Respond to Vijay about deployment'. 'context' is whatever you can "
    "    glean about the situation/topic; leave empty string if no context is given.\n"
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


def _name_from_sender(sender: str) -> Optional[str]:
    """Extract a human-friendly name from a Gmail From header. Skips no-reply senders."""
    if not sender:
        return None
    s = sender.strip()
    low = s.lower()
    if any(skip in low for skip in ("noreply", "no-reply", "donotreply", "do-not-reply", "alerts@", "notifications@", "support@", "auto-confirm")):
        return None
    # Try "Name <email>"
    m = re.match(r"\s*\"?([^\"<]+?)\"?\s*<([^>]+)>", s)
    if m:
        name = m.group(1).strip()
        if name and "@" not in name and len(name) > 1:
            return name
        s = m.group(2)
    # Use the local part of the email
    if "@" in s:
        local = s.split("@")[0]
        # Skip very short or numeric usernames
        if len(local) < 2 or local.isdigit():
            return None
        return local.replace(".", " ").replace("_", " ").replace("-", " ").title()
    return None


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
        if action == "draft_reply":
            to_contact = (obj.get("to_contact") or "").strip()
            ctx = (obj.get("context") or "").strip()
            if not to_contact:
                return None, None
            try:
                twin = get_digital_twin()
                # Record the interaction so frequent_contacts stays current
                try:
                    await twin.learn_contact_interaction(to_contact, "unknown")
                except Exception:
                    pass
                suggestion = await twin.generate_reply_suggestion(to_contact, ctx)
                if not suggestion:
                    style = ""
                    try:
                        style = await twin.get_style_prompt()
                    except Exception:
                        style = ""
                    prompt = (
                        f"Draft a reply from the user TO {to_contact}.\n"
                        f"Situation/context: {ctx or '(no extra context — write a brief, friendly check-in)'}\n\n"
                        f"User's communication style: {style}\n\n"
                        "Return ONLY the reply text — no greeting like 'Here's a draft', no quotes, no preamble. "
                        "Keep it natural and short (2-4 lines)."
                    )
                    suggestion = await _bedrock_converse(
                        messages=[{"role": "user", "content": [{"text": prompt}]}],
                        system_text="You write short replies that mimic the user's voice.",
                        max_tokens=180,
                        temperature=0.5,
                    )
                    suggestion = (suggestion or "").strip().strip('"').strip()
                if suggestion:
                    return (
                        f"\n\n✍️ Drafted reply to **{to_contact}** in your style:\n\n> {suggestion}\n\n"
                        "Send it as-is or tweak before sending.",
                        None,
                    )
            except Exception as e:
                logger.warning("draft_reply failed: %s", e)
                return f"\n\n⚠️ Couldn't draft that reply: {str(e)[:100]}", None
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
async def google_callback(code: Optional[str] = None, error: Optional[str] = None,
                          state: Optional[str] = None):
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

    # Login-handoff path: state starts with "login:<nonce>"
    if state and state.startswith("login:") and info.get("email"):
        nonce = state.split(":", 1)[1]
        try:
            user = await auth_mod.upsert_oauth_user(
                db, email=info["email"],
                name=info.get("name") or "",
                picture=info.get("picture") or "",
                provider="google",
            )
            await auth_mod.finalize_handoff(db, nonce, user)
            return HTMLResponse(
                """<html><body style="font-family:system-ui;background:#0a0a0c;color:#F7F7F8;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
                <div style="text-align:center;padding:32px;">
                  <div style="font-size:48px;color:#E1B168;">&#10003;</div>
                  <h2 style="font-weight:400;">Signed in to Nova</h2>
                  <p style="color:#B4B4B8;">You can close this tab and return to the app.</p>
                  <script>setTimeout(function(){window.close()},1200);</script>
                </div></body></html>"""
            )
        except Exception as e:
            logger.warning("Login handoff failed: %s", e)
            return HTMLResponse(f"<h2>Login failed</h2><pre>{e}</pre>", status_code=500)

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


# ==================== ELEVENLABS VOICE ====================

@api_router.get("/voice/status")
async def get_voice_status():
    """Check ElevenLabs voice configuration status."""
    if not elevenlabs or not elevenlabs.enabled:
        return {"enabled": False, "message": "ElevenLabs not configured"}
    
    info = await elevenlabs.get_voice_info()
    subscription = await elevenlabs.get_subscription_info()
    
    return {
        "enabled": True,
        "voice_id": ELEVENLABS_VOICE_ID,
        "voice_info": info,
        "subscription": subscription
    }


class TTSRequest(BaseModel):
    text: str
    stability: float = 0.5
    similarity_boost: float = 0.75


@api_router.post("/voice/tts")
async def text_to_speech(body: TTSRequest):
    """Convert text to speech using the user's cloned voice."""
    if not elevenlabs or not elevenlabs.enabled:
        raise HTTPException(400, "ElevenLabs not configured")
    
    audio_b64 = await elevenlabs.text_to_speech_base64(
        body.text,
        stability=body.stability,
        similarity_boost=body.similarity_boost
    )
    
    if not audio_b64:
        raise HTTPException(500, "TTS generation failed")
    
    return {
        "audio_base64": audio_b64,
        "format": "mp3",
        "text_length": len(body.text)
    }


@api_router.get("/voice/voices")
async def list_voices():
    """List all available ElevenLabs voices."""
    if not elevenlabs:
        return {"voices": []}
    
    voices = await elevenlabs.list_voices()
    return {"voices": voices}


# ==================== INCOMING CALLS & MISSED CALL REMINDERS ====================

# Initialize call manager (needs db, so done here)
_call_manager: cm.CallManager = None

def get_call_manager() -> cm.CallManager:
    global _call_manager
    if _call_manager is None:
        _call_manager = cm.CallManager(db)
    return _call_manager


class IncomingCallRequest(BaseModel):
    phone_number: str
    contact_name: Optional[str] = None


@api_router.post("/incoming-calls/register")
async def register_incoming_call(body: IncomingCallRequest):
    """Register a new incoming call (from native Android module)."""
    manager = get_call_manager()
    call = await manager.register_incoming_call(body.phone_number, body.contact_name)
    return call.dict()


@api_router.get("/incoming-calls/active")
async def get_active_call():
    """Get the currently active/ringing call."""
    manager = get_call_manager()
    call = await manager.get_active_call()
    return {"call": call}


@api_router.post("/incoming-calls/{call_id}/answer")
async def answer_incoming_call(call_id: str, ai_answer: bool = False):
    """Answer an incoming call. If ai_answer=true, Nova will answer with cloned voice."""
    manager = get_call_manager()
    call = await manager.answer_call(call_id, ai_answer)
    if not call:
        raise HTTPException(404, "Call not found")
    
    response = {"call": call}
    
    # If AI is answering, generate greeting audio
    if ai_answer and elevenlabs and elevenlabs.enabled:
        greeting = f"Hello! This is Nova, {'your' if call.get('contact_name') else 'the'} AI assistant. How can I help?"
        audio_b64 = await elevenlabs.text_to_speech_base64(greeting)
        if audio_b64:
            response["greeting_audio_base64"] = audio_b64
            response["greeting_text"] = greeting
    
    return response


@api_router.post("/incoming-calls/{call_id}/missed")
async def mark_call_missed(call_id: str):
    """Mark a call as missed and create a reminder."""
    manager = get_call_manager()
    call = await manager.mark_call_missed(call_id)
    if not call:
        raise HTTPException(404, "Call not found")
    return {"call": call, "reminder_created": True}


@api_router.post("/incoming-calls/{call_id}/end")
async def end_incoming_call(call_id: str, summary: Optional[str] = None):
    """End a call."""
    manager = get_call_manager()
    call = await manager.end_call(call_id, summary)
    if not call:
        raise HTTPException(404, "Call not found")
    return {"call": call}


@api_router.get("/incoming-calls")
async def list_incoming_calls(call_type: Optional[str] = None, limit: int = 50):
    """List incoming calls with optional filtering."""
    manager = get_call_manager()
    calls = await manager.list_calls(call_type, limit)
    return {"calls": calls}


@api_router.get("/incoming-calls/stats")
async def get_incoming_call_stats():
    """Get incoming call statistics."""
    manager = get_call_manager()
    return await manager.get_call_stats()


# ==================== MISSED CALL REMINDERS ====================

@api_router.get("/missed-calls")
async def get_missed_calls(status: str = "pending"):
    """Get missed call reminders."""
    manager = get_call_manager()
    reminders = await manager.get_missed_calls(status)
    return {"reminders": reminders}


@api_router.post("/missed-calls/{reminder_id}/dismiss")
async def dismiss_missed_call_reminder(reminder_id: str):
    """Dismiss a missed call reminder."""
    manager = get_call_manager()
    success = await manager.dismiss_reminder(reminder_id)
    if not success:
        raise HTTPException(404, "Reminder not found")
    return {"ok": True}


@api_router.post("/missed-calls/{reminder_id}/called-back")
async def mark_called_back(reminder_id: str):
    """Mark that the user called back."""
    manager = get_call_manager()
    success = await manager.mark_called_back(reminder_id)
    if not success:
        raise HTTPException(404, "Reminder not found")
    return {"ok": True}


# ==================== CALL COMMAND PARSER (for chat) ====================

@api_router.post("/parse-call-command")
async def parse_call_command(message: str):
    """Parse a message for call-related commands."""
    command = cm.parse_call_command(message)
    return {"command": command}


# ==================== PERSONAL FINANCE BRAIN ====================

# Initialize finance brain
_finance_brain: fb.PersonalFinanceBrain = None

def get_finance_brain() -> fb.PersonalFinanceBrain:
    global _finance_brain
    if _finance_brain is None:
        _finance_brain = fb.PersonalFinanceBrain(db)
    return _finance_brain


class BankNotificationRequest(BaseModel):
    title: str
    text: str
    app_name: str = ""


@api_router.post("/finance/process-notification")
async def process_bank_notification(body: BankNotificationRequest):
    """Process a banking notification and extract transaction data."""
    brain = get_finance_brain()
    return await brain.process_notification(body.title, body.text, body.app_name)


@api_router.get("/finance/spending-summary")
async def get_spending_summary(days: int = 30):
    """Get comprehensive spending summary."""
    brain = get_finance_brain()
    return await brain.get_spending_summary(days)


@api_router.get("/finance/insights")
async def get_spending_insights(days: int = 30):
    """Get AI-powered spending insights."""
    brain = get_finance_brain()
    return await brain.get_spending_insights(days)


@api_router.get("/finance/categories")
async def get_category_breakdown(days: int = 30):
    """Get spending breakdown by category."""
    brain = get_finance_brain()
    return await brain.get_category_breakdown(days)


@api_router.get("/finance/recurring")
async def get_recurring_transactions():
    """Detect recurring transactions (subscriptions, EMIs)."""
    brain = get_finance_brain()
    return await brain.get_recurring_transactions()


@api_router.post("/finance/sync-gmail")
async def sync_gmail_transactions(days: int = 30, max_messages: int = 100):
    """Scan Gmail for bank / UPI / credit-card emails and auto-create transactions."""
    token = await gh.get_valid_token(db)
    if not token:
        raise HTTPException(401, "Google not connected. Connect Google in the briefing screen first.")
    scanner = fb.GmailFinanceScanner(db, get_finance_brain())
    result = await scanner.scan(token, gh, days=days, max_messages=max_messages)
    # Learn frequent contacts from senders we just saw
    twin = get_digital_twin()
    for sender in (result.get("senders_seen") or [])[:30]:
        name = _name_from_sender(sender)
        if name:
            try:
                await twin.learn_contact_interaction(name, "email")
            except Exception:
                pass
    return result


@api_router.get("/finance/sync-status")
async def get_finance_sync_status():
    """Last Gmail finance sync metadata."""
    info = await fb.get_last_sync(db)
    return info or {"last_run_at": None, "last_scanned": 0, "last_new": 0}


# ==================== PERSONAL DIGITAL TWIN ====================

# Initialize digital twin
_digital_twin: dt.PersonalDigitalTwin = None

def get_digital_twin() -> dt.PersonalDigitalTwin:
    global _digital_twin
    if _digital_twin is None:
        _digital_twin = dt.PersonalDigitalTwin(db)
    return _digital_twin


@api_router.get("/twin/profile")
async def get_user_profile():
    """Get the user's digital twin profile."""
    twin = get_digital_twin()
    return await twin.get_profile()


class LearnMessageRequest(BaseModel):
    message: str
    context: str = "chat"


@api_router.post("/twin/learn")
async def learn_from_message(body: LearnMessageRequest):
    """Learn from a user message to update the digital twin."""
    twin = get_digital_twin()
    return await twin.learn_from_message(body.message, body.context)


class ContactInteractionRequest(BaseModel):
    contact_name: str
    relationship: str = "unknown"


@api_router.post("/twin/contact-interaction")
async def track_contact_interaction(body: ContactInteractionRequest):
    """Track interaction with a contact."""
    twin = get_digital_twin()
    await twin.learn_contact_interaction(body.contact_name, body.relationship)
    return {"ok": True}


class ResponseTemplateRequest(BaseModel):
    context: str
    response: str


@api_router.post("/twin/learn-response")
async def learn_response_template(body: ResponseTemplateRequest):
    """Learn a response template for a specific context."""
    twin = get_digital_twin()
    await twin.learn_response_template(body.context, body.response)
    return {"ok": True}


@api_router.get("/twin/style-prompt")
async def get_style_prompt():
    """Get a prompt describing the user's communication style."""
    twin = get_digital_twin()
    prompt = await twin.get_style_prompt()
    return {"style_prompt": prompt}


class ReplySuggestionRequest(BaseModel):
    to_contact: str
    context: str


@api_router.post("/twin/suggest-reply")
async def suggest_reply(body: ReplySuggestionRequest):
    """Get a reply suggestion in the user's style."""
    twin = get_digital_twin()
    suggestion = await twin.generate_reply_suggestion(body.to_contact, body.context)
    return {"suggestion": suggestion}


class PrioritiesUpdateRequest(BaseModel):
    priorities: Dict[str, float]


@api_router.post("/twin/update-priorities")
async def update_priorities(body: PrioritiesUpdateRequest):
    """Update user's priorities."""
    twin = get_digital_twin()
    await twin.update_priorities(body.priorities)
    return {"ok": True}


# ==================== AI CHIEF OF STAFF ====================

# Initialize chief of staff
_chief_of_staff: cos.AIChiefOfStaff = None

def get_chief_of_staff() -> cos.AIChiefOfStaff:
    global _chief_of_staff
    if _chief_of_staff is None:
        _chief_of_staff = cos.AIChiefOfStaff(db, gh)
    return _chief_of_staff


@api_router.get("/chief/morning-briefing")
async def get_morning_briefing(tz_offset: int = 0):
    """Get comprehensive morning briefing with proactive suggestions."""
    chief = get_chief_of_staff()
    return await chief.generate_morning_briefing(tz_offset)


@api_router.get("/chief/suggestions")
async def get_smart_suggestions(context: str = ""):
    """Get AI-powered suggestions based on current context."""
    chief = get_chief_of_staff()
    return await chief.get_smart_suggestions(context)


# ==================== PERSONAL SEARCH ENGINE ====================

_search_engine: Optional[us.PersonalSearchEngine] = None


def get_search_engine() -> us.PersonalSearchEngine:
    global _search_engine
    if _search_engine is None:
        _search_engine = us.PersonalSearchEngine(db, gh)
    return _search_engine


class UnifiedSearchRequest(BaseModel):
    query: str
    sources: Optional[List[str]] = None
    top_k: int = 12
    synthesize: bool = True


@api_router.post("/search/unified")
async def unified_search(body: UnifiedSearchRequest):
    """Search across chats, memories, goals, reminders, knowledge, finance,
    calendar, and email (last two require Google connected)."""
    engine = get_search_engine()
    return await engine.search(body.query, body.sources, body.top_k, body.synthesize)


@api_router.get("/search/sources")
async def search_sources_status():
    """Return which sources are available right now (helps the UI render filters)."""
    google_doc = await db.integrations.find_one({"id": "google"}, {"email": 1, "_id": 0})
    google_on = bool(google_doc and google_doc.get("email"))
    counts: Dict[str, int] = {}
    for k, coll in [
        ("chat", db.messages),
        ("memory", db.memories),
        ("goal", db.goals),
        ("reminder", db.reminders),
        ("knowledge", db.knowledge_documents),
        ("finance", db.transactions),
    ]:
        try:
            counts[k] = await coll.count_documents({})
        except Exception:
            counts[k] = 0
    return {
        "available": {
            "chat": True, "memory": True, "goal": True, "reminder": True,
            "knowledge": True, "finance": True,
            "calendar": google_on, "email": google_on,
        },
        "counts": counts,
        "google_connected": google_on,
    }


# ==================== LIFE OPERATING SYSTEM ====================

_life_os: Optional[lifeos.LifeOperatingSystem] = None


def get_life_os() -> lifeos.LifeOperatingSystem:
    global _life_os
    if _life_os is None:
        _life_os = lifeos.LifeOperatingSystem(db, finance_brain=get_finance_brain(), digital_twin=get_digital_twin())
    return _life_os


@api_router.get("/life/scores")
async def life_scores():
    """Multi-dimension life scores (Health/Career/Finance/Learning/Relationships)."""
    return await get_life_os().get_scores()


@api_router.get("/life/recommendations")
async def life_recommendations(max_items: int = 5):
    """Daily actionable recommendations curated for the user."""
    return await get_life_os().get_recommendations(max_items=max_items)


@api_router.get("/life/dashboard")
async def life_dashboard():
    """One-shot endpoint returning scores + recommendations."""
    return await get_life_os().get_dashboard()


# ==================== LIFE OS TIMELINE ====================

@api_router.get("/timeline")
async def timeline_for_date(date: Optional[str] = None, tz_offset: int = 0):
    """Aggregated event timeline for a given local date (YYYY-MM-DD). Defaults to today."""
    if not date:
        date = (datetime.now(timezone.utc) + timedelta(minutes=tz_offset)).date().isoformat()
    token = None
    try:
        token = await gh.get_valid_token(db)
    except Exception:
        pass
    return await tl.build_day_timeline(db, date, tz_offset_minutes=tz_offset, google_helper=gh, google_token=token)


@api_router.get("/timeline/on-this-day")
async def timeline_on_this_day(months_back: int = 12, tz_offset: int = 0):
    """Memory Time Machine: what happened today X months ago."""
    token = None
    try:
        token = await gh.get_valid_token(db)
    except Exception:
        pass
    return await tl.on_this_day(db, months_back=months_back, tz_offset_minutes=tz_offset, google_helper=gh, google_token=token)


@api_router.get("/timeline/range")
async def timeline_range(from_: str, to_: str, tz_offset: int = 0):
    """Aggregate totals for a date range (e.g. all of March)."""
    return await tl.range_summary(db, from_date=from_, to_date=to_, tz_offset_minutes=tz_offset)


# ==================== AI JOURNAL ====================

@api_router.post("/journal/generate")
async def generate_journal(date: Optional[str] = None, tz_offset: int = 0, overwrite: bool = True):
    """Generate the journal for a given date (default: today)."""
    if not date:
        date = (datetime.now(timezone.utc) + timedelta(minutes=tz_offset)).date().isoformat()
    token = None
    try:
        token = await gh.get_valid_token(db)
    except Exception:
        pass
    timeline = await tl.build_day_timeline(db, date, tz_offset_minutes=tz_offset, google_helper=gh, google_token=token)
    twin = get_digital_twin()
    style = await twin.get_style_prompt()
    entry = await journal_mod.generate_journal_for_date(
        db, date, timeline, style, _bedrock_converse, overwrite=overwrite,
    )
    return entry


@api_router.get("/journal")
async def list_journals(limit: int = 60):
    """List journal entries (most recent first)."""
    return await journal_mod.list_journal_entries(db, limit=limit)


@api_router.get("/journal/{date}")
async def get_journal_entry(date: str):
    entry = await journal_mod.get_journal(db, date)
    if not entry:
        raise HTTPException(404, f"No journal for {date}. POST /api/journal/generate to create one.")
    return entry


# ==================== PERSONAL KNOWLEDGE GRAPH ====================

@api_router.get("/graph")
async def get_knowledge_graph():
    """Full personal knowledge graph (nodes + edges)."""
    return await kg.build_graph(db)


@api_router.get("/graph/related")
async def graph_related(q: str, depth: int = 1):
    """Sub-graph centred around a search query (e.g. 'AWS')."""
    return await kg.related_to(db, q, depth=depth)


# ==================== HEALTH INTELLIGENCE ====================

class HealthLogRequest(BaseModel):
    metric: str
    value: float
    note: Optional[str] = ""
    logged_at: Optional[str] = None


@api_router.post("/health/log")
async def health_log(body: HealthLogRequest):
    """Log a health metric (sleep_hours, water_glasses, workout_minutes, steps, weight_kg, mood, calories)."""
    try:
        doc = await health_mod.log_metric(db, body.metric, body.value, body.note, body.logged_at)
        return doc
    except ValueError as e:
        raise HTTPException(400, str(e))


@api_router.get("/health/logs")
async def health_logs(metric: Optional[str] = None, days: int = 30):
    return await health_mod.list_logs(db, metric=metric, days=days)


@api_router.delete("/health/logs/{log_id}")
async def health_delete(log_id: str):
    ok = await health_mod.delete_log(db, log_id)
    if not ok:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@api_router.get("/health/summary")
async def health_summary(days: int = 30):
    """Per-metric trends + cross-metric insights + streaks."""
    return await health_mod.summarize(db, days=days)


@api_router.get("/health/metrics")
async def health_metrics():
    """List supported metrics + units."""
    return {"metrics": health_mod.SUPPORTED_METRICS}


# ==================== FAMILY HUB ====================

@api_router.get("/family")
async def family_hub():
    """Family / relationships view: people (relationship != 'colleague'), upcoming birthdays/anniversaries from memories."""
    profile = await db.user_profile.find_one({"id": "user_profile"}, {"_id": 0}) or {}
    contacts = profile.get("frequent_contacts") or []
    family_terms = {"mother", "mom", "father", "dad", "sister", "brother",
                    "wife", "husband", "partner", "girlfriend", "boyfriend",
                    "daughter", "son", "aunt", "uncle", "cousin", "grandma",
                    "grandpa", "family", "spouse", "parent", "kid", "child"}
    family = []
    for c in contacts:
        rel = (c.get("relationship") or "").lower()
        name_l = (c.get("name") or "").lower()
        if any(t in rel for t in family_terms) or any(t in name_l for t in family_terms):
            family.append(c)

    # Anniversaries / birthdays from memories (category in {date, person, preference})
    birthdays = []
    async for m in db.memories.find(
        {"category": {"$in": ["date", "person", "preference"]}}, {"_id": 0},
    ):
        text = ((m.get("content") or "") + " " + (m.get("subject") or "")).lower()
        if any(kw in text for kw in ("birthday", "anniversary", "appointment", "due date", "wedding")):
            birthdays.append({
                "subject": m.get("subject"),
                "content": m.get("content"),
                "category": m.get("category"),
                "importance": m.get("importance", 3),
            })

    return {
        "family_members": family,
        "important_dates": birthdays[:30],
        "all_contacts_count": len(contacts),
    }


# ==================== CAREER COPILOT ====================

class CareerProfileUpdate(BaseModel):
    name: Optional[str] = None
    headline: Optional[str] = None
    summary: Optional[str] = None
    current_role: Optional[str] = None
    current_company: Optional[str] = None
    years_experience: Optional[int] = None
    location: Optional[str] = None
    remote_preference: Optional[str] = None
    expected_ctc_inr: Optional[int] = None
    notice_period_days: Optional[int] = None
    open_to_work: Optional[bool] = None
    links: Optional[Dict[str, str]] = None
    skills: Optional[List[str]] = None
    certifications: Optional[List[str]] = None
    experience: Optional[List[Dict[str, Any]]] = None
    education: Optional[List[Dict[str, Any]]] = None
    projects: Optional[List[Dict[str, Any]]] = None
    filters: Optional[Dict[str, Any]] = None


@api_router.get("/career/profile")
async def career_profile_get():
    return await career_mod.get_profile(db)


@api_router.put("/career/profile")
async def career_profile_put(body: CareerProfileUpdate):
    updates = {k: v for k, v in body.dict().items() if v is not None}
    return await career_mod.update_profile(db, updates)


class JobUrlIngest(BaseModel):
    url: str


@api_router.post("/career/jobs/ingest-url")
async def career_jobs_ingest_url(body: JobUrlIngest):
    parsed = await career_mod.fetch_jd_from_url(body.url)
    if not parsed.get("raw_text"):
        raise HTTPException(400, "Couldn't extract any text from that URL. Paste the JD text manually instead.")
    job = await career_mod.create_job(
        db,
        source="url",
        source_url=body.url,
        title=parsed.get("title") or "Untitled role",
        company=parsed.get("company") or "",
        location=parsed.get("location") or "",
        raw_text=parsed.get("raw_text") or "",
    )
    try:
        scored = await career_mod.score_job(db, job["id"], _bedrock_converse)
        job["match_score"] = scored["score"]
        job["match_breakdown"] = {k: scored[k] for k in ("strengths", "gaps", "recommendation", "rationale", "scored_at")}
    except Exception as e:
        logger.warning("auto-score on ingest failed: %s", e)
    return job


class JobManualIngest(BaseModel):
    title: str
    company: str = ""
    location: str = ""
    raw_text: str
    source_url: Optional[str] = None


@api_router.post("/career/jobs")
async def career_jobs_manual(body: JobManualIngest):
    job = await career_mod.create_job(
        db, source="manual", source_url=body.source_url,
        title=body.title, company=body.company, location=body.location, raw_text=body.raw_text,
    )
    try:
        scored = await career_mod.score_job(db, job["id"], _bedrock_converse)
        job["match_score"] = scored["score"]
        job["match_breakdown"] = {k: scored[k] for k in ("strengths", "gaps", "recommendation", "rationale", "scored_at")}
    except Exception:
        pass
    return job


@api_router.get("/career/jobs")
async def career_jobs_list(min_score: Optional[int] = None, limit: int = 100):
    return await career_mod.list_jobs(db, min_score=min_score, limit=limit)


@api_router.delete("/career/jobs/{job_id}")
async def career_jobs_delete(job_id: str):
    ok = await career_mod.delete_job(db, job_id)
    if not ok:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@api_router.post("/career/jobs/{job_id}/score")
async def career_jobs_rescore(job_id: str):
    try:
        return await career_mod.score_job(db, job_id, _bedrock_converse)
    except ValueError as e:
        raise HTTPException(404, str(e))


class ArtifactKindReq(BaseModel):
    kind: str   # 'resume' | 'cover_letter' | 'interview_kit'


@api_router.post("/career/jobs/{job_id}/generate")
async def career_generate(job_id: str, body: ArtifactKindReq):
    try:
        twin = get_digital_twin()
        style = await twin.get_style_prompt()
        return await career_mod.generate_artifact(db, job_id, body.kind, _bedrock_converse, style_prompt=style)
    except ValueError as e:
        raise HTTPException(400, str(e))


@api_router.get("/career/jobs/{job_id}/artifact/{kind}")
async def career_artifact(job_id: str, kind: str):
    art = await career_mod.get_artifact(db, job_id, kind)
    if not art:
        raise HTTPException(404, f"No {kind} generated yet for this job.")
    return art


class ApplicationUpdate(BaseModel):
    stage: str
    notes: Optional[str] = ""


@api_router.post("/career/jobs/{job_id}/application")
async def career_application_set(job_id: str, body: ApplicationUpdate):
    try:
        return await career_mod.upsert_application(db, job_id, body.stage, body.notes or "")
    except ValueError as e:
        raise HTTPException(400, str(e))


@api_router.get("/career/pipeline")
async def career_pipeline():
    return await career_mod.pipeline_summary(db)


@api_router.get("/career/boards")
async def career_boards_list():
    return await career_mod.list_boards(db)


class BoardsReplace(BaseModel):
    items: List[Dict[str, Any]]


@api_router.put("/career/boards")
async def career_boards_replace(body: BoardsReplace):
    return await career_mod.replace_boards(db, body.items)


@api_router.post("/career/sync")
async def career_sync(auto_score: bool = True, max_per_board: int = 30):
    return await career_mod.sync_boards(db, _bedrock_converse,
                                        auto_score=auto_score, max_per_board=max_per_board)


@api_router.get("/career/sync-status")
async def career_sync_status():
    info = await db.sync_state.find_one({"id": "career_boards"}, {"_id": 0})
    return info or {"last_run_at": None, "new_jobs": 0, "scored": 0}


# ==================== AI COMPANION NUDGES ====================
@api_router.get("/companion/nudges")
async def companion_nudges():
    """Habit-aware proactive suggestions (gym streak, sleep, goals, finance)."""
    nudges: List[Dict[str, Any]] = []

    # Health insights
    try:
        hs = await health_mod.summarize(db, days=14)
        for ins in hs.get("insights", []):
            nudges.append({
                "icon": ins.get("icon"),
                "priority": ins.get("priority"),
                "title": ins.get("message"),
                "detail": ins.get("detail"),
                "source": "health",
            })
    except Exception:
        pass

    # Goal at 0 progress for >7 days
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    async for g in db.goals.find(
        {"status": "active", "progress": {"$lt": 10}, "created_at": {"$lt": cutoff}},
        {"_id": 0},
    ):
        nudges.append({
            "icon": "alert-circle",
            "priority": "medium",
            "title": f"Goal stuck: {g.get('title')}",
            "detail": "It's been a week with little movement. Pick one tiny step today.",
            "source": "goal",
            "ref_id": g.get("id"),
        })

    # Finance: high single-day spend
    today_iso = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    spent_today = 0.0
    async for n in db.notifications.find(
        {"kind": "transaction", "direction": "debit", "posted_at": {"$gte": today_iso}},
        {"_id": 0, "amount": 1},
    ):
        spent_today += (n.get("amount") or 0)
    if spent_today >= 3000:
        nudges.append({
            "icon": "card",
            "priority": "low",
            "title": f"Spent ₹{int(spent_today):,} in the last 24h",
            "detail": "Tap Finance to see categories.",
            "source": "finance",
        })

    # Memory Time Machine surfacing
    try:
        on_day = await tl.on_this_day(db, months_back=12, tz_offset_minutes=0, google_helper=gh, google_token=None)
        if on_day.get("events"):
            nudges.append({
                "icon": "time",
                "priority": "low",
                "title": f"On this day a year ago — {len(on_day['events'])} events",
                "detail": "Open the Timeline to revisit.",
                "source": "timetravel",
            })
    except Exception:
        pass

    return nudges


@api_router.get("/expo-go", response_class=HTMLResponse)
async def expo_go_page():
    """Landing page with a live QR code that opens Nova in Expo Go (iOS + Android).

    The tunnel URL rotates whenever Metro restarts, so we fetch the current
    launchAsset URL from the local Metro dev server and rebuild the QR every time.
    """
    from urllib.parse import quote
    tunnel_host = None
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            r = await client.get(
                "http://localhost:3000/",
                headers={
                    "Expo-Platform": "ios",
                    "Accept": "application/expo+json,application/json",
                },
            )
            if r.status_code == 200:
                manifest = r.json()
                launch_url = manifest.get("launchAsset", {}).get("url", "")
                # launch_url looks like http://<hash>-anonymous-3000.exp.direct/...
                if "://" in launch_url:
                    tunnel_host = launch_url.split("://", 1)[1].split("/", 1)[0]
    except Exception as e:  # noqa: BLE001
        logger.warning(f"expo-go: couldn't read live tunnel from Metro: {e}")

    if not tunnel_host:
        tunnel_host = os.environ.get("EXPO_TUNNEL_URL", "exp://localhost:3000").replace("exp://", "").replace("http://", "")

    exp_url = f"exp://{tunnel_host}"
    qr_src = f"https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data={quote(exp_url)}"
    universal = f"https://exp.host/--/to-exp/{quote(exp_url)}"

    return HTMLResponse(f"""
<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open Nova in Expo Go</title>
<style>
  *{{box-sizing:border-box}}
  body{{margin:0;background:#0a0a0c;color:#F7F7F8;font-family:-apple-system,system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}}
  .card{{max-width:560px;width:100%;background:#16161a;border:1px solid #2a2a30;border-radius:20px;padding:32px;}}
  h1{{margin:0 0 6px;font-weight:600;font-size:28px;color:#E1B168;text-align:center;}}
  .sub{{color:#9b9ba1;font-size:14px;margin-bottom:24px;text-align:center;}}
  .qr-wrap{{text-align:center;margin-bottom:20px;}}
  .qr{{background:#fff;border-radius:16px;padding:18px;display:inline-block;}}
  .qr img{{display:block;width:280px;height:280px;}}
  .url{{margin-top:16px;font-family:ui-monospace,Menlo,monospace;font-size:12px;background:#0a0a0c;border:1px solid #2a2a30;border-radius:10px;padding:10px;word-break:break-all;color:#E1B168;text-align:center;}}
  .btns{{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;justify-content:center;}}
  a.btn{{flex:1;min-width:160px;display:inline-block;background:#E1B168;color:#16161a;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:600;font-size:14px;text-align:center;}}
  a.btn.alt{{background:#2a2a30;color:#F7F7F8;}}
  .platforms{{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:24px;}}
  .plat{{background:#0a0a0c;border:1px solid #2a2a30;border-radius:12px;padding:16px;}}
  .plat h3{{margin:0 0 10px;font-size:14px;color:#E1B168;font-weight:600;display:flex;align-items:center;gap:6px;}}
  .plat ol{{margin:0;padding-left:20px;color:#cfcfd4;font-size:13px;line-height:1.6;}}
  .stores{{margin-top:18px;font-size:12px;color:#9b9ba1;text-align:center;}}
  .stores a{{color:#E1B168;text-decoration:none;margin:0 6px;}}
  .note{{margin-top:18px;font-size:12px;color:#9b9ba1;background:#0a0a0c;border-left:3px solid #E1B168;border-radius:6px;padding:10px 14px;line-height:1.5;}}
  @media (max-width:560px){{.platforms{{grid-template-columns:1fr}} .qr img{{width:240px;height:240px}}}}
</style></head>
<body><div class="card">
  <h1>Nova AI</h1>
  <div class="sub">Open in Expo Go — iOS & Android</div>

  <div class="qr-wrap"><div class="qr"><img src="{qr_src}" alt="Expo Go QR"></div></div>

  <div class="url">{exp_url}</div>

  <div class="btns">
    <a class="btn" href="{exp_url}">Open in Expo Go (phone)</a>
    <a class="btn alt" href="{universal}">Or use universal link</a>
  </div>

  <div class="platforms">
    <div class="plat">
      <h3>📱 iPhone</h3>
      <ol>
        <li>Install <b>Expo Go</b> from the App Store.</li>
        <li>Open the <b>Camera</b> app and point at the QR.</li>
        <li>Tap the yellow banner that says "Open in Expo Go".</li>
      </ol>
    </div>
    <div class="plat">
      <h3>🤖 Android</h3>
      <ol>
        <li>Install <b>Expo Go</b> from Google Play.</li>
        <li>Open <b>Expo Go</b> → tap <b>"Scan QR code"</b>.</li>
        <li>Point at the QR — Nova will launch.</li>
      </ol>
    </div>
  </div>

  <div class="note">
    The tunnel URL changes each time Metro restarts. <b>Refresh this page</b> if Expo Go says
    "Something went wrong" — that means you have an outdated link. The QR above is always live.
  </div>

  <div class="stores">
    <a href="https://apps.apple.com/app/expo-go/id982107779">iOS App Store ↗</a> ·
    <a href="https://play.google.com/store/apps/details?id=host.exp.exponent">Google Play ↗</a>
  </div>
</div></body></html>""")


app.include_router(api_router)
app.include_router(auth_routes_mod.router, prefix="/api")


@app.get("/api/expo-qr")
async def expo_qr():
    """Returns metadata for the Expo Go install card shown on the You tab."""
    base = os.environ.get("APP_PUBLIC_URL", "")
    return {
        "app_name": os.environ.get("APP_NAME", "ORA OS"),
        "preview_url": base,
        "expo_go_ios": "https://apps.apple.com/app/expo-go/id982107779",
        "expo_go_android": "https://play.google.com/store/apps/details?id=host.exp.exponent",
        "qr_image_url": f"{base}/api/expo-qr/png",
        "instructions": [
            "Install Expo Go from the App Store / Play Store.",
            "Scan the QR with the Expo Go app (Android) or your phone's Camera (iOS).",
            "ORA OS opens directly inside Expo Go.",
        ],
    }


@app.get("/api/expo-qr/png")
async def expo_qr_png():
    """Generates a QR code PNG pointing to the preview URL (cheap, on-the-fly)."""
    from fastapi.responses import Response
    import io
    base = os.environ.get("APP_PUBLIC_URL", "https://oraos.app")
    try:
        import qrcode
        img = qrcode.make(base)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return Response(content=buf.getvalue(), media_type="image/png")
    except ImportError:
        # Fallback: redirect to a public QR generator (free, no API key)
        return RedirectResponse(
            f"https://api.qrserver.com/v1/create-qr-code/?size=400x400&bgcolor=0a0a0c&color=E1B168&data={base}"
        )


# expose db to dependency-based routes
app.state.db = db

# Public endpoints that do NOT require a Bearer token.
PUBLIC_PATH_PREFIXES = (
    "/api/",                       # exact root only — see _is_public below
    "/api/auth/",
    "/api/legal/",
    "/api/google/callback",
    "/api/expo-qr",
    "/api/install",
    "/api/support/faq",
    "/docs", "/openapi.json", "/redoc",
)


def _is_public(path: str) -> bool:
    # Root /api/ is public, deeper /api/foo paths fall through to whitelist check.
    if path in ("/api", "/api/", "/", ""):
        return True
    for p in PUBLIC_PATH_PREFIXES:
        if p != "/api/" and path.startswith(p):
            return True
    return False


@app.middleware("http")
async def auth_gate(request, call_next):
    path = request.url.path
    # Only gate /api/* — let static / docs / non-api paths through
    if not path.startswith("/api"):
        return await call_next(request)
    if request.method == "OPTIONS":
        return await call_next(request)
    if _is_public(path):
        return await call_next(request)
    # Require a Bearer token
    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        from fastapi.responses import JSONResponse
        return JSONResponse({"detail": "Authentication required"}, status_code=401)
    try:
        token = auth_header[7:].strip()
        payload = auth_mod.decode_token(token, "access")
        request.state.user_id = payload.get("sub")
        request.state.user_email = payload.get("email")
    except HTTPException as e:
        from fastapi.responses import JSONResponse
        return JSONResponse({"detail": e.detail}, status_code=e.status_code)
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _on_startup():
    try:
        await auth_mod.ensure_indexes(db)
        await security_mod.ensure_indexes(db)
        await auth_mod.seed_admin(db)
    except Exception as e:
        logger.warning("Auth startup hook failed: %s", e)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
