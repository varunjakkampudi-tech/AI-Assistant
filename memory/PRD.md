# Nova AI Assistant — PRD

Original goal: A personal AI assistant for iPhone (Expo Go) wired to:
- Amazon Bedrock (Nova Lite) for chat
- ElevenLabs (cloned voice) for TTS
- Google (Gmail + Calendar) for inbox + calendar
- MongoDB for persistence
with maximum automation — the user explicitly does NOT want to add things manually.

## What's implemented (Jan 2026)

### Core
- Backend (FastAPI on :8001) + Frontend (Expo Router on :3000, tunnel for Expo Go)
- Bedrock Nova Lite chat with image attachments, emotion classifier, action extractor
- ElevenLabs TTS with cloned voice `Lr9nbI5Ax5lDTEobjoXE`
- Google OAuth (Gmail readonly + send, Calendar events + readonly) — redirect at
  `https://fad3ac7a-29f3-4ff4-9308-a594d29114dc.preview.emergentagent.com/api/google/callback`
- Voice transcription via Whisper-1 (Emergent LLM key)
- Memory auto-extraction from every chat (background task)

### Automated user-data ingestion
- **Personal Finance Brain**: `GmailFinanceScanner` parses bank/UPI/credit-card emails
  every time briefing loads (rate-limited 1/hr) and on Sync-Now button. Dedup by Gmail msg id.
- **Digital Twin**: Auto-learns from every `/api/chat` user message (background).
  Frequent contacts learned from Gmail senders during finance sync.
- **AI Chief of Staff**: Pulls calendar + Gmail + goals + reminders + missed calls.
- **Briefing**: weather + Google + memories + missed calls. 5s GPS timeout fix for iOS 26.

### Newly built (priority features)
- **Life OS Timeline** (`/api/timeline`, `/timeline/on-this-day`, `/timeline/range`)
  Aggregates chats / memories / goals / reminders / transactions / calls / voice notes
  / knowledge docs / health logs / calendar / Gmail for any date.
- **AI Journal** (`/api/journal/generate`, `/journal`, `/journal/{date}`)
  Bedrock writes a daily narrative + wins + mistakes + mood + highlights in user's voice
  (uses Digital Twin style prompt).
- **Knowledge Graph** (`/api/graph`, `/graph/related?q=`)
  Nodes from memories/goals/docs/contacts/spending; edges from co-mentions.
- **Health Intelligence** (`/api/health/log`, `/health/summary`, `/health/logs`)
  Sleep/water/workout/steps/weight/mood/calories, streaks, trend detection, insights.
- **Family Hub** (`/api/family`) — auto-detects family members from chats + dates.
- **Companion Nudges** (`/api/companion/nudges`) — habit-aware suggestions
  surfaced in Chief of Staff (sleep, stuck goals, big spend, time machine).

### Frontend screens added
- `/timeline` (Life Timeline + Memory Time Machine)
- `/journal` (AI Journal with auto-generate button)
- `/health` (quick log + insights + streaks)
- `/graph` (Knowledge Graph + "show everything related to ___" search)
- `/family` (Family Hub)
- `/finance` redesigned around Gmail auto-sync (no manual entry)

## Out of scope this iteration
- Offline AI Mode (would require an on-device LLM — not viable inside Expo Go)
- Native HealthKit / Google Fit auto-ingestion (manual logging UI ships first;
  Apple Health bridge would need a dev-client native build, not Expo Go)
- Live graph visualisation with force-directed layout (current list view is functional)

## Next actions / backlog
- Push-style proactive nudges (notifications when new nudge fires)
- HealthKit native bridge for auto sleep/steps
- WhatsApp + SMS ingestion (currently only Gmail)
- Voice journal mode: speak the day, AI transcribes + writes
