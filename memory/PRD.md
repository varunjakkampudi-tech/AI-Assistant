# ORA OS — Product Requirements Document

> **Working name:** ORA OS · Final name confirmation pending.
> Built on top of the existing `AI-Assistant` repo (rebranded from Nova).

## Architecture (current)

- **Frontend:** Expo Router 6 (React Native + Web). Bottom-tab nav (Home · Timeline · Ask · Vault · You) with a custom blur tab bar and glowing centre Ask FAB. Display: Fraunces. Tokens persisted in **expo-secure-store**. Theme: light / dark / system.
- **Backend:** FastAPI on `:8001`, MongoDB (`ora_os` db). All `/api/*` routes are **gated** behind a Bearer access-token except a small public whitelist. JWT (`HS256`, 12h access + 30d refresh w/ `jti`-bound refresh tokens).
- **Integrations:** Amazon Bedrock (`amazon.nova-lite-v1:0`), ElevenLabs cloned voice (`Lr9nbI5Ax5lDTEobjoXE`), OpenAI Whisper STT (via Emergent LLM key), Google OAuth (Gmail + Calendar), **Resend** for transactional email (free tier 3k / month) with a dev fallback when `RESEND_API_KEY` is blank.

## v1.2 (this iteration — Jun 19 2026)

- Restored `backend/.env` and `frontend/.env` (preview pod swap erased them). All keys re-populated, redirect URI re-pointed to the active preview host.
- **Expo Go QR is now live**: `/api/expo-qr` resolves the rotating Metro tunnel host via Metro's `/` manifest + ngrok local API and regenerates `/api/expo-qr/png` against the active `exp://` URL on every request. Frontend's static fallback (`/app/frontend/expo-go-qr.png`) regenerated too.
- **Real light theme**: new `useColors()` hook in `src/auth.tsx` returns the active palette (`darkColors` / `lightColors` from `src/theme.ts`). Converted Sign-in, Home tab, You tab, Settings, Security Center, Help, Tabs layout, ScreenHeader, and root `_layout.tsx` to react to it. Status bar style follows theme. Default preference now `dark` to match the brand identity.
- **Home top bar polish**: added centred `ORA OS` wordmark (`data-testid=home-brand`) and replaced the generic person icon in the avatar pill with the signed-in user's uppercase initial (`data-testid=home-avatar-initial`).
- 31/31 backend tests still pass. Testing agent confirmed 100% on the OTP sign-in → Home → Settings (theme toggle) → Security Center → You tab flows.

## v1.0 (shipped earlier this session)

- Rebrand Nova → ORA OS across frontend, backend, system prompt, app.json.
- Bottom-tab navigation with custom blur tab bar + glowing center Ask FAB.
- Home, Ask, Timeline, Vault (Memory), You tabs all built to match the supplied 9-screen design.
- ASO/SEO metadata, `+html.tsx` Open Graph + Twitter card.
- 21/21 backend tests pass.

## v1.1 (shipped now — Auth, Security, Privacy, Theme, Help, Expo QR)

### Authentication
- **Email OTP** (passwordless, 6-digit, 10-min expiry). Backed by Resend; dev-fallback returns the code in the response when `RESEND_API_KEY` is blank.
- **Continue with Google** — opens auth in `WebBrowser.openAuthSessionAsync`, polls a server-side handoff record for the issued JWT.
- **Sign in with Apple** — button rendered with a `SOON` tag; backend returns a friendly 501 (needs iOS native build to enable).
- JWT bundle: `access_token` (12h) + `refresh_token` (30d, `jti`-bound to a `login_sessions` doc — revocation works).
- **OTP brute-force protection**: per-email failure counter that survives re-requests; 5 wrong attempts → 15-min cool-down → 429 on `/auth/otp/request`.

### Security center
- **Active sessions** list with device label, browser, IP, last-seen. Sign-out per session or all-at-once.
- **Audit log** (last 50 events): `login.email_otp`, `login.google`, `logout`, `logout.all`, `otp.requested`, `otp.failed`, `otp.rate_limited`, `session.revoked`, `session.revoked_all`, `account.exported`, `account.deleted`.
- **Breach detection**: when a sign-in happens on a *never-seen* device label, an email security alert is sent (no-op if Resend not configured but the in-app audit event is logged).

### Privacy & compliance
- Static legal pages served by FastAPI: `/api/legal/privacy`, `/api/legal/terms`, `/api/legal/cookies` (HTML, dark themed, store-submission ready).
- **AI Data Usage** toggle (default OFF). Stored in `user_settings.ai_data_usage`.
- **Cookie preferences**: Essential (always on), Analytics (off), Marketing (off). User can flip.
- **Export my data** — `POST /api/account/export` returns the full per-user JSON of every collection.
- **Permanent account deletion** — `POST /api/account/delete` sweeps 22 collections by `user_id` then deletes the user record.

### Appearance & UX
- Theme toggle: Light / Dark / System. Persisted in AsyncStorage and synced to backend `user_settings.theme`.
- Sign-in screen with hero orb, three methods, legal links, dev-code hint.
- Settings, Security, Help screens fully styled with `ScreenHeader` back-nav.

### Help & Support
- `/api/support/faq` — 6 FAQ items (private data, sign-in, AI training opt-in, export, delete, Google).
- `/api/support/contact` — sends a styled email to the support inbox.
- Email + Phone contact cards plus a Bug / Feature toggle on the in-app form.

### Expo QR / Install card
- `/api/expo-qr` returns app metadata and a `qr_image_url`.
- `/api/expo-qr/png` generates a QR (uses `qrcode` Python lib in-process; falls back to public `api.qrserver.com` if Pillow is missing).
- You-tab "Open on phone" card displays the QR, plus iOS + Android Expo Go install buttons.

### Encryption / storage
- All traffic over HTTPS/TLS (via the ingress).
- Tokens stored on the device with **expo-secure-store** (Keychain / EncryptedSharedPrefs).
- Database at rest: relies on the platform Mongo's storage-level encryption.
- OAuth + API keys never returned in any response.

### Multi-tenant data isolation
- v1.1 introduces a **global Bearer-token gate** on all `/api/*` endpoints except a 7-route whitelist. Until v1.2, the gate alone enforces isolation (only the authenticated owner can access any data endpoint).
- v1.2 (next) will retrofit `user_id` filters on the 14 existing data collections (`chat_sessions`, `chat_messages`, `memories`, `goals`, `reminders`, `journal_entries`, `health_logs`, `transactions`, `notifications`, `jobs`, `career_profile`, `knowledge_docs`, `knowledge_chunks`, `phone_calls`).

## Testing

- **v1.0 backend**: 21/21 pass (`test_ora_os_api.py` — now stale due to auth-gate, kept for reference).
- **v1.1 backend**: 31/31 pass (`test_auth_v11.py` — full auth, security, settings, export/delete, Expo QR, legal, support flow). One identified minor — OTP-lockout-bypass — was fixed and verified manually via curl after the run.

## Mocked / partial

- **Apple Sign-In** — button visible, real flow blocked on iOS native build.
- **Phone calls** — `/api/calls/*` and `/api/incoming-calls/*` are MOCKED telephony (inherited from upstream).
- **Multi-user data scoping** — v1.1 protects via auth gate, full row-level `user_id` scope arrives in v1.2.
- **Resend** — current `RESEND_API_KEY=` is intentionally blank so v1 incurs **zero email cost**; OTP codes return in the API response under `dev_code` for testing. Add a real key before public launch.

## ⚠️ Action required from user

1. Update the Google OAuth client's authorized redirect URI to:
   `https://ora-expo-deployment.preview.emergentagent.com/api/google/callback`
2. Confirm final app name (placeholder is `ORA OS`).
3. Before public launch: register `oraos.app` (or your final domain), then verify it with Resend so emails are delivered from a branded sender. Until then, the dev fallback keeps the OTP flow testable for free.
4. Privacy policy URL for store submission: use `https://<your-domain>/api/legal/privacy` (already live on the preview).

## Prioritized backlog

P0 (v1.2)
- Retrofit `user_id` filter on the 14 existing data collections.
- Real Resend domain + API key (move dev fallback behind a feature flag).
- Apple Sign-In wiring on a real iOS build.

P1
- Pixel-tight Insights and Health screens to match screenshots 3 & 5 frame-perfectly.
- Push notifications via Expo Push for breach alerts and missed-call reminders.
- Email-export download (currently just an alert; build a "share JSON" sheet via expo-sharing).

P2
- Apple Sign-In, Sign-in with passkeys.
- Family Hub: shared calendar / shared memory across users.
- Bring-your-own-OpenAI / Bring-your-own-Anthropic keys.
