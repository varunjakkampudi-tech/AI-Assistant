# Nova AI Assistant — PRD

## Overview
A personal AI assistant for iOS / Android. Chat + voice with **Amazon Nova Lite** (`amazon.nova-lite-v1:0`), with auto-extracted long-term memory across all sessions, plus goal tracking, smart reminders, and a daily briefing.

## Stack
- **Frontend**: Expo SDK 54, React Native, expo-router, expo-audio, expo-speech, expo-image-picker, expo-location, expo-blur, expo-image, react-native-safe-area-context.
- **Backend**: FastAPI, Motor (MongoDB), httpx, emergentintegrations (Whisper).
- **AI / Data**:
  - Chat + vision: `amazon.nova-lite-v1:0` via Bedrock Runtime Converse REST API (Bearer auth).
  - Memory extraction: Nova with JSON output, run as a background task after every chat turn.
  - STT: OpenAI `whisper-1` via Emergent LLM proxy.
  - TTS: device-native (`expo-speech`).
  - Weather: Open-Meteo (no key).

## Capabilities

### Conversations
Multi-turn chat with persistent history, voice input (Whisper), voice output (TTS toggle), image attachments to Nova Lite, share transcript, prompt suggestion chips on empty state.

### History (`/history`)
Search · pin (pinned sessions float to top) · delete · resume any past conversation.

### Long-term Memory (`/memories`)
Auto-extracted facts in 8 categories (`person · project · goal · skill · meeting · date · preference · other`). Filter, search, manual delete. Memories are injected into Nova's system prompt for every future chat across all sessions.

### Goals (`/goals`)
Title + target + description, 0–100% progress bar with 10% steps, auto-complete on 100%. Active goals injected into Nova's context.

### Smart Reminders (`/reminders`)
Free-form text + optional condition (e.g. "after certification approval arrives"). Pending reminders surfaced to Nova so it can reference them naturally.

### Daily Briefing (`/briefing`)
Pull-to-refresh card with:
- Time-of-day greeting + name (auto-extracted from your memories).
- Weather (auto-detected via GPS, Open-Meteo).
- Pending reminders count + top 5.
- Active goals with progress bars.
- Upcoming dates from memories tagged `date` / `meeting`.
- Total conversation count.
- "Connect inbox & calendar" banner that explains exactly what OAuth credentials are needed for Gmail / Google Calendar / Outlook integration (Phase 2 follow-up).

## Backend API (prefix `/api`)
- `GET /` — model info
- Sessions: `POST /sessions`, `GET /sessions?search=`, `GET /sessions/{id}/messages`, `POST /sessions/{id}/pin`, `DELETE /sessions/{id}`
- Chat: `POST /chat` `{session_id, message, image_b64?, image_mime?}`
- Transcribe: `POST /transcribe` (multipart audio)
- Memories: `GET /memories?category=&search=`, `POST /memories`, `DELETE /memories/{id}`
- Goals: `GET /goals`, `POST /goals`, `PUT /goals/{id}`, `DELETE /goals/{id}`
- Reminders: `GET /reminders?status=`, `POST /reminders`, `PUT /reminders/{id}`, `DELETE /reminders/{id}`
- Briefing: `GET /briefing?lat=&lon=&tz_offset=`

## Persistence
MongoDB collections: `chat_sessions`, `chat_messages`, `memories`, `goals`, `reminders`. Active session id cached locally via AsyncStorage. No `_id` leaks.

## Permissions
iOS: `NSMicrophoneUsageDescription`, `NSLocationWhenInUseUsageDescription`. Android: `RECORD_AUDIO`, `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`.

## Design
"Glass / Luxe DARK" — antique-gold accents on deep charcoal, Fraunces display serif.

## Pending integrations (Phase 2.5)
Live **Gmail** / **Google Calendar** / **Outlook + Outlook Calendar** reads require user-supplied Google Cloud OAuth client (calendar.events + gmail.readonly + gmail.send scopes) or Azure AD app credentials. Briefing screen has a clear banner explaining this.
