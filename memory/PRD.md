# Nova AI Assistant — PRD

## Overview
A mobile AI assistant for iOS and Android that lets users chat with **Amazon Nova Lite** (`amazon.nova-lite-v1:0` via Bedrock) using text **and** voice. Speech-to-text uses OpenAI Whisper, and replies are read aloud via on-device text-to-speech.

## Stack
- **Frontend**: Expo SDK 54, React Native, expo-router, expo-audio (recording), expo-speech (TTS), expo-blur (glass UI), expo-image, react-native-safe-area-context.
- **Backend**: FastAPI, Motor (MongoDB).
- **AI Models**:
  - Chat: `amazon.nova-lite-v1:0` via Bedrock Runtime Converse REST API (Bearer auth).
  - STT: OpenAI `whisper-1` through the Emergent LLM proxy.
  - TTS: device-native (`expo-speech`).

## Backend API (prefix `/api`)
- `POST /sessions` — create chat session
- `GET /sessions` — list sessions (most recent first)
- `GET /sessions/{id}/messages` — chronological messages for a session
- `DELETE /sessions/{id}` — delete session and its messages
- `POST /chat` `{session_id, message}` — send message, stores history, returns Nova reply
- `POST /transcribe` (multipart `file`) — transcribe an audio file (m4a/wav/mp3) via Whisper

## Screens
- **Chat (`/`)**: glass bottom input bar, mic button, glowing orb empty state, AI replies rendered as raw text with sparkle badge, user replies as pills, TTS toggle, new-chat button.
- **History (`/history`)**: list of past sessions with delete + open. Selected session highlighted in amber.

## Persistence
- AsyncStorage keeps the current `session_id` between launches.
- All sessions and messages are persisted in MongoDB collections `chat_sessions` and `chat_messages`.

## Permissions
- iOS `NSMicrophoneUsageDescription` and Android `RECORD_AUDIO` declared in `app.json`.

## Design System
"Glass / Luxe DARK" — antique-gold accents (`#E1B168`) on deep charcoal, Fraunces display serif for the AI persona, generous spacing, heavy blur on input bar.
