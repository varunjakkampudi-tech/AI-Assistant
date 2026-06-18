# Nova AI Assistant — PRD

## Overview
A personal AI assistant for iOS / Android. Chat + voice with **Amazon Nova Lite** (`amazon.nova-lite-v1:0`), powered by an extracted long-term memory store so the assistant **remembers people, projects, goals, dates and preferences** across every conversation.

## Stack
- **Frontend**: Expo SDK 54, React Native, expo-router, expo-audio, expo-speech, expo-image-picker, expo-blur, expo-image, react-native-safe-area-context.
- **Backend**: FastAPI, Motor (MongoDB), httpx, emergentintegrations (Whisper).
- **AI**:
  - Chat + vision: `amazon.nova-lite-v1:0` via Bedrock Runtime Converse REST API (Bearer auth).
  - Memory extraction: same Nova model, structured JSON output, run as a background task after each chat turn.
  - STT: OpenAI `whisper-1` via Emergent LLM proxy.
  - TTS: device-native (`expo-speech`).

## Capabilities

### Conversations
- Multi-turn chat with conversation history persisted in MongoDB.
- Image attachments — send a photo with your message; Nova Lite is multimodal and replies about the image.
- Voice input (hold-to-record → Whisper → Nova) and voice output (auto-TTS for replies, toggleable).
- Suggestion chips on the empty state for quick starts.
- Share full transcript via native iOS/Android share sheet.

### History (`/history`)
- Search conversations by title (case-insensitive).
- Pin/unpin sessions — pinned conversations float to the top.
- Delete sessions (cascades message deletion).
- Tap a row to resume; the chat screen rehydrates the full transcript with context preserved.

### Long-term Memory (`/memories`)
- After every chat turn, Nova analyses the exchange and extracts durable facts into one of 8 categories:
  `person · project · goal · skill · meeting · date · preference · other`
- Memories are auto-injected into the system prompt of every subsequent chat (in any session).
- Filter by category, search by subject/content, delete manually. Manual create via `POST /api/memories`.

### Goals (`/goals`)
- Title + target + description, with a 0–100% progress bar (10% step buttons).
- Auto-completes when progress hits 100%. Toggle status (active / paused / completed).
- Active goals are injected into Nova's system prompt so Nova proactively references them.

### Smart Reminders (`/reminders`)
- Free-form `text` plus an optional `condition` ("after AWS certification approval arrives").
- Status: pending · done · dismissed.
- Pending reminders are injected into Nova's system prompt; Nova will surface them naturally if the conversation makes them relevant.

## Backend API (prefix `/api`)
- `GET /` — model info.
- Sessions: `POST /sessions`, `GET /sessions?search=`, `GET /sessions/{id}/messages`, `POST /sessions/{id}/pin`, `DELETE /sessions/{id}`.
- Chat: `POST /chat` `{session_id, message, image_b64?, image_mime?}` — full memory + goal + reminder context injection; background memory extraction.
- Transcribe: `POST /transcribe` (multipart audio).
- Memories: `GET /memories?category=&search=`, `POST /memories`, `DELETE /memories/{id}`.
- Goals: `GET /goals`, `POST /goals`, `PUT /goals/{id}`, `DELETE /goals/{id}`.
- Reminders: `GET /reminders?status=`, `POST /reminders`, `PUT /reminders/{id}`, `DELETE /reminders/{id}`.

## Persistence
MongoDB collections: `chat_sessions`, `chat_messages`, `memories`, `goals`, `reminders`. Active session id cached locally via AsyncStorage. No `_id` leaks anywhere.

## Permissions
iOS `NSMicrophoneUsageDescription` + Android `RECORD_AUDIO`; expo-image-picker auto-handles photo permission on Android 13+.

## Design
"Glass / Luxe DARK" — antique-gold accents (`#E1B168`), Fraunces serif for the persona, deep charcoal surfaces, heavy blur on the bottom input bar.

## Out of scope (Phase 2)
Daily briefing (weather/news), Google Calendar + Gmail, Microsoft Outlook + Outlook Calendar integration — gated on user-provided OAuth credentials.
