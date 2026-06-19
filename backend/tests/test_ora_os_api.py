"""
ORA OS backend smoke + integration tests (post Nova->ORA rebrand).

Covers the 14 review-request bullets:
  - Root API surface (ORA OS message + Nova-Lite model id)
  - Briefing aggregator
  - Sessions CRUD
  - Chat (Bedrock Nova Lite) and the ORA identity in the system prompt
  - Memories / Goals / Reminders CRUD
  - Voice status (ElevenLabs live key)
  - Google OAuth (status + auth-url)
  - Finance NL transaction extractor + spending summary
  - Health metrics catalog + log + summary
  - Career profile defaults
  - Timeline events for today
"""
import os
import time
import datetime as dt
import pytest


# --------- 1. Root: ORA OS branding ---------
class TestRootBranding:
    def test_root_says_ora_os(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("message") == "ORA OS API", f"Expected ORA OS branding, got: {data}"
        # nova-lite is the AWS Bedrock model name (not the assistant name)
        assert data.get("model") == "amazon.nova-lite-v1:0"


# --------- 2. Briefing aggregator ---------
class TestBriefing:
    def test_briefing_shape(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/briefing")
        assert r.status_code == 200, r.text
        data = r.json()
        # Required keys
        for k in ("greeting", "name", "pending_reminders", "active_goals", "important_dates", "integrations"):
            assert k in data, f"missing key {k}"
        # weather may be null but key should exist
        assert "weather" in data
        assert isinstance(data["pending_reminders"], list)
        assert isinstance(data["active_goals"], list)
        assert isinstance(data["important_dates"], list)
        assert isinstance(data["integrations"], dict)


# --------- 3. Sessions ---------
class TestSessions:
    created_ids: list[str] = []

    def test_create_session(self, base_url, api_client):
        r = api_client.post(f"{base_url}/api/sessions", json={"title": "TEST_OraSession"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "id" in data and "title" in data
        assert data["title"] == "TEST_OraSession"
        assert "_id" not in data
        TestSessions.created_ids.append(data["id"])

    def test_list_sessions(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/sessions")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    @classmethod
    def teardown_class(cls):
        import requests
        base = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
        for sid in cls.created_ids:
            try:
                requests.delete(f"{base}/api/sessions/{sid}", timeout=10)
            except Exception:
                pass


# --------- 4. Chat (Bedrock) + ORA identity ---------
class TestChatBedrock:
    sid = None

    def test_chat_returns_assistant_and_persists(self, base_url, api_client):
        s = api_client.post(f"{base_url}/api/sessions", json={"title": "TEST_OraChat"})
        sid = s.json()["id"]
        TestChatBedrock.sid = sid

        r = api_client.post(
            f"{base_url}/api/chat",
            json={"session_id": sid, "message": "Say a one-sentence hello."},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["session_id"] == sid
        for k in ("user_message", "assistant_message"):
            assert k in data
            assert data[k]["session_id"] == sid
        assert data["assistant_message"]["role"] == "assistant"
        text = data["assistant_message"]["content"].strip()
        assert len(text) > 0

    def test_chat_identity_is_ora_not_nova(self, base_url, api_client):
        """Critical rebrand test: assistant should self-identify as ORA, never Nova."""
        sid = TestChatBedrock.sid
        assert sid, "session must exist from previous test"
        r = api_client.post(
            f"{base_url}/api/chat",
            json={
                "session_id": sid,
                "message": "What is your name? Reply with only the name and nothing else.",
            },
            timeout=90,
        )
        assert r.status_code == 200, r.text
        reply = r.json()["assistant_message"]["content"].strip().lower()
        # ORA must appear, Nova must NOT (rebrand assertion)
        assert "ora" in reply, f"Assistant did not self-identify as ORA: {reply!r}"
        assert "nova" not in reply, f"Assistant still leaks Nova name after rebrand: {reply!r}"

    @classmethod
    def teardown_class(cls):
        import requests
        if cls.sid:
            base = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
            try:
                requests.delete(f"{base}/api/sessions/{cls.sid}", timeout=10)
            except Exception:
                pass


# --------- 5. Memories ---------
class TestMemories:
    mem_id = None

    def test_list_memories_initial(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/memories")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_memory_and_appears_in_list(self, base_url, api_client):
        payload = {
            "category": "preference",
            "subject": "TEST_FavouriteColor",
            "content": "Burnt orange",
            "importance": 3,
        }
        r = api_client.post(f"{base_url}/api/memories", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["subject"] == "TEST_FavouriteColor"
        assert "_id" not in data
        TestMemories.mem_id = data["id"]

        lst = api_client.get(f"{base_url}/api/memories").json()
        assert any(m["id"] == data["id"] for m in lst)

    @classmethod
    def teardown_class(cls):
        import requests
        if cls.mem_id:
            base = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
            try:
                requests.delete(f"{base}/api/memories/{cls.mem_id}", timeout=10)
            except Exception:
                pass


# --------- 6. Goals ---------
class TestGoals:
    goal_id = None

    def test_list_goals(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/goals")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_goal(self, base_url, api_client):
        r = api_client.post(
            f"{base_url}/api/goals",
            json={"title": "TEST_OraGoal", "description": "Smoke test goal", "target": "Q1"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["title"] == "TEST_OraGoal"
        TestGoals.goal_id = data["id"]

    @classmethod
    def teardown_class(cls):
        import requests
        if cls.goal_id:
            base = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
            try:
                requests.delete(f"{base}/api/goals/{cls.goal_id}", timeout=10)
            except Exception:
                pass


# --------- 7. Reminders ---------
class TestReminders:
    reminder_id = None

    def test_list_reminders(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/reminders")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_reminder(self, base_url, api_client):
        r = api_client.post(
            f"{base_url}/api/reminders",
            json={"text": "TEST_ora reminder", "condition": "when home"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["text"] == "TEST_ora reminder"
        TestReminders.reminder_id = data["id"]

    @classmethod
    def teardown_class(cls):
        import requests
        if cls.reminder_id:
            base = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
            try:
                requests.delete(f"{base}/api/reminders/{cls.reminder_id}", timeout=10)
            except Exception:
                pass


# --------- 8. Voice (ElevenLabs status) ---------
class TestVoice:
    def test_voice_status_enabled(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/voice/status")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("enabled") is True, f"ElevenLabs voice not enabled: {data}"
        # Should expose voice info since the key is configured
        # Common shape includes voice_id; tolerate any of these
        assert any(k in data for k in ("voice_id", "voice", "voices", "voice_info")), data


# --------- 9. Google OAuth ---------
class TestGoogle:
    def test_google_status_initially_disconnected(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/google/status")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "connected" in data
        assert data["connected"] is False, f"Expected initially disconnected: {data}"

    def test_google_auth_url(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/google/auth-url")
        assert r.status_code == 200, r.text
        data = r.json()
        # Must contain a Google accounts OAuth URL
        url = data.get("auth_url") or data.get("url") or ""
        assert "accounts.google.com" in url, f"Not a Google OAuth URL: {data}"
        assert "client_id=" in url


# --------- 10. Finance ---------
class TestFinance:
    def test_process_notification_swiggy(self, base_url, api_client):
        payload = {
            "title": "HDFC Bank Alert",
            "text": "Rs.500.00 debited from A/c XX1234 at SWIGGY on 15-JAN-26. Avl Bal Rs.12000",
            "app_name": "com.hdfc.alerts",
        }
        r = api_client.post(f"{base_url}/api/finance/process-notification", json=payload, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        # Should be a transaction-like object. Accept either direct fields or wrapped.
        flat = data.get("transaction", data)
        assert isinstance(flat, dict), data
        # At minimum amount or merchant info should be extracted
        amount_keys = [k for k in flat if "amount" in k.lower()]
        merchant_keys = [k for k in flat if "merchant" in k.lower() or "payee" in k.lower() or "description" in k.lower()]
        assert amount_keys or merchant_keys, f"No transaction-shaped fields: {flat}"

    def test_spending_summary_shape(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/finance/spending-summary")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, dict)
        # Tolerate has_data:false initial state
        assert ("has_data" in data) or ("total" in data) or ("transactions" in data) or ("by_category" in data)


# --------- 11. Health ---------
class TestHealth:
    log_id = None

    def test_metrics_catalog(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/health/metrics")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "metrics" in data
        assert isinstance(data["metrics"], (list, dict))
        assert len(data["metrics"]) > 0

    def test_log_and_summary(self, base_url, api_client):
        r = api_client.post(
            f"{base_url}/api/health/log",
            json={"metric": "water_glasses", "value": 6, "note": "TEST_ora"},
        )
        assert r.status_code == 200, r.text
        doc = r.json()
        # id must be returned (so we can clean up)
        assert "id" in doc
        TestHealth.log_id = doc["id"]

        s = api_client.get(f"{base_url}/api/health/summary")
        assert s.status_code == 200, s.text
        assert isinstance(s.json(), dict)

    @classmethod
    def teardown_class(cls):
        import requests
        if cls.log_id:
            base = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
            try:
                requests.delete(f"{base}/api/health/logs/{cls.log_id}", timeout=10)
            except Exception:
                pass


# --------- 12. Career profile ---------
class TestCareer:
    def test_career_profile(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/career/profile")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, dict)
        assert "_id" not in data


# --------- 13. Timeline today ---------
class TestTimeline:
    def test_timeline_today(self, base_url, api_client):
        today = dt.date.today().isoformat()
        r = api_client.get(f"{base_url}/api/timeline", params={"date": today})
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, dict)
        # events + stats
        assert "events" in data
        assert "stats" in data
        assert isinstance(data["events"], list)
