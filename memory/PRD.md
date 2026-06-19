# Nova / ORA OS — Personal AI Assistant

## Problem Statement
Pull the public GitHub repo `varunjakkampudi-tech/AI-Assistant` (branch `main`), wire up env keys (Google OAuth, AWS Bedrock Nova Lite, ElevenLabs), run the FastAPI backend + Expo Router frontend, expose an Expo Go tunnel and update `frontend/expo-go-qr.png` so a phone can scan and open the app. Provide the active `/api/google/callback` redirect URI.

## Stack
- Backend: FastAPI + MongoDB (`nova_ai` DB) on `0.0.0.0:8001`, supervised by supervisor.
- Frontend: Expo Router (React Native + Web) on `:3000`, supervised, `expo start --tunnel`.
- Integrations: Amazon Bedrock Nova Lite, ElevenLabs (voice id `Lr9nbI5Ax5lDTEobjoXE`), Google OAuth (Gmail + Calendar), Emergent LLM key for OpenAI whisper-1.

## Status (2026-06-19)
- ✅ Repo cloned (already in `/app`, branch `main`, up to date with `origin/main`).
- ✅ `/app/backend/.env` created with Bedrock, ElevenLabs, Google OAuth, Emergent LLM key, Mongo config.
- ✅ `/app/frontend/.env` created with `EXPO_PUBLIC_BACKEND_URL` pointing to preview ingress.
- ✅ Backend restarted, `/api/` returns `{"message":"ORA OS API","model":"amazon.nova-lite-v1:0"}`.
- ✅ Frontend (web) reachable at preview URL, `ORA OS` sign-in screen renders.
- ✅ Expo tunnel up: `https://o8qt3gs-anonymous-3000.exp.direct` → `exp://o8qt3gs-anonymous-3000.exp.direct`.
- ✅ `frontend/expo-go-qr.png` regenerated and decoded back to the exp:// tunnel URL.
- ✅ `/api/auth/google/start` returns a Google OAuth URL with the new redirect URI baked in.

## Redirect URI to register in Google Cloud Console
`https://b6a5a2d2-a117-4ee2-ad03-d56ceca85722.preview.emergentagent.com/api/google/callback`

## Expo Go QR
- File: `/app/frontend/expo-go-qr.png`
- Encoded URL: `exp://o8qt3gs-anonymous-3000.exp.direct`
- Tunnel HTTPS: `https://o8qt3gs-anonymous-3000.exp.direct`

## Backlog / Notes
- Phone-call endpoints are MOCKED in MongoDB (no real telephony).
- Tunnel URL changes when Expo restarts; regenerate QR via `python3 -c "import qrcode; qrcode.make('exp://<new>.exp.direct').save('/app/frontend/expo-go-qr.png')"`.
- Google OAuth requires the redirect URI above to be added to the OAuth client's “Authorized redirect URIs” list.
