"""
Phase 4 backend tests — live AI routing, per-user analytics, finance intelligence,
premium chart endpoints, impersonation, login alerts, infrastructure, public
feature flags, and regression checks on /api/chat, /api/auth/otp/request,
/api/expo-qr.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://83106ebd-c21f-4061-a350-cff01f36355d.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@oraos.app"
ADMIN_PASSWORD = "Admin@123456"


# ---------------- Fixtures ----------------
@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def admin_login(session):
    r = session.post(f"{API}/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="session")
def admin_headers(admin_login):
    return {"Authorization": f"Bearer {admin_login['access_token']}", "Content-Type": "application/json"}


def _make_user(role: str = "user"):
    """Insert a user via auth_mod.upsert_oauth_user and return its dict + access token."""
    import sys, asyncio
    sys.path.insert(0, "/app/backend")
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from motor.motor_asyncio import AsyncIOMotorClient
    import auth as auth_mod

    async def _go():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        email = f"TEST_p4_{uuid.uuid4().hex[:8]}@example.com"
        u = await auth_mod.upsert_oauth_user(db, email=email, name="P4 User", picture="", provider="email_otp")
        if role != "user":
            await db.users.update_one({"id": u["id"]}, {"$set": {"role": role}})
            u["role"] = role
        token = auth_mod.issue_tokens(u)["access_token"]
        return u, token

    return asyncio.run(_go())


@pytest.fixture(scope="session")
def end_user():
    return _make_user("user")


@pytest.fixture(scope="session")
def plain_admin_user():
    return _make_user("admin")


# ---------------- Phase 4 endpoints ----------------
class TestFinanceIntelligence:
    def test_30_days(self, session, admin_headers):
        r = session.get(f"{API}/admin/finance/intelligence?days=30", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("revenue", "ai_cost", "storage_cost", "voice_cost", "total_cost",
                  "profit", "margin_pct", "series", "mrr", "plan_distribution"):
            assert k in d, f"missing {k}"
        for k in ("revenue", "ai_cost", "storage_cost", "voice_cost", "total_cost", "profit", "margin_pct"):
            assert isinstance(d[k], (int, float)), f"{k} not numeric"
        assert len(d["series"]) == 30
        assert {"date", "revenue", "cost", "profit"} <= set(d["series"][0].keys())

    def test_90_days(self, session, admin_headers):
        r = session.get(f"{API}/admin/finance/intelligence?days=90", headers=admin_headers, timeout=60)
        assert r.status_code == 200
        assert len(r.json()["series"]) == 90

    def test_365_days_bounded(self, session, admin_headers):
        r = session.get(f"{API}/admin/finance/intelligence?days=365", headers=admin_headers, timeout=120)
        assert r.status_code == 200
        assert len(r.json()["series"]) == 365


class TestUserGrowth:
    def test_default(self, session, admin_headers):
        r = session.get(f"{API}/admin/metrics/user-growth?days=14", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "series" in d
        # min days is bounded to 7 in code but 14 is ok
        assert len(d["series"]) == 14
        first = d["series"][0]
        assert {"date", "new_users", "active", "churn"} <= set(first.keys())
        assert isinstance(first["new_users"], int)


class TestHeatmap:
    def test_grid_shape(self, session, admin_headers):
        r = session.get(f"{API}/admin/metrics/usage-heatmap?days=14", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "grid" in d and "cost_grid" in d
        assert len(d["grid"]) == 7 and len(d["grid"][0]) == 24
        assert len(d["cost_grid"]) == 7 and len(d["cost_grid"][0]) == 24
        assert d["rows"][0] == "Sun"


class TestProvidersLive:
    def test_live_ping(self, session, admin_headers):
        r = session.get(f"{API}/admin/health/providers-live", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "providers" in d and "checked_at" in d
        assert isinstance(d["providers"], list)
        if d["providers"]:
            p = d["providers"][0]
            for k in ("name", "status", "latency_ms", "enabled"):
                assert k in p


class TestInfrastructure:
    def test_psutil_metrics(self, session, admin_headers):
        r = session.get(f"{API}/admin/infrastructure", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("cpu", "memory", "disk", "database", "redis", "api_latency_ms"):
            assert k in d
        # CPU usually has 'percent', skip if psutil failed
        if "percent" in d["cpu"]:
            assert isinstance(d["cpu"]["percent"], (int, float))
        assert d["database"]["status"] in ("healthy", "warning", "critical")


class TestLoginAlerts:
    def test_audit_with_flags(self, session, admin_headers):
        r = session.get(f"{API}/admin/security/login-alerts?days=7", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "items" in d
        if d["items"]:
            row = d["items"][0]
            assert "new_device" in row and "new_country" in row
            assert isinstance(row["new_device"], bool)


class TestPerUserUsage:
    def test_user_usage(self, session, admin_headers, end_user):
        u, _ = end_user
        r = session.get(f"{API}/admin/users/{u['id']}/usage?days=30", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("user", "counts", "ai", "by_feature", "storage", "active_sessions"):
            assert k in d
        for ck in ("messages", "voice_calls", "documents", "journal_entries"):
            assert ck in d["counts"]
        for ak in ("requests", "input_tokens", "output_tokens", "cost_usd"):
            assert ak in d["ai"]

    def test_user_usage_404(self, session, admin_headers):
        r = session.get(f"{API}/admin/users/does-not-exist-xyz/usage", headers=admin_headers, timeout=15)
        assert r.status_code == 404


class TestImpersonate:
    def test_super_admin_can_impersonate(self, session, admin_headers, end_user):
        u, _ = end_user
        r = session.post(f"{API}/admin/users/{u['id']}/impersonate",
                         json={"reason": "support_test", "duration_minutes": 30},
                         headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert "access_token" in d and "refresh_token" in d
        assert d["impersonated_by"] == ADMIN_EMAIL
        # audit row should exist
        a = session.get(f"{API}/admin/audit?limit=50", headers=admin_headers, timeout=15).json()
        assert any(it.get("action") == "user.impersonated" for it in a.get("items", []))

    def test_plain_admin_rejected(self, session, plain_admin_user, end_user):
        admin_user, admin_token = plain_admin_user
        u, _ = end_user
        hdrs = {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}
        r = session.post(f"{API}/admin/users/{u['id']}/impersonate",
                         json={"reason": "x"}, headers=hdrs, timeout=15)
        assert r.status_code == 403


class TestPublicFeatureFlags:
    def test_anon_returns_15_defaults(self, session):
        r = session.get(f"{API}/features/public", timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "features" in d
        feats = d["features"]
        expected = {"chat", "voice_assistant", "ai_calls", "journal", "memory_bank",
                    "knowledge_vault", "knowledge_graph", "family_hub", "health",
                    "finance_brain", "career_copilot", "digital_twin", "daily_briefing",
                    "chief_of_staff", "search_everything"}
        assert expected.issubset(set(feats.keys())), f"missing: {expected - set(feats.keys())}"

    def test_disable_journal_propagates(self, session, admin_headers, end_user):
        _, user_token = end_user
        # Disable journal
        body = {"key": "journal", "label": "Journal", "status": "disabled", "rollout_pct": 0, "audience": []}
        r = session.put(f"{API}/admin/features", json=body, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        try:
            # Authenticated end-user request
            r2 = session.get(f"{API}/features/public",
                             headers={"Authorization": f"Bearer {user_token}"}, timeout=15)
            assert r2.status_code == 200
            assert r2.json()["features"]["journal"] is False
            # Anon also false
            r3 = session.get(f"{API}/features/public", timeout=15)
            assert r3.json()["features"]["journal"] is False
        finally:
            # Restore
            restore = {"key": "journal", "label": "Journal", "status": "enabled", "rollout_pct": 100, "audience": []}
            session.put(f"{API}/admin/features", json=restore, headers=admin_headers, timeout=15)
        # Confirm restored
        r4 = session.get(f"{API}/features/public", timeout=15)
        assert r4.json()["features"]["journal"] is True


# ---------------- Live AI model routing ----------------
class TestLiveModelRouting:
    """Switch admin_feature_models[chat] and confirm the next /api/chat uses the new model."""

    @pytest.fixture
    def chat_session_id(self):
        return f"TEST_p4_chat_{uuid.uuid4().hex[:8]}"

    def _set_chat_model(self, session, admin_headers, model_id):
        body = {"feature": "chat", "primary_model_id": model_id, "fallback_model_ids": []}
        r = session.post(f"{API}/admin/ai/feature-models", json=body, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        return r.json()["item"]

    def test_route_switch_takes_effect(self, session, admin_headers, end_user, chat_session_id):
        _, user_token = end_user
        # Baseline = nova-lite
        self._set_chat_model(session, admin_headers, "amazon.nova-lite-v1:0")
        # Switch to nova-pro
        self._set_chat_model(session, admin_headers, "amazon.nova-pro-v1:0")
        # Wait > cache TTL
        time.sleep(17)

        # Fire one chat request as the end user
        chat_body = {"session_id": chat_session_id, "message": "Say hi in 3 words.", "image_b64": None, "image_mime": None}
        chat_hdrs = {"Authorization": f"Bearer {user_token}", "Content-Type": "application/json"}
        rc = session.post(f"{API}/chat", json=chat_body, headers=chat_hdrs, timeout=90)
        # Restore lite even if chat failed
        try:
            assert rc.status_code == 200, f"/api/chat failed: {rc.status_code} {rc.text[:300]}"
            assert "reply" in rc.json() or "message" in rc.json() or isinstance(rc.json(), dict)
        finally:
            self._set_chat_model(session, admin_headers, "amazon.nova-lite-v1:0")

        # Inspect /admin/ai/usage — confirm model_id appears
        usage = session.get(f"{API}/admin/ai/usage?days=1", headers=admin_headers, timeout=30).json()
        assert "by_model" in usage
        assert "amazon.nova-pro-v1:0" in usage["by_model"], (
            f"Expected nova-pro in usage.by_model, got {list(usage['by_model'].keys())}"
        )
        # by_feature must include 'chat'
        assert "chat" in usage["by_feature"]
        # tokens & cost should be non-zero for nova-pro
        m = usage["by_model"]["amazon.nova-pro-v1:0"]
        total_tokens = m.get("tokens", m.get("input_tokens", 0) + m.get("output_tokens", 0))
        assert total_tokens > 0, f"expected tokens>0, got {m}"
        assert m.get("cost_usd", 0.0) > 0.0, f"expected cost>0, got {m}"
        assert m.get("requests", 0) >= 1


# ---------------- Regression ----------------
class TestRegression:
    def test_expo_qr(self, session):
        r = session.get(f"{API}/expo-qr", timeout=15)
        assert r.status_code == 200

    def test_otp_request(self, session):
        email = f"TEST_p4_reg_{uuid.uuid4().hex[:6]}@example.com"
        r = session.post(f"{API}/auth/otp/request", json={"email": email}, timeout=20)
        assert r.status_code in (200, 201, 202)

    def test_chat_persists_message(self, session, end_user):
        _, token = end_user
        sid = f"TEST_p4_reg_{uuid.uuid4().hex[:8]}"
        body = {"session_id": sid, "message": "hello", "image_b64": None, "image_mime": None}
        r = session.post(f"{API}/chat", json=body,
                         headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                         timeout=90)
        assert r.status_code == 200, r.text
        # Confirm chat_message row was persisted via admin user-usage
        import sys, asyncio
        sys.path.insert(0, "/app/backend")
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        from motor.motor_asyncio import AsyncIOMotorClient

        async def _count():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            return await db.chat_messages.count_documents({"session_id": sid})

        n = asyncio.run(_count())
        assert n >= 1
