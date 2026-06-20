# ORA OS — Product Requirements Document

## Original Problem Statement
Cloned `varunjakkampudi-tech/AI-Assistant` (branch: main). Goal: run the existing ORA OS personal AI assistant (FastAPI + MongoDB + Expo Router) in this preview environment, then build a production-grade **Super Master Admin Console** on top — RBAC, executive dashboard, AI Model Control, cost tracking, feature flags, prompt management, billing/subscriptions, analytics, security, audit, notifications, configuration, system health, support — without breaking any existing functionality. Split into 3 phases.

## Tech Stack
- Backend: FastAPI + Motor (MongoDB) + JWT auth + Amazon Bedrock (Nova Lite) + ElevenLabs + Google OAuth + Emergent LLM key (whisper).
- Frontend: Expo Router (React Native + Web). Admin console lives at `/admin/*` (web-targeted, runs in the same app).
- Encryption: cryptography `Fernet` for provider secrets at rest.

## Architecture (Admin add-on)
- New module `/app/backend/admin_routes.py` mounted at `/api/admin/*` — all admin endpoints in one place.
- New collections: `admin_audit`, `admin_ai_providers`, `admin_feature_models`, `admin_ai_usage`, `admin_budgets`, `admin_feature_flags`, `admin_prompts`, `admin_subscriptions`, `admin_notifications`, `admin_config`, `admin_system_health`.
- Server startup hook now also calls `admin_routes.ensure_indexes(db)` and `admin_routes.bootstrap_defaults(db)` (seeds default plans + 15 feature flags + Bedrock provider stub + chat→nova-lite routing).
- `auth.py:seed_admin` upgrades the seeded account to `role=super_admin` so admin endpoints are reachable.
- Public-paths whitelist updated to include `/api/admin/login` (password-based admin login).

## User Personas
- **Super Admin** — full operational control: providers, models, prompts, feature flags, plans, config, role changes, deletions, audit visibility.
- **Admin** — day-to-day moderation: user suspend/ban, plan assignment, support tickets, analytics, audit read.
- **End User** — uses the existing ORA mobile/web app (unchanged).

## Phase 1 — Foundation + Dashboard + User Management + Security + Audit (DONE)
- [x] Admin password login (`POST /api/admin/login`) with JWT + session record + audit trail.
- [x] RBAC: `require_admin` / `require_super_admin` FastAPI deps.
- [x] Immutable audit log (`admin_audit`) — every admin action recorded (actor, ip, before/after, timestamp).
- [x] Executive dashboard endpoints (`/metrics/overview`, `/metrics/cost-series`).
- [x] User Management — list/filter, detail, status (active/suspended/banned), role, plan, revoke-sessions, cascade delete.
- [x] Security Center — failed logins, rate-limit hits, new-device logins, suspicious events.
- [x] Frontend admin shell + sign-in + Dashboard + Users + Security + Audit screens.

## Phase 2 — AI Model + Cost + Prompts + Feature Flags + Billing (DONE)
- [x] **AI Model Control Center** — Bedrock, OpenAI, Anthropic, Gemini, Azure, Groq, DeepSeek, Ollama (8 providers). API/secret keys encrypted (Fernet) at rest, masked on read.
- [x] **Per-feature model routing** with primary + fallback chain (`admin_feature_models`).
- [x] **AI Cost Center** — usage ingestion (`POST /ai/usage`), aggregation by provider/model/feature, monthly budget + 50/75/90/100 % alert thresholds + email-alert configuration.
- [x] **Prompt Management** — versioned, draft → publish → archive → rollback (with distinct audit action). Per-feature prompt keys.
- [x] **Feature Release Center** — 15 default flags, status (enabled/disabled/beta/internal/rollout), 0/10/25/50/75/100 % rollout slider, audience targeting.
- [x] **Billing snapshot** + **Subscription Plan editor** (free / pro / premium / enterprise with storage, token, upload, AI-req limits and feature list).
- [x] Frontend screens: AI Model Control, Cost Center, Prompts, Feature Flags, Billing & Plans.

## Phase 3 — Analytics + Notifications + Config + Health + Support (DONE)
- [x] **Analytics** — retention return-rate, repeat-user count, session duration avg/max, 7-day event volume.
- [x] **Notification Center** — channels: push / email / announcement / maintenance. Audiences: all / beta / premium / enterprise / selected. Announcements fan out into `db.notifications` so existing app screens can display them.
- [x] **Configuration Center** — app name, logo, primary/accent color, theme, support email/phone, privacy/terms/cookies URLs. Editable without deploy.
- [x] **System Health Snapshot** — frontend, backend, MongoDB ping, dbStats, AI provider status (presence-based; see backlog for live ping).
- [x] **Support Center** — ticket list (kind, subject, from, status), inline status change.

## What's Been Implemented (timeline)
- **2026-06-20** — Initial repo pulled & ran. Wrote `.env` for both backend & frontend, installed dependencies, generated Expo Go QR (`/app/frontend/expo-go-qr.png`) and `EXPO_GO.md`. Set new Google redirect URI to `https://83106ebd-c21f-4061-a350-cff01f36355d.preview.emergentagent.com/api/google/callback`.
- **2026-06-20** — Built complete Super Master Admin Console: backend (1.1 kloc `admin_routes.py`), frontend shell + sign-in + 13 admin screens, RBAC, audit, encryption, feature flags, prompt versioning, cost tracking, notifications, config. Seeded `admin@oraos.app / Admin@123456` super-admin. All 15 default feature flags + 4 default plans created on startup. **Backend tests: 32/32 passing** (per `iteration_10.json`). Existing user OTP / Expo-QR / chat flows verified untouched.

## Prioritized Backlog (P0 → P2)
- **P1** — Live provider health pings (cheap HEAD/GET per provider) in `/api/admin/health/snapshot`.
- **P1** — Wire the existing `/api/chat` to read the configured chat model from `admin_feature_models` (so model switching becomes live, not advisory).
- **P2** — Real Stripe / Razorpay billing (currently mocked MRR/ARR derived from plan_price × user_count). Add `estimated` badge in UI in the meantime.
- **P2** — Centralize `USER_SCOPED_COLLECTIONS` list (currently duplicated between `auth_routes.py` and `admin_routes.py`).
- **P2** — Split `admin_routes.py` (1173 lines) into per-domain modules: `admin/users.py`, `admin/ai.py`, `admin/prompts.py`, `admin/notifications.py`, `admin/config.py`.
- **P2** — Replace silent-catch in `audit()` with a fallback persistence path so we never lose audit immutability.
- **P2** — Email delivery worker for queued `admin_notifications` rows (push + email channels currently queue-only).
- **P3** — Split-test (A/B) framework on top of feature flags (rollout_pct already there; needs variant assignment).
- **P3** — Per-tenant rate limiting and API-key-based admin access for CI.

## Test Credentials
See `/app/memory/test_credentials.md`.

## URLs
- Backend: `https://83106ebd-c21f-4061-a350-cff01f36355d.preview.emergentagent.com`
- Admin Console: `…/admin` (sign in with super-admin creds)
- Expo Go QR: `/app/frontend/expo-go-qr.png` (tunnel host rotates on frontend restart)
- New Google redirect URI: `…/api/google/callback`
