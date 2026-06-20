# ORA OS — PRD

## Latest delta (2026-06-19)

### Mail / Notifications / Messages — view + delete everywhere
- **Backend (server.py)**
  - `GET  /api/gmail/messages/{id}` — fetch a single email with full body
  - `DELETE /api/gmail/messages/{id}` — move email to Trash (needs `gmail.modify` scope, now added in `google_helper.SCOPES`)
  - `DELETE /api/notifications` — clear all (or all of a `?kind=` filter)
- **google_helper.py**: `get_message_full`, `trash_message`, `gmail.modify` scope
- **Frontend**
  - `src/api.ts`: `gmailRecent`, `gmailGet`, `gmailTrash`, `clearNotifications`
  - `app/briefing.tsx`: recent emails are now Pressable rows; tap opens a detail modal with full body + “Move to Trash” button; inline trash icon on each row.
  - `app/notifications.tsx` (NEW) — kind tabs (All / Money / Messages / Other), tap to view in a modal, per-row delete and header-level Clear-all.
  - `src/components/MenuSheet.tsx`: links to `/notifications` under DAILY.

### Auth
- Backend `.env` now sets `JWT_SECRET` so Google OAuth login can mint tokens (fixes the `500: Server misconfigured: JWT_SECRET missing` error seen earlier).
- Because Gmail scope changed to include `gmail.modify`, **users who connected Google before this delta must disconnect Google in Briefing and reconnect** before delete-mail works (Google won't auto-upgrade scopes on existing refresh tokens).

### Career Copilot (already implemented in repo — verified intact)
- Resume upload (`POST /api/career/profile/parse-resume`) — PDF / DOCX / TXT, Bedrock parses → fills profile.
- One-click apply (`POST /api/career/jobs/{id}/apply`) — auto-generates tailored resume + cover letter, marks `applied`.
- Auto-apply toggle (`PUT /api/career/profile/auto-apply`) on Profile tab with min-match score.
- Sync radar (`POST /api/career/sync`) pulls from Greenhouse / Lever.

### Expo Go
- Tunnel: `https://o8qt3gs-anonymous-3000.exp.direct`
- QR file (updated): `/app/frontend/expo-go-qr.png` → encodes `exp://o8qt3gs-anonymous-3000.exp.direct`
- Backend preview: `https://b6a5a2d2-a117-4ee2-ad03-d56ceca85722.preview.emergentagent.com`
- Google redirect URI to keep registered: `…/api/google/callback`

## Stack
- FastAPI + MongoDB (`nova_ai`) on `:8001` (supervisor)
- Expo Router on `:3000` with `expo start --tunnel`
- Bedrock Nova Lite · ElevenLabs · Google (Gmail readonly + send + **modify** + Calendar) · Emergent LLM key

## Backlog
- Permanent “delete forever” option (currently only Trash) — needs separate UI confirmation.
- Bulk-select on notifications screen.
- Live test of Gmail trash + resume upload requires the user’s Google account (couldn’t E2E here).
- Phone-call endpoints remain MOCKED.
