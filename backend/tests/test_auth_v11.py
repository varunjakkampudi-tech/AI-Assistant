"""
ORA OS v1.1 - Auth + Security + Settings + Account test suite

Covers: whitelisted/public endpoints, protected gates, email-OTP, refresh/logout
flows, settings CRUD, security center, audit, account export/delete, support,
legal pages and the Expo QR card.
"""
from __future__ import annotations

import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL"
)
if not BASE_URL:
    raise RuntimeError("Frontend backend URL env var missing")
BASE_URL = BASE_URL.rstrip("/")

API = f"{BASE_URL}/api"
TIMEOUT = 30


def _email() -> str:
    return f"test_auth_{uuid.uuid4().hex[:10]}@oraos.app"


def _request_otp(session: requests.Session, email: str):
    r = session.post(f"{API}/auth/otp/request", json={"email": email}, timeout=TIMEOUT)
    assert r.status_code == 200, f"otp/request failed: {r.status_code} {r.text}"
    data = r.json()
    assert "dev_code" in data, f"DEV_OTP_RETURN_CODE expected in response: {data}"
    return data["dev_code"]


def _verify_otp(session: requests.Session, email: str, code: str):
    r = session.post(
        f"{API}/auth/otp/verify",
        json={"email": email, "code": code},
        timeout=TIMEOUT,
    )
    return r


def _signin(session: requests.Session, email: str):
    code = _request_otp(session, email)
    r = _verify_otp(session, email, code)
    assert r.status_code == 200, f"otp/verify failed: {r.status_code} {r.text}"
    body = r.json()
    assert "access_token" in body and "refresh_token" in body
    return body  # {user, access_token, refresh_token, token_type}


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture
def signed_in(session):
    email = _email()
    body = _signin(session, email)
    yield {"email": email, **body}
    # Cleanup: attempt account-delete (idempotent if already deleted)
    try:
        session.post(
            f"{API}/account/delete",
            headers={"Authorization": f"Bearer {body['access_token']}"},
            timeout=TIMEOUT,
        )
    except Exception:
        pass


# ==================== Public / whitelist ====================
class TestWhitelist:
    def test_root_public(self, session):
        r = session.get(f"{API}/", timeout=TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        # Branding intact
        assert "ORA OS" in str(body.get("message", "")) or "ORA OS" in r.text

    @pytest.mark.parametrize("path", ["/legal/privacy", "/legal/terms", "/legal/cookies"])
    def test_legal_pages_public(self, session, path):
        r = session.get(f"{API}{path}", timeout=TIMEOUT)
        assert r.status_code == 200
        ctype = r.headers.get("content-type", "")
        assert "text/html" in ctype, f"expected text/html got {ctype}"
        assert len(r.text) > 100

    def test_expo_qr_public(self, session):
        r = session.get(f"{API}/expo-qr", timeout=TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert data.get("app_name") == "ORA OS"
        for key in ("preview_url", "qr_image_url", "expo_go_ios", "expo_go_android"):
            assert key in data, f"missing {key} in expo-qr"

    def test_expo_qr_png(self, session):
        r = session.get(f"{API}/expo-qr/png", timeout=TIMEOUT, allow_redirects=False)
        assert r.status_code in (200, 302, 307), f"unexpected {r.status_code}"
        if r.status_code == 200:
            assert "image/png" in r.headers.get("content-type", "")
        else:
            loc = r.headers.get("location", "")
            assert "qrserver" in loc or "qr" in loc.lower()

    def test_otp_request_public(self, session):
        # Public — does not require auth header
        email = _email()
        r = session.post(f"{API}/auth/otp/request", json={"email": email}, timeout=TIMEOUT)
        assert r.status_code == 200

    def test_support_faq_public(self, session):
        r = session.get(f"{API}/support/faq", timeout=TIMEOUT)
        assert r.status_code == 200
        body = r.json()
        assert "faq" in body
        assert len(body["faq"]) >= 4


# ==================== Protected endpoints require auth ====================
class TestProtected:
    @pytest.mark.parametrize("path", ["/briefing", "/security/sessions", "/memories", "/auth/me"])
    def test_protected_returns_401(self, session, path):
        r = session.get(f"{API}{path}", timeout=TIMEOUT)
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text[:200]}"


# ==================== OTP flow + lockout ====================
class TestOTPFlow:
    def test_otp_request_and_verify(self, session):
        email = _email()
        code = _request_otp(session, email)
        assert isinstance(code, str) and len(code) >= 4
        r = _verify_otp(session, email, code)
        assert r.status_code == 200
        data = r.json()
        assert data["user"]["email"] == email
        assert data["access_token"]
        assert data["refresh_token"]
        # Cleanup
        session.post(
            f"{API}/account/delete",
            headers={"Authorization": f"Bearer {data['access_token']}"},
            timeout=TIMEOUT,
        )

    def test_otp_wrong_code_locks_after_5(self, session):
        email = _email()
        # Request a real code and keep it — DON'T request a new one (which would reset attempts)
        real_code = _request_otp(session, email)
        # Pick a wrong code that is guaranteed not equal to the real one
        wrong_code = "999999" if real_code != "999999" else "111111"
        for i in range(5):
            r = _verify_otp(session, email, wrong_code)
            assert r.status_code == 401, f"attempt {i} expected 401 got {r.status_code}"
        # Even the originally-valid code should now fail because the record is locked.
        r = _verify_otp(session, email, real_code)
        assert r.status_code == 401, f"after 5 failures, valid code should still be locked, got {r.status_code}"


# ==================== Me / refresh / logout ====================
class TestMeRefreshLogout:
    def test_me_with_token(self, session, signed_in):
        r = session.get(
            f"{API}/auth/me",
            headers={"Authorization": f"Bearer {signed_in['access_token']}"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        assert r.json()["user"]["email"] == signed_in["email"]

    def test_refresh_returns_new_access_token(self, session, signed_in):
        r = session.post(
            f"{API}/auth/refresh",
            json={"refresh_token": signed_in["refresh_token"]},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "access_token" in data

    def test_logout_revokes_session(self, session):
        email = _email()
        body = _signin(session, email)
        access = body["access_token"]
        refresh = body["refresh_token"]
        # logout (protected — requires Bearer access token)
        r = session.post(
            f"{API}/auth/logout",
            json={"refresh_token": refresh},
            headers={"Authorization": f"Bearer {access}"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        # refresh now should fail
        r2 = session.post(f"{API}/auth/refresh", json={"refresh_token": refresh}, timeout=TIMEOUT)
        assert r2.status_code == 401
        assert "revoked" in r2.text.lower() or "session" in r2.text.lower()
        # cleanup
        session.post(
            f"{API}/account/delete",
            headers={"Authorization": f"Bearer {access}"},
            timeout=TIMEOUT,
        )

    def test_logout_all_revokes_all(self, session):
        email = _email()
        body1 = _signin(session, email)
        body2 = _signin(session, email)
        assert body1["refresh_token"] != body2["refresh_token"]
        # logout-all from session1's access token
        r = session.post(
            f"{API}/auth/logout-all",
            headers={"Authorization": f"Bearer {body1['access_token']}"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        revoked = r.json().get("revoked", 0)
        assert revoked >= 2
        # both refresh tokens must now fail
        for refresh in (body1["refresh_token"], body2["refresh_token"]):
            r2 = session.post(f"{API}/auth/refresh", json={"refresh_token": refresh}, timeout=TIMEOUT)
            assert r2.status_code == 401, f"refresh should fail after logout-all, got {r2.status_code}"
        # cleanup
        session.post(
            f"{API}/account/delete",
            headers={"Authorization": f"Bearer {body1['access_token']}"},
            timeout=TIMEOUT,
        )


# ==================== Apple / Google scaffolding ====================
class TestSocialAuthScaffolding:
    def test_apple_start_stub(self, session):
        r = session.post(f"{API}/auth/apple/start", timeout=TIMEOUT)
        assert r.status_code == 501
        assert "soon" in r.text.lower() or "apple" in r.text.lower()

    def test_google_start_returns_url_or_500(self, session):
        r = session.get(f"{API}/auth/google/start", timeout=TIMEOUT)
        # 200 when configured, 500 if not — both are valid scaffolding outcomes
        assert r.status_code in (200, 500)
        if r.status_code == 200:
            data = r.json()
            assert "nonce" in data and "url" in data
            nonce = data["nonce"]
            r2 = session.get(f"{API}/auth/google/poll/{nonce}", timeout=TIMEOUT)
            assert r2.status_code == 200
            assert r2.json().get("status") in ("pending", "missing")


# ==================== Settings ====================
class TestSettings:
    def test_get_creates_default(self, session, signed_in):
        h = {"Authorization": f"Bearer {signed_in['access_token']}"}
        r = session.get(f"{API}/settings", headers=h, timeout=TIMEOUT)
        assert r.status_code == 200
        d = r.json()
        assert d["theme"] == "dark"
        assert d["ai_data_usage"] is False
        assert d["cookies_essential"] is True
        assert d["cookies_analytics"] is False
        assert d["cookies_marketing"] is False

    def test_put_updates(self, session, signed_in):
        h = {"Authorization": f"Bearer {signed_in['access_token']}"}
        r = session.put(
            f"{API}/settings",
            headers=h,
            json={"theme": "dark", "ai_data_usage": True},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200
        d = r.json()
        assert d["theme"] == "dark"
        assert d["ai_data_usage"] is True
        # GET reflects
        r2 = session.get(f"{API}/settings", headers=h, timeout=TIMEOUT)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["theme"] == "dark"
        assert d2["ai_data_usage"] is True

    def test_put_rejects_invalid_theme(self, session, signed_in):
        h = {"Authorization": f"Bearer {signed_in['access_token']}"}
        # Set known good first
        session.put(f"{API}/settings", headers=h, json={"theme": "dark"}, timeout=TIMEOUT)
        r = session.put(f"{API}/settings", headers=h, json={"theme": "neon"}, timeout=TIMEOUT)
        assert r.status_code == 200, f"should not 500, got {r.status_code}"
        assert r.json()["theme"] == "dark"  # unchanged


# ==================== Security center ====================
class TestSecurity:
    def test_sessions_lists_active(self, session, signed_in):
        h = {"Authorization": f"Bearer {signed_in['access_token']}"}
        r = session.get(f"{API}/security/sessions", headers=h, timeout=TIMEOUT)
        assert r.status_code == 200
        sessions = r.json().get("sessions", [])
        assert len(sessions) >= 1

    def test_revoke_session_removes_it(self, session, signed_in):
        h = {"Authorization": f"Bearer {signed_in['access_token']}"}
        r = session.get(f"{API}/security/sessions", headers=h, timeout=TIMEOUT)
        sessions = r.json().get("sessions", [])
        assert sessions, "expected at least one session"
        sid = sessions[0]["id"]
        r2 = session.post(f"{API}/security/sessions/{sid}/revoke", headers=h, timeout=TIMEOUT)
        assert r2.status_code == 200
        # Should no longer be present
        r3 = session.get(f"{API}/security/sessions", headers=h, timeout=TIMEOUT)
        ids = [s["id"] for s in r3.json().get("sessions", [])]
        assert sid not in ids

    def test_revoke_all(self, session):
        email = _email()
        body = _signin(session, email)
        h = {"Authorization": f"Bearer {body['access_token']}"}
        r = session.post(f"{API}/security/sessions/revoke-all", headers=h, timeout=TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert data.get("ok") is True
        assert "revoked" in data
        # cleanup
        session.post(f"{API}/account/delete", headers=h, timeout=TIMEOUT)

    def test_audit_log(self, session, signed_in):
        h = {"Authorization": f"Bearer {signed_in['access_token']}"}
        r = session.get(f"{API}/security/audit", headers=h, timeout=TIMEOUT)
        assert r.status_code == 200
        events = r.json().get("events", [])
        names = {e.get("event") for e in events}
        # login.email_otp must be present (logged on otp verify)
        assert "login.email_otp" in names, f"audit events: {names}"


# ==================== Account export / delete ====================
class TestAccount:
    def test_export(self, session, signed_in):
        h = {"Authorization": f"Bearer {signed_in['access_token']}"}
        r = session.post(f"{API}/account/export", headers=h, timeout=TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        for key in ("user", "chat_sessions", "memories"):
            assert key in data, f"missing {key} in export"

    def test_delete_then_me_401(self, session):
        email = _email()
        body = _signin(session, email)
        h = {"Authorization": f"Bearer {body['access_token']}"}
        r = session.post(f"{API}/account/delete", headers=h, timeout=TIMEOUT)
        assert r.status_code == 200
        # Subsequent /auth/me must 401
        r2 = session.get(f"{API}/auth/me", headers=h, timeout=TIMEOUT)
        assert r2.status_code == 401


# ==================== Support / FAQ / contact ====================
class TestSupport:
    def test_contact_authed(self, session, signed_in):
        h = {"Authorization": f"Bearer {signed_in['access_token']}"}
        payload = {"subject": "Test ticket", "message": "Hello support", "kind": "general"}
        r = session.post(f"{API}/support/contact", json=payload, headers=h, timeout=TIMEOUT)
        assert r.status_code == 200
        assert r.json().get("ok") is True


# ==================== Existing branding still intact ====================
class TestBrandingIntact:
    def test_briefing_authed_200(self, session, signed_in):
        h = {"Authorization": f"Bearer {signed_in['access_token']}"}
        # briefing might be slow due to LLM; give it room
        r = session.get(f"{API}/briefing", headers=h, timeout=60)
        # Accept 200 or 5xx if upstream LLM is flaky — but main expectation is 200
        assert r.status_code == 200, f"briefing status {r.status_code}: {r.text[:200]}"
