"""
Email service — Resend-backed, with a dev fallback that logs the message.

Used for: OTP login codes, security notifications (new device, etc.).
Cost-aware: Resend free tier is 3,000 emails/month, well below v1 traffic.
"""
from __future__ import annotations
import os
import asyncio
import logging
from typing import Optional

import resend

logger = logging.getLogger(__name__)

APP_NAME = os.environ.get("APP_NAME", "ORA OS")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")

if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY


def _is_configured() -> bool:
    return bool(RESEND_API_KEY)


async def _send(to: str, subject: str, html: str) -> bool:
    """Returns True if email was attempted via Resend; False if logged-only fallback."""
    if not _is_configured():
        logger.warning("RESEND_API_KEY not set — falling back to log. To: %s | Subject: %s", to, subject)
        logger.info("EMAIL BODY (dev fallback)\n%s", html)
        return False
    params = {"from": f"{APP_NAME} <{SENDER_EMAIL}>", "to": [to], "subject": subject, "html": html}
    try:
        await asyncio.to_thread(resend.Emails.send, params)
        return True
    except Exception as e:
        logger.error("Resend send failed to %s: %s", to, e)
        return False


def _otp_html(code: str) -> str:
    return f"""\
<!DOCTYPE html><html><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;background:#0a0a0c;color:#F7F7F8;margin:0;padding:40px 0;">
<table align="center" style="background:#151518;border:1px solid #222226;border-radius:20px;padding:36px;max-width:480px;width:100%;">
<tr><td>
  <div style="text-align:center;">
    <div style="font-family:Georgia,'Times New Roman',serif;font-size:30px;letter-spacing:-0.5px;color:#F7F7F8;">{APP_NAME}</div>
    <div style="color:#E1B168;letter-spacing:3px;font-size:11px;margin-top:6px;text-transform:uppercase;">Your sign-in code</div>
  </div>
  <div style="text-align:center;margin:36px 0;padding:24px;background:#0a0a0c;border:1px solid #291F11;border-radius:12px;">
    <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:42px;letter-spacing:14px;color:#E1B168;font-weight:600;">{code}</div>
  </div>
  <p style="color:#B4B4B8;font-size:14px;line-height:22px;text-align:center;">
    Enter this 6-digit code in the app to finish signing in. The code expires in <strong style="color:#F7F7F8;">10 minutes</strong>.
  </p>
  <p style="color:#65656B;font-size:12px;line-height:18px;text-align:center;margin-top:32px;">
    Didn't request this? You can safely ignore this email — someone may have typed your address by mistake.
  </p>
</td></tr></table>
<div style="text-align:center;color:#444448;font-size:11px;margin-top:24px;">{APP_NAME} · Your AI Operating System for Life</div>
</body></html>"""


def _alert_html(headline: str, body_lines: list[str], cta_url: Optional[str] = None) -> str:
    body = "".join(f'<p style="color:#B4B4B8;font-size:13px;line-height:20px;">{l}</p>' for l in body_lines)
    cta = f'<a href="{cta_url}" style="display:inline-block;background:#E1B168;color:#1A1104;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:600;font-size:13px;margin-top:8px;">Review security</a>' if cta_url else ""
    return f"""\
<!DOCTYPE html><html><body style="font-family:-apple-system,Helvetica,Arial,sans-serif;background:#0a0a0c;color:#F7F7F8;margin:0;padding:40px 0;">
<table align="center" style="background:#151518;border:1px solid #222226;border-radius:20px;padding:36px;max-width:480px;width:100%;">
<tr><td>
  <div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#F7F7F8;margin-bottom:8px;">⚠ {headline}</div>
  {body}
  <div style="text-align:center;margin-top:16px;">{cta}</div>
</td></tr></table>
<div style="text-align:center;color:#444448;font-size:11px;margin-top:24px;">{APP_NAME} · Security alert</div>
</body></html>"""


async def send_otp_email(to: str, code: str) -> bool:
    return await _send(to, f"{APP_NAME} sign-in code: {code}", _otp_html(code))


async def send_security_alert(to: str, headline: str, body_lines: list[str], cta_url: Optional[str] = None) -> bool:
    return await _send(to, f"{APP_NAME} security alert: {headline}", _alert_html(headline, body_lines, cta_url))
