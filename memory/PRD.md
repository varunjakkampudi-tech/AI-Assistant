# ORA OS — Product Requirements Document

> **Working name:** ORA OS · Final name to be confirmed within 2 days.
> Previously known internally as **Nova**. Renamed everywhere to `ORA` / `ORA OS`.

## Original problem statement

Build a mobile app from the existing GitHub repo `varunjakkampudi-tech/AI-Assistant` (main branch). Run on Expo Go. UI should match the supplied 9-screen design (and be even better, end-user friendly). First version going to App Store / Play Store. Make it production-ready and SEO/ASO optimized.

## Architecture

- **Frontend:** Expo Router 6 (React Native 0.81 + Web), TypeScript, dark theme with antique-gold accents.
  - Bottom-tab navigation: **Home · Timeline · Ask · Vault · You** (custom blur tab bar with glowing center Ask button).
  - Display font: Fraunces. Text font: system (clean, neutral).
- **Backend:** FastAPI on `:8001`, MongoDB (`ora_os` db), prefixes all routes with `/api`.
  - LLM: Amazon Bedrock — `amazon.nova-lite-v1:0`.
  - Voice TTS: ElevenLabs cloned voice (id `Lr9nbI5Ax5lDTEobjoXE`).
  - STT: OpenAI `whisper-1` via Emergent LLM key.
  - OAuth: Google (Gmail + Calendar, optional).
- **Supervisor-managed:** backend, frontend, mongodb. Expo Go via `yarn start --tunnel` (already wired).

## User personas

1. **Varun-the-operator** — wants a single screen each morning summarizing the day. Voice-first.
2. **Career switcher** — pastes JD links, gets resume + cover letter + interview kit.
3. **Quantified-self** — logs sleep / steps / weight, wants streaks and trends.
4. **Memory-light** — chats with the assistant, expects it to remember names and projects.

## Core requirements (static)

- Bottom-tab nav matching screenshot (5 tabs, glowing center Ask).
- Home: greeting + halo orb + priorities + 2×2 overview + quick actions + insights teaser.
- Ask: voice-first chat with cloned-voice TTS playback.
- Timeline: chronological feed with All/Chat/Email/Calendar/Finance filters.
- Vault (Memory): People/Projects/Goals/Dates from auto-extracted memories.
- You: profile, integrations, deep links into all secondary screens.
- All other screens (Briefing, Finance, Health, Career, Goals, Reminders, Chief, Life OS, Journal, Knowledge, Graph, Family, Twin, Calls, Dashboard, History, Search, Sign-in) accessible from the You tab as a stack.
- Production-grade ASO copy (see `/app/ASO.md`).

## What's been implemented (v1, Jan 2026)

- ✅ Renamed `Nova` → `ORA` / `ORA OS` across frontend (`app.json`, MenuSheet, chat header/strings, all secondary screens) and the backend system prompt + root API message.
- ✅ Bottom-tab navigation with custom blur tab bar and glowing center Ask FAB.
- ✅ New Home screen exactly matching screenshot 1 — greeting + animated halo + priorities card + 2×2 overview (Messages/Events/Tasks/Focus Score) + Quick Actions row + Insights teaser.
- ✅ New Vault (Memory) screen with All/People/Projects/Goals/Dates filters and people/projects/dates sections.
- ✅ New You screen with profile card, Google connect, ORA OS stats, and grouped deep links into all secondary features.
- ✅ Redesigned Timeline tab with filter chips (All/Chat/Email/Calendar/Finance) and color-coded event rail.
- ✅ Ask tab inherits the original cinematic chat with renamed strings, cloned-voice TTS, mic, image attach.
- ✅ ASO/SEO: rich `+html.tsx` head (Open Graph, Twitter card, theme-color, app title); ASO listing copy at `/app/ASO.md`.
- ✅ Backend wired with provided AWS Bedrock, ElevenLabs, Google OAuth and Emergent LLM keys. Backend running clean (no startup errors).
- ✅ MongoDB switched to `ora_os` database.

## Mocked / partially implemented

- 📞 Phone calls (`/api/calls/*`, `/api/incoming-calls/*`) — MOCKED telephony, no real provider wired (per upstream README).
- 🏦 Banking — auto-detection from Gmail emails is real (when Google is connected); no direct bank API integration.
- ⚠️ Google OAuth redirect URI in backend `.env` is set to the *current preview URL*. The OAuth client provided by the user may need its authorized redirect URI updated in Google Cloud Console to `https://221e78fe-2385-4da2-90f3-63d5ce6338fc.preview.emergentagent.com/api/google/callback` for OAuth to complete.

## Prioritized backlog (after v1)

P0
- App-store icon + adaptive icon final art and splash screen artwork.
- Wire pixel-perfect Insights screen (screenshot 3) with All/Work/Health/Finance/Career chips on top of existing `/dashboard` data.
- E2E test of Google OAuth happy path on Expo Go.

P1
- Notification ingestion native module for live transaction capture (Android).
- Push notifications via Expo Push for missed-call reminders.
- Pixel-tight Health and Career screens matching screenshots 5 & 6.

P2
- Real telephony provider (Twilio / Vonage) replacing the mocked call manager.
- Apple Sign-in (mandatory for App Store if Google is offered).
- Family Hub: shared calendar / shared memory.

## Next action items

1. User to update the Google OAuth client's authorized redirect URI to the current preview URL.
2. Confirm final app name (placeholder is `ORA OS`).
3. Run testing agent for full backend regression + key UI flows.
