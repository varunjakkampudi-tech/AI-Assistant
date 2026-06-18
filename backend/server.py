from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import tempfile
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone
import httpx

from emergentintegrations.llm.openai.speech_to_text import OpenAISpeechToText

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Bedrock config
AWS_BEARER_TOKEN_BEDROCK = os.environ['AWS_BEARER_TOKEN_BEDROCK']
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
BEDROCK_MODEL_ID = os.environ.get('BEDROCK_MODEL_ID', 'amazon.nova-lite-v1:0')
BEDROCK_URL = f"https://bedrock-runtime.{AWS_REGION}.amazonaws.com/model/{BEDROCK_MODEL_ID}/converse"

# Emergent LLM key for Whisper
EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']

SYSTEM_PROMPT = (
    "You are Nova — a warm, articulate, and helpful AI assistant. "
    "Keep replies concise and natural for spoken delivery when possible. "
    "Use plain prose; avoid heavy markdown unless asked."
)

app = FastAPI()
api_router = APIRouter(prefix="/api")


# ------------------- Models -------------------
def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ChatMessage(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    session_id: str
    role: str  # 'user' | 'assistant'
    content: str
    created_at: str = Field(default_factory=utc_now_iso)


class ChatSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str = "New Chat"
    created_at: str = Field(default_factory=utc_now_iso)
    updated_at: str = Field(default_factory=utc_now_iso)


class CreateSessionRequest(BaseModel):
    title: Optional[str] = None


class ChatRequest(BaseModel):
    session_id: str
    message: str


class ChatResponse(BaseModel):
    session_id: str
    user_message: ChatMessage
    assistant_message: ChatMessage


# ------------------- Bedrock call -------------------
async def call_bedrock_nova(messages: List[dict]) -> str:
    """
    messages = [{"role": "user"|"assistant", "content": "text"}]
    Returns the assistant text reply from Amazon Nova Lite via Bedrock Converse REST API.
    """
    payload = {
        "messages": [
            {"role": m["role"], "content": [{"text": m["content"]}]}
            for m in messages
        ],
        "system": [{"text": SYSTEM_PROMPT}],
        "inferenceConfig": {
            "maxTokens": 800,
            "temperature": 0.6,
            "topP": 0.9,
        },
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
        # Converse response shape:
        # { output: { message: { role, content: [{text}] } }, usage, stopReason }
        parts = data["output"]["message"]["content"]
        text = "".join(p.get("text", "") for p in parts).strip()
        return text or "(no response)"
    except Exception as e:
        logger.exception("Bedrock parse failed: %s", data)
        raise HTTPException(status_code=502, detail=f"Bedrock parse error: {e}")


# ------------------- Routes -------------------
@api_router.get("/")
async def root():
    return {"message": "Nova AI Assistant API", "model": BEDROCK_MODEL_ID}


@api_router.post("/sessions", response_model=ChatSession)
async def create_session(body: CreateSessionRequest):
    session = ChatSession(title=body.title or "New Chat")
    await db.chat_sessions.insert_one(session.dict())
    return session


@api_router.get("/sessions", response_model=List[ChatSession])
async def list_sessions():
    rows = await db.chat_sessions.find({}, {"_id": 0}).sort("updated_at", -1).to_list(500)
    return [ChatSession(**r) for r in rows]


@api_router.get("/sessions/{session_id}/messages", response_model=List[ChatMessage])
async def get_messages(session_id: str):
    rows = await db.chat_messages.find({"session_id": session_id}, {"_id": 0}).sort("created_at", 1).to_list(2000)
    return [ChatMessage(**r) for r in rows]


@api_router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    await db.chat_sessions.delete_one({"id": session_id})
    await db.chat_messages.delete_many({"session_id": session_id})
    return {"ok": True}


@api_router.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest):
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="Empty message")

    # Ensure session exists; create on the fly if missing
    sess = await db.chat_sessions.find_one({"id": body.session_id}, {"_id": 0})
    if not sess:
        new_sess = ChatSession(id=body.session_id, title=body.message[:40])
        await db.chat_sessions.insert_one(new_sess.dict())

    # Load history
    history_rows = await db.chat_messages.find(
        {"session_id": body.session_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(2000)

    convo = [{"role": r["role"], "content": r["content"]} for r in history_rows]
    convo.append({"role": "user", "content": body.message})

    # Call Bedrock
    reply = await call_bedrock_nova(convo)

    user_msg = ChatMessage(session_id=body.session_id, role="user", content=body.message)
    ai_msg = ChatMessage(session_id=body.session_id, role="assistant", content=reply)
    await db.chat_messages.insert_one(user_msg.dict())
    await db.chat_messages.insert_one(ai_msg.dict())

    # Update session title (first user msg) and updated_at
    update = {"updated_at": utc_now_iso()}
    if not history_rows:
        update["title"] = body.message.strip()[:40] or "New Chat"
    await db.chat_sessions.update_one({"id": body.session_id}, {"$set": update})

    return ChatResponse(
        session_id=body.session_id,
        user_message=user_msg,
        assistant_message=ai_msg,
    )


@api_router.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """Transcribe audio using OpenAI Whisper-1 via Emergent LLM key."""
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
        # result is a string when response_format="text"
        if isinstance(result, str):
            text = result.strip()
        else:
            text = getattr(result, "text", "") or str(result)
        return {"text": text.strip()}
    except Exception as e:
        logger.exception("Transcription failed")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
