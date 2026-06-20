# PRD — ORA OS (AI-Assistant)

## Source
- Repo: https://github.com/varunjakkampudi-tech/AI-Assistant (branch `main`)
- Local path: `/app`

## Goal of this session
Pull latest `main`, wire credentials into env files, start backend + Expo (tunnel), regenerate the Expo Go QR, and produce a fresh Google OAuth redirect URI for this preview container.

## Architecture
- Backend: FastAPI (uvicorn :8001) + MongoDB (localhost:27017, db `nova_ai`)
- Frontend: Expo Router (React Native + Web) on port 3000, started with `--tunnel` so phones can scan the Expo Go QR
- Integrations: Amazon Bedrock Nova Lite, ElevenLabs voice, Google OAuth (Gmail + Calendar), Emergent LLM key for OpenAI Whisper transcription

## What was done (2026-01)
- Pulled latest `main` into `/app` (already a clone of the user's repo)
- Created `/app/backend/.env` with: MONGO_URL, DB_NAME, Bedrock bearer + region + model, ElevenLabs key + voice id, Google client id/secret + redirect URI (new preview URL), Emergent LLM key, JWT secret
- Created `/app/frontend/.env` with `EXPO_PUBLIC_BACKEND_URL` pointing at the current preview backend
- Installed backend deps (`pip install -r requirements.txt`) and frontend deps (`yarn install`)
- Restarted `backend` and `frontend` via supervisor; both healthy
- Expo started with `--tunnel`; new tunnel host issued
- Regenerated `/app/frontend/expo-go-qr.png` with the new tunnel `exp://` URL
- Updated `/app/frontend/EXPO_GO.md` with new tunnel + backend + Google redirect URI

## Current URLs
- Backend API: `https://6c0dc32d-86ea-4a74-83b6-05783617ecb7.preview.emergentagent.com`
- Expo Go (scan from phone): `exp://s9xohte-anonymous-3000.exp.direct`
- Web preview: `https://s9xohte-anonymous-3000.exp.direct`
- **New Google OAuth redirect URI**: `https://6c0dc32d-86ea-4a74-83b6-05783617ecb7.preview.emergentagent.com/api/google/callback`

## Backlog / Next
- Validate Gmail + Calendar flow after the user registers the new redirect URI in Google Cloud Console
- Optional: pin the Expo tunnel host (or move to EAS Update) so QR doesn't change between restarts
