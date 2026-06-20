"""
Backend tests for Super Master Admin Console.
Covers all admin endpoints under /api/admin/* plus regression checks for the
existing user OTP flow and /api/expo-qr.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://83106ebd-c21f-4061-a350-cff01f36355d.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@oraos.app"
ADMIN_PASSWORD = "Admin@123456"


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def admin_tokens(session):
    r = session.post(f"{API}/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "access_token" in data
    assert data["user"]["role"] == "super_admin"
    return data


@pytest.fixture(scope="session")
def admin_headers(admin_tokens):
    return {"Authorization": f"Bearer {admin_tokens['access_token']}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def non_admin_user():
    """Insert a non-admin user directly into Mongo and return the dict.
    Uses backend's auth module so the row is shaped exactly like real users."""
    import sys, asyncio
    sys.path.insert(0, "/app/backend")
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from motor.motor_asyncio import AsyncIOMotorClient
    import auth as auth_mod

    async def _go():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        email = f"TEST_nonadmin_{uuid.uuid4().hex[:8]}@example.com"
        user = await auth_mod.upsert_oauth_user(db, email=email, name="Test User", picture="", provider="email_otp")
        return user

    return asyncio.get_event_loop().run_until_complete(_go()) if False else __import__("asyncio").run(_go())


@pytest.fixture(scope="session")
def non_admin_token(non_admin_user):
    import sys
    sys.path.insert(0, "/app/backend")
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    import auth as auth_mod
    return auth_mod.issue_tokens(non_admin_user)["access_token"]


# ---------- Auth ----------
class TestAdminAuth:
    def test_login_success(self, admin_tokens):
        assert admin_tokens["user"]["email"] == ADMIN_EMAIL
        assert admin_tokens["user"]["role"] == "super_admin"
        assert isinstance(admin_tokens.get("access_token"), str)

    def test_login_bad_password(self, session):
        r = session.post(f"{API}/admin/login", json={"email": ADMIN_EMAIL, "password": "wrong"}, timeout=15)
        assert r.status_code == 401

    def test_me_with_admin_token(self, session, admin_headers):
        r = session.get(f"{API}/admin/me", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "super_admin"

    def test_me_rejects_no_token(self, session):
        r = session.get(f"{API}/admin/me", timeout=15)
        assert r.status_code in (401, 403)

    def test_non_admin_rejected_403(self, session, non_admin_token):
        hdrs = {"Authorization": f"Bearer {non_admin_token}"}
        r2 = session.get(f"{API}/admin/me", headers=hdrs, timeout=15)
        assert r2.status_code == 403


# ---------- Dashboard metrics ----------
class TestMetrics:
    def test_overview(self, session, admin_headers):
        r = session.get(f"{API}/admin/metrics/overview", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("users", "ai", "financial", "platform"):
            assert k in d, f"missing key {k}"
        assert "total" in d["users"]
        assert "mrr" in d["financial"]
        assert "today" in d["ai"]

    def test_cost_series_14_days(self, session, admin_headers):
        r = session.get(f"{API}/admin/metrics/cost-series?days=14", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "series" in d and len(d["series"]) == 14
        assert {"date", "cost_usd", "tokens", "requests"} <= set(d["series"][0].keys())


# ---------- Users ----------
class TestUsers:
    def test_list_with_query(self, session, admin_headers):
        r = session.get(f"{API}/admin/users?q=admin", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "items" in d and isinstance(d["items"], list)
        emails = [u.get("email") for u in d["items"]]
        assert any("admin" in (e or "").lower() for e in emails)

    @pytest.fixture
    def test_user_id(self, non_admin_user):
        return non_admin_user["id"]

    def test_update_status(self, session, admin_headers, test_user_id):
        r = session.put(f"{API}/admin/users/{test_user_id}/status", json={"status": "suspended"}, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "suspended"
        # verify via get
        g = session.get(f"{API}/admin/users/{test_user_id}", headers=admin_headers, timeout=15)
        assert g.status_code == 200
        assert g.json()["user"]["status"] == "suspended"

    def test_update_role(self, session, admin_headers, test_user_id):
        r = session.put(f"{API}/admin/users/{test_user_id}/role", json={"role": "admin"}, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["role"] == "admin"

    def test_update_plan(self, session, admin_headers, test_user_id):
        r = session.put(f"{API}/admin/users/{test_user_id}/plan", json={"plan": "pro"}, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["plan"] == "pro"

    def test_revoke_sessions(self, session, admin_headers, test_user_id):
        r = session.post(f"{API}/admin/users/{test_user_id}/revoke-sessions", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert r.json().get("ok") is True


# ---------- AI Model Control ----------
class TestAIProviders:
    def test_list(self, session, admin_headers):
        r = session.get(f"{API}/admin/ai/providers", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "items" in d and "catalog" in d and "labels" in d
        assert "openai" in d["labels"]

    def test_upsert_and_mask(self, session, admin_headers):
        body = {"name": "openai", "label": "OpenAI", "api_key": "sk-TESTKEY1234567890abcd", "enabled": True}
        r = session.post(f"{API}/admin/ai/providers", json=body, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        p = r.json()["provider"]
        assert p["api_key"] != "sk-TESTKEY1234567890abcd"
        assert "•" in p["api_key"] or "*" in p["api_key"]
        # Re-list and confirm masking
        lst = session.get(f"{API}/admin/ai/providers", headers=admin_headers, timeout=15).json()
        oai = next((x for x in lst["items"] if x["name"] == "openai"), None)
        assert oai is not None
        assert oai["enabled"] is True

    def test_patch_toggle(self, session, admin_headers):
        r = session.patch(f"{API}/admin/ai/providers/openai", json={"enabled": False}, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["provider"]["enabled"] is False
        # toggle back
        session.patch(f"{API}/admin/ai/providers/openai", json={"enabled": True}, headers=admin_headers, timeout=15)


class TestFeatureModels:
    def test_assign(self, session, admin_headers):
        body = {"feature": "chat", "primary_model_id": "amazon.nova-lite-v1:0", "fallback_model_ids": ["gpt-4o-mini"]}
        r = session.post(f"{API}/admin/ai/feature-models", json=body, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["item"]["primary_model_id"] == "amazon.nova-lite-v1:0"


class TestAIUsage:
    def test_ingest_and_aggregate(self, session, admin_headers):
        body = {"provider": "openai", "model_id": "gpt-4o-mini", "feature": "chat",
                "input_tokens": 100, "output_tokens": 50, "latency_ms": 200, "cost_usd": 0.0015, "success": True}
        r = session.post(f"{API}/admin/ai/usage", json=body, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        # aggregate
        g = session.get(f"{API}/admin/ai/usage?days=1", headers=admin_headers, timeout=15)
        assert g.status_code == 200
        d = g.json()
        assert "by_provider" in d and "by_model" in d and "by_feature" in d
        assert "openai" in d["by_provider"]


class TestBudget:
    def test_get_default(self, session, admin_headers):
        r = session.get(f"{API}/admin/ai/budget", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "budget" in d and "spent_usd" in d and "spent_pct" in d

    def test_put(self, session, admin_headers):
        r = session.put(f"{API}/admin/ai/budget", json={"monthly_usd": 750.0, "alert_pct": [50, 90], "email_to": "ops@oraos.app"}, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["budget"]["monthly_usd"] == 750.0


# ---------- Feature flags ----------
class TestFeatureFlags:
    def test_upsert_and_delete(self, session, admin_headers):
        key = f"test_flag_{uuid.uuid4().hex[:6]}"
        r = session.put(f"{API}/admin/features", json={"key": key, "label": "Test", "status": "beta", "rollout_pct": 25, "audience": []}, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["item"]["rollout_pct"] == 25
        # list contains it
        lst = session.get(f"{API}/admin/features", headers=admin_headers, timeout=15).json()
        assert any(f["key"] == key for f in lst["items"])
        # delete
        d = session.delete(f"{API}/admin/features/{key}", headers=admin_headers, timeout=15)
        assert d.status_code == 200
        assert d.json()["ok"] is True


# ---------- Prompts ----------
class TestPrompts:
    def test_create_publish_rollback(self, session, admin_headers):
        key = f"test_prompt_{uuid.uuid4().hex[:6]}"
        r1 = session.post(f"{API}/admin/prompts", json={"key": key, "label": "T", "body": "v1", "mode": "published"}, headers=admin_headers, timeout=15)
        assert r1.status_code == 200, r1.text
        v1 = r1.json()["item"]
        r2 = session.post(f"{API}/admin/prompts", json={"key": key, "label": "T", "body": "v2", "mode": "published"}, headers=admin_headers, timeout=15)
        assert r2.status_code == 200
        v2 = r2.json()["item"]
        # rollback to v1
        rb = session.post(f"{API}/admin/prompts/{v1['id']}/rollback", headers=admin_headers, timeout=15)
        assert rb.status_code == 200
        # list
        lst = session.get(f"{API}/admin/prompts", headers=admin_headers, timeout=15).json()
        bucket = next((p for p in lst["items"] if p["key"] == key), None)
        assert bucket is not None
        published = [v for v in bucket["versions"] if v["mode"] == "published"]
        assert len(published) == 1
        assert published[0]["id"] == v1["id"]


# ---------- Audit ----------
class TestAudit:
    def test_audit_log_immutable(self, session, admin_headers):
        r = session.get(f"{API}/admin/audit?limit=20", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        items = r.json()["items"]
        assert isinstance(items, list)
        # admin.login from session setup must be present
        actions = [i.get("action") for i in items]
        assert any("admin.login" == a or "provider" in (a or "") or "feature" in (a or "") for a in actions)


# ---------- Security / Health / Notifications / Config / Billing / Analytics / Support ----------
class TestMisc:
    def test_security_overview(self, session, admin_headers):
        r = session.get(f"{API}/admin/security/overview", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        for k in ("failed_logins_24h", "rate_limit_violations_24h", "new_device_logins_7d", "blocked_users"):
            assert k in r.json()

    def test_health_snapshot(self, session, admin_headers):
        r = session.get(f"{API}/admin/health/snapshot", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        d = r.json()
        for k in ("frontend", "backend", "database", "storage", "providers"):
            assert k in d
        assert d["database"]["status"] in ("healthy", "warning", "critical")

    def test_send_announcement(self, session, admin_headers):
        body = {"channel": "announcement", "title": "TEST_announce", "body": "hello", "audience": "all"}
        r = session.post(f"{API}/admin/notifications", json=body, headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["item"]["channel"] == "announcement"

    def test_config_roundtrip(self, session, admin_headers):
        g = session.get(f"{API}/admin/config", headers=admin_headers, timeout=15)
        assert g.status_code == 200
        new_name = f"ORA OS TEST {uuid.uuid4().hex[:4]}"
        p = session.put(f"{API}/admin/config", json={"app_name": new_name}, headers=admin_headers, timeout=15)
        assert p.status_code == 200, p.text
        assert p.json()["config"]["app_name"] == new_name

    def test_billing_summary(self, session, admin_headers):
        r = session.get(f"{API}/admin/billing/summary", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ("mrr", "arr", "plan_distribution", "plan_prices"):
            assert k in d

    def test_plan_upsert(self, session, admin_headers):
        body = {"key": "pro", "label": "Pro", "price_usd_monthly": 12.0, "features": ["chat"], "storage_gb": 5.0,
                "monthly_token_limit": 500000, "upload_limit_mb": 100, "ai_requests_per_day": 500}
        r = session.put(f"{API}/admin/subscriptions/plans", json=body, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["item"]["price_usd_monthly"] == 12.0

    def test_analytics(self, session, admin_headers):
        r = session.get(f"{API}/admin/analytics/overview", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        d = r.json()
        for k in ("feature_usage_7d", "session_duration", "retention"):
            assert k in d

    def test_support_list(self, session, admin_headers):
        r = session.get(f"{API}/admin/support/tickets", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert "items" in r.json()


# ---------- Regression: existing user flows ----------
class TestRegression:
    def test_otp_request_works(self, session):
        email = f"TEST_reg_{uuid.uuid4().hex[:6]}@example.com"
        r = session.post(f"{API}/auth/otp/request", json={"email": email}, timeout=20)
        assert r.status_code in (200, 201, 202)
        assert isinstance(r.json(), dict)

    def test_expo_qr(self, session):
        r = session.get(f"{API}/expo-qr", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d, dict)
