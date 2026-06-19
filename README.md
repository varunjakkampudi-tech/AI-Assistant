# Nova — Personal AI Assistant

Nova is a multi-feature personal AI assistant powered by Amazon Bedrock (Nova Lite), ElevenLabs (cloned voice), and Google (Gmail + Calendar). Built with **FastAPI + MongoDB** on the backend and **Expo Router (React Native + Web)** on the frontend.

## Implemented Features

| # | Feature | Backend module / API |
|---|---------|----------------------|
| 1 | Long-Term Memory (auto-extracted from chat) | `server.py:_extract_and_store_memories`, `/api/memories` |
| 2 | Daily Briefing (weather, calendar, email, goals, reminders, missed calls) | `/api/briefing`, `/api/chief/morning-briefing` |
| 3 | Smart Reminders (conditional) | `/api/reminders`, auto-created via `/api/chat` |
| 4 | Goal Tracking (with progress) | `/api/goals` |
| 5 | Google Calendar integration | `google_helper.py`, `/api/calendar/*` |
| 6 | Gmail integration | `/api/gmail/*` |
| 7 | Chat history, search, pin | `/api/sessions`, `/api/sessions/{id}/pin` |
| 8 | Voice input with interruptions (mic hold + transcription) | `/api/transcribe`, `expo-audio` |
| 9 | Emotion & context detection | `_classify_emotion`, `emotion` field on every user message |
| 10 | Notification ingestion + auto WhatsApp / reminder | `/api/notifications/ingest`, `_extract_and_execute_action` |

Bonus: Knowledge Vault (RAG), Personal Finance Brain, Digital Twin, AI Chief of Staff, mock phone calls.

---

## Run Locally

### Prerequisites
- **Python 3.11+**
- **Node 20+** with `yarn`
- **MongoDB 6+** running on `mongodb://localhost:27017`
- An **Amazon Bedrock** API key with access to `amazon.nova-lite-v1:0`
- An **ElevenLabs** API key + voice id (optional but recommended)
- A **Google OAuth** client (web type) — needed for Gmail/Calendar (optional)
- An **Emergent LLM key** (for OpenAI Whisper transcription) — get yours from [Emergent](https://app.emergent.sh/profile)

### 1. Clone & enter the repo
```bash
git clone https://github.com/varunjakkampudi-tech/AI-Assistant.git
cd AI-Assistant
```

### 2. Backend setup
```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Create `backend/.env`:
```env
MONGO_URL=mongodb://localhost:27017
DB_NAME=nova_ai
CORS_ORIGINS=*

# Amazon Bedrock (Nova Lite)
AWS_BEARER_TOKEN_BEDROCK=your_bedrock_bearer_token
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=amazon.nova-lite-v1:0

# Emergent LLM key (whisper-1 transcription)
EMERGENT_LLM_KEY=sk-emergent-xxxxxx

# ElevenLabs (voice cloning)
ELEVENLABS_API_KEY=sk_xxxxxxxx
ELEVENLABS_VOICE_ID=your_voice_id

# Google OAuth (Gmail + Calendar)
GOOGLE_CLIENT_ID=xxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxx
GOOGLE_REDIRECT_URI=http://localhost:8001/api/google/callback
```

> When running locally, register `http://localhost:8001/api/google/callback` as an authorized redirect URI in your [Google Cloud Console](https://console.cloud.google.com/apis/credentials).

Start the API:
```bash
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

### 3. Frontend setup
```bash
cd frontend
yarn install
```

Create `frontend/.env`:
```env
EXPO_PUBLIC_BACKEND_URL=http://localhost:8001
```

Start the web app:
```bash
yarn start          # serves at http://localhost:3000 (web)
# or
yarn ios            # iOS simulator
yarn android        # Android emulator
```

### 4. Open
- Web UI → http://localhost:3000
- API docs → http://localhost:8001/docs

---

## Architecture
```
┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
│  Expo Router UI  │  HTTPS │  FastAPI server  │   IO   │   MongoDB        │
│  (React Native   ├───────►│  /api/*          ├───────►│   nova_ai db     │
│   + Web)         │        │  uvicorn :8001   │        └──────────────────┘
└──────────────────┘        └────────┬─────────┘
                                     │
            ┌────────────────────────┼────────────────────────┐
            ▼                        ▼                        ▼
   ┌────────────────┐       ┌────────────────┐       ┌────────────────┐
   │ Amazon Bedrock │       │  ElevenLabs    │       │  Google APIs   │
   │  Nova Lite     │       │  TTS + voice   │       │  Gmail + Cal   │
   └────────────────┘       └────────────────┘       └────────────────┘
```

## Testing
```bash
# Backend (pytest)
cd backend && pytest -q
# 70 tests across test_nova_api.py + test_nova_phase1.py + test_nova_phase2.py
```

## Notes
- Phone calls (`/api/calls/*`, `/api/incoming-calls/*`) are **mocked** — no real telephony provider is wired. They simulate state in MongoDB so the UI flows can be exercised.
- The Google OAuth callback only works against the redirect URI registered in your OAuth client. For local development, use `http://localhost:8001/api/google/callback`.
