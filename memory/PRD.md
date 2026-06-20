# ORA OS — Run Setup Log

## Repo
- Cloned from https://github.com/varunjakkampudi-tech/AI-Assistant (branch: main)
- Project: ORA OS (Nova personal AI assistant) — FastAPI + MongoDB backend, Expo (React Native + Web) frontend.

## Environment Configured (Jan 2026 run)
- backend/.env created with provided AWS Bedrock, ElevenLabs, Google OAuth, JWT, plus Emergent LLM key (whisper).
- frontend/.env: EXPO_PUBLIC_BACKEND_URL + REACT_APP_BACKEND_URL pointing to the current preview backend.
- pip install --no-deps applied to sidestep an unrelated litellm/emergentintegrations resolver conflict (both versions already preinstalled).
- yarn install completed in /app/frontend.
- Supervisor restarted backend + frontend; both RUNNING.

## URLs
- Backend (preview): https://83106ebd-c21f-4061-a350-cff01f36355d.preview.emergentagent.com
- New Google OAuth redirect URI: https://83106ebd-c21f-4061-a350-cff01f36355d.preview.emergentagent.com/api/google/callback
- Expo Go tunnel: exp://txkle7a-anonymous-3000.exp.direct
- Expo Web tunnel: https://txkle7a-anonymous-3000.exp.direct

## Artifacts
- /app/frontend/expo-go-qr.png — refreshed QR (scan with Expo Go).
- /app/frontend/EXPO_GO.md — short doc with the URLs.

## Next Action Items
- Add the new redirect URI in Google Cloud Console → OAuth client → Authorized redirect URIs.
- Restart frontend if the Expo tunnel host changes and regenerate the QR with the new host.
