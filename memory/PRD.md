# PRD — ORA OS (AI-Assistant)

## Source
- Repo: https://github.com/varunjakkampudi-tech/AI-Assistant (branch `main`)
- Local path: `/app`

## Architecture
- Backend: FastAPI (uvicorn :8001) + MongoDB (localhost:27017, db `nova_ai`)
- Frontend: Expo Router (React Native + Web) on port 3000, started with `--tunnel` so phones can scan the Expo Go QR
- Integrations: Amazon Bedrock Nova Lite, ElevenLabs voice, Google OAuth (Gmail + Calendar), Emergent LLM key for OpenAI Whisper transcription

## Sessions

### Session 1 — Setup & Expo Go (2026-01)
- Pulled latest `main` into `/app`, wired `backend/.env` (Bedrock, ElevenLabs, Google OAuth, Emergent LLM key, JWT, ADMIN_FERNET_KEY, ADMIN_EMAIL/PASSWORD) and `frontend/.env` (EXPO_PUBLIC_BACKEND_URL)
- Installed Python + Yarn deps, restarted services, generated fresh Expo Go QR
- New Google OAuth redirect URI: `https://6c0dc32d-86ea-4a74-83b6-05783617ecb7.preview.emergentagent.com/api/google/callback`

### Session 2 — Unified Cost Intelligence Platform (2026-01)
**New backend module:** `/app/backend/cost_intelligence.py` (~900 lines)
- Provider-agnostic `cost_events` collection (superset of legacy `admin_ai_usage`)
- `PRICING` catalogue covering 40+ providers/services: AI (Bedrock, OpenAI, Anthropic, Gemini, Azure, Groq, DeepSeek, Ollama), Voice (ElevenLabs, OpenAI TTS/STT, Google Speech, AWS Polly, Deepgram), Google APIs (Maps, Places, Geocoding, Directions, Gmail, Calendar, Drive, YouTube, Custom Search, Vision, Speech), Communications (Twilio, SendGrid, Resend, Mailgun, Firebase, OneSignal), Storage (S3, Cloudflare R2, GCS), Infrastructure (EC2, Lambda, RDS, Aurora, DynamoDB, Redis, CloudFront, Vercel, Railway, Render), Payments (Stripe, Razorpay, Apple IAP, Google Play)
- `log_cost_event()` helper — hooked into ElevenLabs TTS, OpenAI Whisper transcribe, Gmail recent, Calendar upcoming
- Endpoints (all under `/api/admin/intel/...`, super-admin guarded):
  - `GET /overview` — executive financial dashboard (MRR/ARR, costs, profit, margin, burn, runway, top drivers, daily series)
  - `GET /providers` — grouped by category with per-provider rollups + full provider catalog
  - `GET /features` — feature profitability (cost, revenue attributed, profit, margin)
  - `GET /users/top` — top users by cost / profit / risk with power & risk scoring
  - `GET /users/{user_id}` — single-user lifetime revenue / cost / profit / margin
  - `GET /google` — Google API service breakdown + key health
  - `GET /elevenlabs` — character / minute / cost / projected monthly / budget remaining
  - `GET/PUT/DELETE /budgets` — multi-scope budgets (global / provider / feature / user / plan / category)
  - `GET/POST/PATCH/DELETE /keys` + `POST /keys/{id}/rotate` — encrypted API key vault (Fernet) with monthly quota tracking
  - `GET /alerts` — auto-derived alerts (budget thresholds 50/75/90/100%, cost spike vs 7-day median, abnormal user usage > $5/24h, key quota crossings)
  - `GET /forecast` — projections (tomorrow / week / month / year), provider growth, expected margin, runway
  - `POST /ingest` — public ingest for external services / cron jobs
  - `GET /pricing` — read-only pricing table

**New frontend page:** `/app/frontend/app/admin/costs.tsx` (~470 lines)
- Renamed nav label from "Cost Center" → "Cost Intelligence"
- 10 tabs: Executive · Providers · Features · Users · Google APIs · ElevenLabs · Budgets · API Key Vault · Alerts · Forecast
- Time-window selector (7/14/30/90 days)
- Executive tab: KPI strip + daily cost vs revenue chart + category breakdown + top drivers
- Users tab: profitability table sortable by cost / profit / risk with power & risk badges
- Budgets tab: scope picker, inline edit, live spend % + status badges
- Keys tab: add/rotate/disable/delete with masked display + quota %
- Alerts tab: severity-coded cards
- Forecast tab: 4-window projection grid + provider growth ranking

## Current URLs
- Backend API: `https://6c0dc32d-86ea-4a74-83b6-05783617ecb7.preview.emergentagent.com`
- Admin Console: `https://6c0dc32d-86ea-4a74-83b6-05783617ecb7.preview.emergentagent.com/admin/sign-in`
- Cost Intelligence: `https://6c0dc32d-86ea-4a74-83b6-05783617ecb7.preview.emergentagent.com/admin/costs`
- Expo Go (scan from phone): `exp://s9xohte-anonymous-3000.exp.direct`
- Google OAuth redirect: `.../api/google/callback`

## Backlog / Next
- Real-time alert delivery channels (email via SendGrid, push, optional SMS via Twilio)
- Pricing table CRUD UI for super-admins (currently env-baked)
- Wire infrastructure cost (CloudWatch / Cost Explorer API) instead of estimates
- Per-user drill-down sub-page (route `/admin/costs/user/[id]`)
- CSV export of any cost intelligence table
