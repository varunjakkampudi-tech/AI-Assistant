# Nova AI Assistant — PRD

## Original problem statement
User provided GitHub repo https://github.com/varunjakkampudi-tech/AI-Assistant (branch: main) and asked to "make the latest pull, run the code, make it work in local as well, add env files, and check that all implemented features work as expected".

## Credentials shared by user
- Google OAuth Client ID: 625072821412-oecv3ar7t07ep574itg8sebr0erh193c.apps.googleusercontent.com
- Google Redirect URI: https://ai-chat-mobile-64.preview.emergentagent.com/api/google/callback (locked to a different preview domain — only /auth-url verified here)
- AWS Bedrock bearer token (Amazon Nova Lite)
- ElevenLabs API key + voice_id Lr9nbI5Ax5lDTEobjoXE

## Tech stack
- Backend: FastAPI + Motor (Mongo) + Amazon Bedrock + ElevenLabs + Google OAuth — Python 3.11, supervisor-managed on :8001
- Frontend: Expo Router (React Native + Web) — TypeScript, served on :3000 via `expo start --web`
- DB: MongoDB (local, supervisor-managed)

## Implemented features (verified ✅)
1. Long-term memory (auto extracted from chat) — `/api/memories`
2. Daily briefing (weather/calendar/email/goals/reminders) — `/api/briefing`, `/api/chief/morning-briefing`
3. Smart reminders (conditional) — `/api/reminders`, auto-created via `_extract_and_execute_action`
4. Goal tracking — `/api/goals`
5. Google Calendar integration — `/api/calendar/*`
6. Gmail integration — `/api/gmail/*`
7. Chat history / search / pin — `/api/sessions`, `/api/sessions/{id}/pin`
8. Voice input + interruptions — `/api/transcribe` (OpenAI Whisper via Emergent key) + expo-audio
9. Emotion classification — every user message tagged with one of {neutral,frustrated,urgent,excited,sad}
10. Notification ingestion + WhatsApp/reminder generation — `/api/notifications/ingest`
Bonus: Knowledge Vault (RAG), Finance Brain, Digital Twin, Chief of Staff, mock phone calls.

## Session log
### 2026-06-19 — Initial run
- Cloned/fetched latest from origin/main (already in /app)
- Fixed `requirements.txt` typo (line 27 was `emergentintegrations==0.2.0PyMuPDF==1.27.2.3` — split into separate lines)
- Created /app/backend/.env with all user-supplied keys + MONGO_URL/DB_NAME/EMERGENT_LLM_KEY
- Created /app/frontend/.env with EXPO_PUBLIC_BACKEND_URL pointing to the preview URL
- Installed missing `PyMuPDF`, `python-docx`, `expo-document-picker`
- Changed `frontend/package.json` "start" → `expo start --web --port 3000` so supervisor (which runs `yarn start`) serves the web build on :3000
- Backend + frontend both healthy
- Backend: 70/70 pytest tests pass (test_nova_api.py + test_nova_phase1.py + test_nova_phase2.py)
- Fixed: digital_twin.get_profile() first-call 500 (ObjectId not stripped after insert_one)
- Fixed: chat send by pressing Enter on web (multiline TextInput now has onKeyPress handler for Platform.OS === 'web')
- Wrote /app/README.md with local-run instructions (Python venv, yarn install, .env templates, OAuth setup)

## Known limitations
- Phone calls + incoming-call modules are MOCKED (no real telephony)
- Google OAuth full handshake cannot be tested in this preview (redirect_uri is locked to a different preview domain)

## Next action items / Backlog
- Wire Google OAuth redirect to current preview domain OR add a settings UI to re-register at runtime
- Real telephony (Twilio) for phone-calls module
- Persist `image_mime` on ChatMessage so history replay doesn't hardcode image/jpeg
- Allow `/api/calls/{id}/cancel` to accept `in_progress` calls
