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
    "Use plain prose; avoid heavy markdown unless asked."
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
    reply = await _bedrock_converse(bedrock_msgs, system_text=system_text, max_tokens=900, temperature=0.6)

    user_msg = ChatMessage(
        session_id=body.session_id,
        role="user",
        content=body.message,
        image_b64=body.image_b64,
    )
    ai_msg = ChatMessage(session_id=body.session_id, role="assistant", content=reply)
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

    return {
        "greeting": _greeting_for_now(tz_offset),
        "name": name,
        "weather": weather,
        "pending_reminders": pending,
        "active_goals": active_goals,
        "important_dates": date_memories,
        "session_count": session_count,
        "integrations": {
            "google_calendar": {"connected": False, "note": "Connect requires Google Cloud OAuth client with calendar.events scope."},
            "gmail": {"connected": False, "note": "Connect requires Google Cloud OAuth client with gmail.readonly + gmail.send scopes."},
            "outlook": {"connected": False, "note": "Connect requires Azure AD app credentials."},
        },
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
