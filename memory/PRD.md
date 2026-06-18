# Nova AI Assistant — PRD

## Overview
A personal AI assistant for iOS / Android. Chat + voice with **Amazon Nova Lite** (`amazon.nova-lite-v1:0`), with auto-extracted long-term memory across all sessions, goal tracking, smart reminders, a daily briefing, and live **Gmail + Google Calendar** integration powered by Google OAuth.

## Capabilities

### Conversations + Voice
Multi-turn chat with persistent history, voice input (Whisper), voice output (TTS toggle), image attachments to Nova Lite (multimodal), share transcript, prompt-suggestion chips.

### Natural-language actions (executed automatically)
When you say things like:
- "**Schedule a meeting with Aruna tomorrow at 3 PM IST**" → Nova replies + creates a Google Calendar event on your primary calendar.
- "**Reply to my last email about deployment with a short professional confirmation**" → Nova replies + sends a Gmail message (when Google is connected).
- "**Remind me to submit reimbursement after AWS certification approval arrives**" → Nova replies + persists a new reminder with the condition.

If Google isn't connected, Nova tells you so honestly and points to Daily Briefing → Connect Google.

### History
Search · pin (pinned float to top) · delete · resume any past conversation.

### Long-term Memory
Auto-extracted facts across 8 categories injected into Nova's system prompt for every future chat.

### Goals / Reminders
Track active goals with progress bars; conditional reminders surfaced into Nova's context.

### Daily Briefing
Pull-to-refresh card with:
- Greeting + remembered name.
- Weather (Open-Meteo via GPS).
- Pending reminders, active goals with progress, upcoming dates from memories.
- **Upcoming Google Calendar events** (when connected).
- **Recent Gmail inbox** (subject / sender / snippet, unread markers).
- **Connect Google** button — opens the consent flow inside the app (`expo-web-browser`).

## Backend API (prefix `/api`)
- `GET /` — model info
- Sessions, Chat, Transcribe (as before)
- Memories, Goals, Reminders (as before)
- Briefing: `GET /briefing?lat=&lon=&tz_offset=`
- **Google**: `GET /google/auth-url`, `GET /google/callback?code=`, `GET /google/status`, `POST /google/disconnect`
- **Gmail**: `GET /gmail/recent?limit=`, `POST /gmail/send` `{to, subject, body}`
- **Calendar**: `GET /calendar/upcoming?limit=`, `POST /calendar/events` `{summary, start_iso, end_iso, description}`

## Stack
- Frontend: Expo SDK 54, expo-router, expo-audio, expo-speech, expo-image-picker, expo-location, expo-blur, expo-web-browser.
- Backend: FastAPI, Motor (MongoDB), httpx.
- AI: `amazon.nova-lite-v1:0` (chat + vision + intent extraction + memory extraction), OpenAI `whisper-1` for STT.

## Persistence
MongoDB collections: `chat_sessions`, `chat_messages`, `memories`, `goals`, `reminders`, `integrations`. Active session id cached locally. No `_id` leaks.

## Auth & OAuth
Single-user app. Google OAuth flow stores `{access_token, refresh_token, expires_at, email, name}` in the `integrations` collection under `id="google"`. Tokens auto-refresh on every API call when the access token has < 60s remaining.

## Permissions
iOS: `NSMicrophoneUsageDescription`, `NSLocationWhenInUseUsageDescription`. Android: `RECORD_AUDIO`, `ACCESS_*_LOCATION`.

## Design
"Glass / Luxe DARK" — antique-gold accents (#E1B168) on deep charcoal, Fraunces display serif.

## Code & deploy
- Push to GitHub via the Emergent UI's **Save to GitHub** button (top-right of the workspace).
- Publish via the **Publish** button to generate iOS/Android builds.
