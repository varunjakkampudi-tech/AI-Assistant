"""
Auth + security + settings + legal HTTP routes.

Exposes a single APIRouter that the main app should include with prefix='/api'.

Endpoints:
  POST /auth/otp/request           — start email OTP
  POST /auth/otp/verify            — complete email OTP -> tokens
  GET  /auth/google/start          — returns Google auth URL + nonce (handoff)
  GET  /auth/google/poll/{nonce}   — poll handoff for tokens
  POST /auth/apple/start           — currently returns 501 with friendly message (stub)
  GET  /auth/me                    — current user
  POST /auth/refresh               — issue new access token from refresh
  POST /auth/logout                — revoke current session
  POST /auth/logout-all            — revoke all sessions

  GET  /settings                   — user settings
  PUT  /settings                   — update user settings (theme, ai_data_usage, cookies)
  GET  /security/sessions          — list active login sessions
  POST /security/sessions/{id}/revoke
  POST /security/sessions/revoke-all
  GET  /security/audit             — last 50 audit events
  POST /account/export             — export user data (returns inline JSON)
  POST /account/delete             — permanently delete account + all data

  GET  /support/faq                — FAQ entries
  POST /support/contact            — file a support email (uses Resend if configured)
"""
from __future__ import annotations
import os
import uuid
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional, List

from fastapi import APIRouter, Depends, HTTPException, Request, Body
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from pydantic import BaseModel, EmailStr, Field

import auth as auth_mod
import security as sec
import email_service as email_svc
import google_helper as gh

logger = logging.getLogger(__name__)

router = APIRouter()

# Per-user collection names that the account-delete endpoint should sweep.
USER_SCOPED_COLLECTIONS = [
    "chat_sessions", "chat_messages",
    "memories", "goals", "reminders",
    "journal_entries", "health_logs",
    "transactions", "notifications",
    "jobs", "career_profile",
    "knowledge_docs", "knowledge_chunks",
    "phone_calls", "incoming_calls", "missed_call_reminders",
    "digital_twin_profile", "user_settings",
    "login_sessions", "audit_events",
]


def get_db(request: Request):
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise HTTPException(500, "DB not configured")
    return db


async def require_user(request: Request) -> Dict[str, Any]:
    db = get_db(request)
    return await auth_mod.current_user(request, db)


def _client_ip(request: Request) -> Optional[str]:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


# ==================== Models ====================
class OTPRequest(BaseModel):
    email: EmailStr


class OTPVerify(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=8)


class RefreshReq(BaseModel):
    refresh_token: str


class SettingsBody(BaseModel):
    theme: Optional[str] = None             # "light" | "dark" | "system"
    ai_data_usage: Optional[bool] = None    # opt-in default False
    cookies_essential: Optional[bool] = None
    cookies_analytics: Optional[bool] = None
    cookies_marketing: Optional[bool] = None
    notifications_email: Optional[bool] = None
    notifications_push: Optional[bool] = None
    name: Optional[str] = None


class SupportContact(BaseModel):
    subject: str
    message: str
    kind: str = "general"   # general | bug | feature


# ==================== Auth — Email OTP ====================
@router.post("/auth/otp/request")
async def auth_otp_request(body: OTPRequest, request: Request):
    db = get_db(request)
    ip = _client_ip(request)
    code = await sec.store_otp(db, body.email, ip)
    ok = await email_svc.send_otp_email(body.email, code)
    dev_return = os.environ.get("DEV_OTP_RETURN_CODE", "false").lower() == "true"
    await sec.log_event(
        db, user_id=None, event="otp.requested",
        ip=ip, user_agent=request.headers.get("user-agent"),
        ok=True, meta={"email": body.email, "delivered": ok},
    )
    resp = {"sent": True, "delivered_via_email": ok}
    if dev_return:
        # During dev / when Resend is not configured: surface the code so the flow is testable.
        resp["dev_code"] = code
        resp["delivered_via_email"] = ok
    return resp


@router.post("/auth/otp/verify")
async def auth_otp_verify(body: OTPVerify, request: Request):
    db = get_db(request)
    ip = _client_ip(request)
    ua = request.headers.get("user-agent")
    ok = await sec.verify_otp(db, body.email, body.code)
    if not ok:
        await sec.log_event(db, user_id=None, event="otp.failed", ip=ip, user_agent=ua, ok=False, meta={"email": body.email})
        raise HTTPException(401, "Invalid or expired code")
    # Create / fetch user
    user = await auth_mod.upsert_oauth_user(
        db, email=body.email, name="", picture="", provider="email_otp"
    )
    tokens = auth_mod.issue_tokens(user)
    # Breach detection — new device?
    new_device = await sec.detect_new_device(db, user["id"], ua or "", ip)
    await sec.create_session(db, user_id=user["id"], refresh_jti=tokens["refresh_jti"], ip=ip, user_agent=ua)
    await sec.log_event(db, user_id=user["id"], event="login.email_otp", ip=ip, user_agent=ua, ok=True, meta={"new_device": new_device})
    if new_device:
        try:
            await email_svc.send_security_alert(
                user["email"],
                "New sign-in to your ORA OS account",
                [
                    f"A new sign-in happened on a <strong>{sec._device_label(ua or '')}</strong>.",
                    f"If this was you, you can ignore this message.",
                    f"If not, open ORA → You → Security and tap <strong>Sign out from all devices</strong>.",
                ],
                cta_url=f"{os.environ.get('APP_PUBLIC_URL','')}",
            )
        except Exception:
            pass
    return {"user": user, **{k: v for k, v in tokens.items() if k != "refresh_jti"}}


# ==================== Auth — Google handoff ====================
@router.get("/auth/google/start")
async def auth_google_start(request: Request):
    db = get_db(request)
    if not gh.is_configured():
        raise HTTPException(500, "Google OAuth not configured")
    nonce = await auth_mod.create_handoff(db)
    url = gh.auth_url(state=f"login:{nonce}")
    return {"nonce": nonce, "url": url}


@router.get("/auth/google/poll/{nonce}")
async def auth_google_poll(nonce: str, request: Request):
    db = get_db(request)
    rec = await auth_mod.poll_handoff(db, nonce)
    if rec.get("status") != "done":
        return {"status": rec.get("status", "pending")}
    # Create session on first poll
    user = rec.get("user") or {}
    if user.get("id"):
        ua = request.headers.get("user-agent")
        ip = _client_ip(request)
        # Decode the refresh token to get jti
        try:
            payload = auth_mod.decode_token(rec["refresh_token"], "refresh")
            jti = payload.get("jti", "")
            existing = await db.login_sessions.find_one({"refresh_jti": jti}) if jti else None
            if jti and not existing:
                await sec.create_session(db, user_id=user["id"], refresh_jti=jti, ip=ip, user_agent=ua)
                await sec.log_event(db, user_id=user["id"], event="login.google", ip=ip, user_agent=ua, ok=True)
        except Exception:
            pass
    return rec


# ==================== Apple sign-in (stub) ====================
@router.post("/auth/apple/start")
async def auth_apple_start():
    # Real Apple Sign-In requires an iOS native build with Sign in with Apple capability.
    raise HTTPException(
        status_code=501,
        detail="Sign in with Apple is coming soon. iOS native build required.",
    )


# ==================== Auth — me, refresh, logout ====================
@router.get("/auth/me")
async def auth_me(user: Dict[str, Any] = Depends(require_user)):
    return {"user": user}


@router.post("/auth/refresh")
async def auth_refresh(body: RefreshReq, request: Request):
    db = get_db(request)
    payload = auth_mod.decode_token(body.refresh_token, "refresh")
    jti = payload.get("jti", "")
    if not jti or not await sec.is_jti_valid(db, jti):
        raise HTTPException(401, "Session revoked")
    user = await auth_mod.get_user_by_id(db, payload["sub"])
    if not user:
        raise HTTPException(401, "User not found")
    user = auth_mod._sanitize(user)
    await sec.touch_session(db, jti)
    return {
        "access_token": auth_mod.create_access_token(user["id"], user["email"]),
        "token_type": "bearer",
    }


@router.post("/auth/logout")
async def auth_logout(body: RefreshReq, request: Request, user: Dict[str, Any] = Depends(require_user)):
    db = get_db(request)
    try:
        payload = auth_mod.decode_token(body.refresh_token, "refresh")
        jti = payload.get("jti", "")
        # Find and revoke matching session
        sess = await db.login_sessions.find_one({"refresh_jti": jti, "user_id": user["id"]}, {"_id": 0})
        if sess:
            await sec.revoke_session(db, user["id"], sess["id"])
    except Exception:
        pass
    await sec.log_event(db, user_id=user["id"], event="logout", ip=_client_ip(request), user_agent=request.headers.get("user-agent"))
    return {"ok": True}


@router.post("/auth/logout-all")
async def auth_logout_all(request: Request, user: Dict[str, Any] = Depends(require_user)):
    db = get_db(request)
    n = await sec.revoke_all_sessions(db, user["id"])
    await sec.log_event(db, user_id=user["id"], event="logout.all", ip=_client_ip(request), user_agent=request.headers.get("user-agent"), meta={"revoked": n})
    return {"ok": True, "revoked": n}


# ==================== Settings ====================
@router.get("/settings")
async def settings_get(request: Request, user: Dict[str, Any] = Depends(require_user)):
    db = get_db(request)
    doc = await db.user_settings.find_one({"user_id": user["id"]}, {"_id": 0})
    if not doc:
        doc = {
            "user_id": user["id"],
            "theme": "system",
            "ai_data_usage": False,
            "cookies_essential": True,
            "cookies_analytics": False,
            "cookies_marketing": False,
            "notifications_email": True,
            "notifications_push": True,
        }
        await db.user_settings.insert_one(doc.copy())
    return doc


@router.put("/settings")
async def settings_put(body: SettingsBody, request: Request, user: Dict[str, Any] = Depends(require_user)):
    db = get_db(request)
    patch: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if body.theme is not None and body.theme in {"light", "dark", "system"}:
        patch["theme"] = body.theme
    for f in ("ai_data_usage", "cookies_essential", "cookies_analytics", "cookies_marketing",
              "notifications_email", "notifications_push"):
        v = getattr(body, f)
        if v is not None:
            patch[f] = bool(v)
    if body.name:
        await db.users.update_one({"id": user["id"]}, {"$set": {"name": body.name.strip()[:80]}})
    await db.user_settings.update_one(
        {"user_id": user["id"]},
        {"$set": patch, "$setOnInsert": {"user_id": user["id"]}},
        upsert=True,
    )
    new_doc = await db.user_settings.find_one({"user_id": user["id"]}, {"_id": 0})
    return new_doc


# ==================== Security center ====================
@router.get("/security/sessions")
async def security_sessions(request: Request, user: Dict[str, Any] = Depends(require_user)):
    db = get_db(request)
    rows = await sec.list_sessions(db, user["id"])
    return {"sessions": rows}


@router.post("/security/sessions/{session_id}/revoke")
async def security_revoke(session_id: str, request: Request, user: Dict[str, Any] = Depends(require_user)):
    db = get_db(request)
    ok = await sec.revoke_session(db, user["id"], session_id)
    if not ok:
        raise HTTPException(404, "Session not found")
    await sec.log_event(db, user_id=user["id"], event="session.revoked", ip=_client_ip(request), meta={"session_id": session_id})
    return {"ok": True}


@router.post("/security/sessions/revoke-all")
async def security_revoke_all(request: Request, user: Dict[str, Any] = Depends(require_user)):
    db = get_db(request)
    n = await sec.revoke_all_sessions(db, user["id"])
    await sec.log_event(db, user_id=user["id"], event="session.revoked_all", ip=_client_ip(request), meta={"count": n})
    return {"ok": True, "revoked": n}


@router.get("/security/audit")
async def security_audit(request: Request, user: Dict[str, Any] = Depends(require_user), limit: int = 50):
    db = get_db(request)
    rows = await sec.list_audit_events(db, user["id"], min(limit, 200))
    return {"events": rows}


# ==================== Account export / delete ====================
@router.post("/account/export")
async def account_export(request: Request, user: Dict[str, Any] = Depends(require_user)):
    db = get_db(request)
    export: Dict[str, Any] = {"user": user, "exported_at": datetime.now(timezone.utc).isoformat()}
    for coll in USER_SCOPED_COLLECTIONS:
        try:
            rows = await db[coll].find({"user_id": user["id"]}, {"_id": 0}).to_list(50000)
            export[coll] = rows
        except Exception:
            export[coll] = []
    await sec.log_event(db, user_id=user["id"], event="account.exported")
    return export


@router.post("/account/delete")
async def account_delete(request: Request, user: Dict[str, Any] = Depends(require_user)):
    db = get_db(request)
    total = 0
    for coll in USER_SCOPED_COLLECTIONS:
        try:
            r = await db[coll].delete_many({"user_id": user["id"]})
            total += r.deleted_count
        except Exception:
            pass
    # Single-user-keyed integrations (Google) — only delete if scoped to this user
    try:
        await db.integrations.delete_many({"user_id": user["id"]})
    except Exception:
        pass
    await db.users.delete_one({"id": user["id"]})
    await sec.log_event(db, user_id=user["id"], event="account.deleted", ok=True, meta={"docs_removed": total})
    return {"ok": True, "documents_removed": total}


# ==================== Support ====================
FAQ_ITEMS = [
    {"q": "How does ORA OS keep my data private?",
     "a": "Your data lives in your own private space — encrypted in transit (HTTPS) and at rest (Mongo storage encryption). You can export or delete everything from the You tab."},
    {"q": "How do I sign in?",
     "a": "Tap Sign in with Google or use a one-time 6-digit code sent to your email. We're passwordless by design."},
    {"q": "Will my data train AI models?",
     "a": "Only if you opt in. The default is OFF. You can toggle this any time in You → Privacy."},
    {"q": "How do I export my data?",
     "a": "You → Privacy → Export my data downloads everything as a JSON file."},
    {"q": "How do I delete my account?",
     "a": "You → Account → Delete account. This permanently removes your conversations, memories, journals, health logs, finance and career data."},
    {"q": "Why does ORA ask to connect Google?",
     "a": "Optional. If connected, ORA can summarise your calendar, surface inbox highlights, and auto-detect bank transactions. Revoke any time from Security."},
]


@router.get("/support/faq")
async def support_faq():
    return {"faq": FAQ_ITEMS}


@router.post("/support/contact")
async def support_contact(body: SupportContact, request: Request, user: Dict[str, Any] = Depends(require_user)):
    db = get_db(request)
    msg_lines = [
        f"From: <strong>{user['email']}</strong> ({user.get('name','')})",
        f"Kind: {body.kind}",
        f"<hr style='border-color:#222226;'>",
        body.message.replace("\n", "<br/>"),
    ]
    sent = await email_svc.send_security_alert(
        os.environ.get("SUPPORT_INBOX", "support@" + (os.environ.get("APP_PUBLIC_URL", "") or "oraos.app").replace("https://", "").replace("http://", "")),
        f"[{body.kind}] {body.subject}",
        msg_lines,
    )
    await db.support_tickets.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "email": user["email"],
        "kind": body.kind,
        "subject": body.subject[:200],
        "message": body.message[:4000],
        "delivered": sent,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True, "delivered_via_email": sent}


# ==================== Legal pages (HTML) ====================
LEGAL_BASE_STYLE = """\
<style>
  body { background:#0a0a0c; color:#E2E2E4; font-family:-apple-system,Helvetica,Arial,sans-serif; margin:0; padding:40px 24px; line-height:1.7; }
  .wrap { max-width:760px; margin:0 auto; }
  h1 { font-family:Georgia,'Times New Roman',serif; font-weight:400; color:#F7F7F8; font-size:38px; letter-spacing:-0.5px; margin-bottom:4px;}
  h2 { color:#E1B168; font-size:14px; letter-spacing:2px; text-transform:uppercase; margin-top:40px;}
  p, li { color:#B4B4B8; font-size:15px; }
  a { color:#E1B168; }
  .meta { color:#65656B; font-size:12px; margin-bottom:32px; }
  hr { border:none; border-top:1px solid #222226; margin:32px 0;}
  ul { padding-left:20px;}
</style>"""

LEGAL_FOOTER = "<hr/><p style='font-size:12px;color:#65656B;'>ORA OS · Your AI Operating System for Life · contact: support@oraos.app</p>"


@router.get("/legal/privacy", response_class=HTMLResponse)
async def legal_privacy():
    return HTMLResponse(f"""\
<!doctype html><html><head><meta charset='utf-8'><title>ORA OS — Privacy Policy</title>{LEGAL_BASE_STYLE}</head>
<body><div class='wrap'>
<h1>Privacy Policy</h1>
<div class='meta'>Last updated: 19 June 2026 · Effective immediately</div>

<p>ORA OS ("we", "us") is a personal AI operating system. This policy explains what data we collect, why, and how you stay in control.</p>

<h2>What we collect</h2>
<ul>
  <li><strong>Account data</strong> — your email and (optionally) name + profile photo from Google.</li>
  <li><strong>Content you create</strong> — chats with ORA, memories, journals, goals, reminders, health logs, finance notes, documents you upload, career profile.</li>
  <li><strong>Connected services</strong> (only if you opt in) — Gmail + Calendar metadata, transaction emails. Tokens are encrypted at rest.</li>
  <li><strong>Device + activity</strong> — IP, user-agent, device label, login times. Used solely for security (audit log and breach detection).</li>
</ul>

<h2>How we use your data</h2>
<ul>
  <li>To operate the app — generate AI replies, briefings, insights, voice responses.</li>
  <li>To secure your account — detect new-device sign-ins, send security alerts, manage sessions.</li>
  <li><strong>We do not sell your data.</strong> Period.</li>
  <li>We <strong>only</strong> use your data to improve AI models if you opt in (You → Privacy). Default: OFF.</li>
</ul>

<h2>Third parties</h2>
<ul>
  <li><strong>Amazon Bedrock</strong> processes your chat messages to generate AI responses. AWS does not store them past the request.</li>
  <li><strong>ElevenLabs</strong> converts text to your cloned voice. Audio is generated on demand and not stored remotely.</li>
  <li><strong>Google</strong> — only when you connect Gmail/Calendar.</li>
  <li><strong>Resend</strong> sends OTP and security emails.</li>
  <li>No advertising, no analytics SDKs beyond what you explicitly enable in Cookie Preferences.</li>
</ul>

<h2>Encryption</h2>
<ul>
  <li>All network traffic uses HTTPS/TLS.</li>
  <li>Storage at rest is encrypted at the database layer.</li>
  <li>OAuth tokens are encrypted in storage and never returned in API responses.</li>
</ul>

<h2>Your rights</h2>
<ul>
  <li><strong>Access &amp; export</strong> — download all your data from You → Privacy → Export.</li>
  <li><strong>Delete</strong> — You → Account → Delete account permanently erases everything.</li>
  <li><strong>Object</strong> — opt out of AI training at any time.</li>
  <li><strong>Portability</strong> — exports are plain JSON.</li>
</ul>

<h2>Children</h2>
<p>ORA OS is not intended for children under 13. If you believe a child has provided data, contact us and we will delete it.</p>

<h2>Contact</h2>
<p>Questions? Email <a href='mailto:privacy@oraos.app'>privacy@oraos.app</a>.</p>
{LEGAL_FOOTER}
</div></body></html>""")


@router.get("/legal/terms", response_class=HTMLResponse)
async def legal_terms():
    return HTMLResponse(f"""\
<!doctype html><html><head><meta charset='utf-8'><title>ORA OS — Terms of Service</title>{LEGAL_BASE_STYLE}</head>
<body><div class='wrap'>
<h1>Terms of Service</h1>
<div class='meta'>Last updated: 19 June 2026</div>

<p>By using ORA OS you agree to these terms. They're written in plain English on purpose.</p>

<h2>Your account</h2>
<ul>
  <li>You must provide a valid email and keep your sign-in factors secure.</li>
  <li>You're responsible for what's done from your account.</li>
  <li>You can delete the account any time — and we'll permanently delete the data.</li>
</ul>

<h2>Acceptable use</h2>
<ul>
  <li>Don't use ORA to break laws, hurt others, or generate illegal content.</li>
  <li>Don't try to extract other users' data or attack the service.</li>
  <li>Don't impersonate or scrape at scale.</li>
</ul>

<h2>AI output</h2>
<p>ORA's AI replies are probabilistic. We don't guarantee correctness — use your judgement for important decisions (medical, financial, legal).</p>

<h2>Subscriptions &amp; pricing</h2>
<p>v1 is free during early access. Future plans (Pro, Family) will be clearly disclosed before any charge.</p>

<h2>Termination</h2>
<p>We may suspend accounts that violate these terms. You can stop using the service any time.</p>

<h2>Liability</h2>
<p>The service is provided "as is" without warranties. Our liability is limited to the amount you've paid us in the last 12 months (which, on free plans, is zero).</p>

<h2>Changes</h2>
<p>We'll notify you of material changes via email and in-app. Continued use means acceptance.</p>

<h2>Contact</h2>
<p><a href='mailto:legal@oraos.app'>legal@oraos.app</a></p>
{LEGAL_FOOTER}
</div></body></html>""")


@router.get("/legal/cookies", response_class=HTMLResponse)
async def legal_cookies():
    return HTMLResponse(f"""\
<!doctype html><html><head><meta charset='utf-8'><title>ORA OS — Cookie Policy</title>{LEGAL_BASE_STYLE}</head>
<body><div class='wrap'>
<h1>Cookie Policy</h1>
<div class='meta'>Last updated: 19 June 2026</div>

<p>ORA OS uses a minimal number of cookies and similar local-storage tokens. You control them.</p>

<h2>Essential</h2>
<p>Required for login (refresh token, JWT). You can't disable these — without them you'd be signed out instantly.</p>

<h2>Analytics</h2>
<p>If enabled, we measure aggregate usage (which screens, errors). No personal content is sent. Off by default.</p>

<h2>Marketing</h2>
<p>Currently <strong>not used</strong>. Reserved for the future; if turned on, we'll disclose the vendor and you can opt out.</p>

<h2>Managing your preferences</h2>
<p>Open the app, go to <strong>You → Privacy → Cookie preferences</strong>. Toggle each category. Defaults: Essential ON, Analytics OFF, Marketing OFF.</p>

<h2>Browser-level controls</h2>
<p>You can also clear cookies/local storage from your browser or device settings — note this signs you out.</p>
{LEGAL_FOOTER}
</div></body></html>""")
