"""
Phase 2 backend tests for Nova AI Assistant.

Covers (per review request):
  - Chat emotion classification
  - Daily Briefing (Chennai lat/lon)
  - Smart reminder auto-creation via chat
  - Calendar/Email "Google not connected" graceful path
  - Google OAuth endpoints (no callback handshake)
  - Voice (ElevenLabs) status / tts / voices
  - Notifications: ingest / list / stats
  - Finance Brain: process-notification / spending-summary / insights / categories
  - Dashboard: combined + sub-endpoints
  - Knowledge Vault: upload / list / search / delete / stats
  - Phone Calls (mock): create / list / get / cancel
  - Incoming calls (mock): register / active / missed -> missed-call reminder
  - Digital Twin: profile / learn / style-prompt
  - Chief of Staff: morning-briefing / suggestions
  - Chat with Tools: use_tools=true does not crash
"""
import io
import os
import time
import pytest
import requests


# ---------- helpers ----------
def _no_mongo_id(obj):
    if isinstance(obj, dict):
        assert "_id" not in obj, f"_id leak: {list(obj.keys())}"
        for v in obj.values():
            _no_mongo_id(v)
    elif isinstance(obj, list):
        for v in obj:
            _no_mongo_id(v)


# ============================================================
# Chat emotion classification
# ============================================================
class TestChatEmotion:
    def test_emotion_field_present_and_valid(self, base_url, api_client):
        r = api_client.post(f"{base_url}/api/sessions", json={"title": "TEST_emotion"})
        sid = r.json()["id"]
        try:
            r = api_client.post(
                f"{base_url}/api/chat",
                json={"session_id": sid, "message": "I am so frustrated! Nothing works today."},
                timeout=90,
            )
            assert r.status_code == 200, r.text
            data = r.json()
            _no_mongo_id(data)
            emo = data["user_message"].get("emotion")
            assert emo in {"neutral", "frustrated", "urgent", "excited", "sad"}, f"bad emotion {emo!r}"
        finally:
            api_client.delete(f"{base_url}/api/sessions/{sid}")


# ============================================================
# Daily Briefing
# ============================================================
class TestBriefing:
    def test_briefing_chennai(self, base_url, api_client):
        r = api_client.get(
            f"{base_url}/api/briefing",
            params={"lat": 13.0827, "lon": 80.2707, "tz_offset": 330},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        _no_mongo_id(data)
        assert "greeting" in data
        assert "weather" in data
        assert "pending_reminders" in data
        assert "active_goals" in data
        # integrations.voice.enabled should be True (ElevenLabs configured)
        integ = data.get("integrations") or {}
        voice = integ.get("voice") or {}
        assert voice.get("enabled") is True, f"voice.enabled not true: {voice}"


# ============================================================
# Smart reminder via chat
# ============================================================
class TestSmartReminderFromChat:
    def test_chat_creates_reminder(self, base_url, api_client):
        r = api_client.post(f"{base_url}/api/sessions", json={"title": "TEST_smart_rem"})
        sid = r.json()["id"]
        unique = f"TEST_reimb_{int(time.time())}"
        msg = f"Remind me to submit {unique} after certification approval"
        try:
            r = api_client.post(
                f"{base_url}/api/chat",
                json={"session_id": sid, "message": msg},
                timeout=90,
            )
            assert r.status_code == 200, r.text
            # poll reminders for up to ~10s (action extraction may run inline or just-after)
            found = None
            deadline = time.time() + 12
            while time.time() < deadline and not found:
                lst = api_client.get(f"{base_url}/api/reminders").json()
                _no_mongo_id(lst)
                for rem in lst:
                    text = (rem.get("text") or "") + " " + (rem.get("condition") or "")
                    if unique in text:
                        found = rem
                        break
                if not found:
                    time.sleep(1.5)
            assert found is not None, "Reminder was not created from chat message"
            # cleanup reminder
            api_client.delete(f"{base_url}/api/reminders/{found['id']}")
        finally:
            api_client.delete(f"{base_url}/api/sessions/{sid}")


# ============================================================
# Calendar action when Google not connected -> graceful
# ============================================================
class TestCalendarGracefulNoGoogle:
    def test_calendar_request_does_not_crash(self, base_url, api_client):
        r = api_client.post(f"{base_url}/api/sessions", json={"title": "TEST_cal"})
        sid = r.json()["id"]
        try:
            r = api_client.post(
                f"{base_url}/api/chat",
                json={"session_id": sid, "message": "Schedule a meeting tomorrow at 3 PM about deployment"},
                timeout=90,
            )
            assert r.status_code == 200, r.text
            reply = (r.json()["assistant_message"]["content"] or "").lower()
            # We just want a non-crashing response; reply usually mentions google/connect/sign-in
            assert len(reply.strip()) > 0
        finally:
            api_client.delete(f"{base_url}/api/sessions/{sid}")


# ============================================================
# Google OAuth (URL only — callback can't be completed in this env)
# ============================================================
class TestGoogle:
    def test_auth_url_returns_url_with_client_id(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/google/auth-url", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        url = data.get("url") or data.get("auth_url") or ""
        assert "client_id=" in url, f"client_id missing in URL: {url[:200]}"
        assert "accounts.google.com" in url

    def test_google_status_disconnected(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/google/status", timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("connected") is False

    def test_me_unauthenticated(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/me", timeout=30)
        assert r.status_code == 401, f"expected 401, got {r.status_code} {r.text[:200]}"


# ============================================================
# Voice (ElevenLabs)
# ============================================================
class TestVoice:
    def test_voice_status_enabled(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/voice/status", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("enabled") is True, f"voice not enabled: {data}"

    def test_voice_tts_returns_audio_b64(self, base_url, api_client):
        r = api_client.post(
            f"{base_url}/api/voice/tts",
            json={"text": "Hello from Nova test."},
            timeout=60,
        )
        assert r.status_code == 200, r.text[:500]
        data = r.json()
        audio = data.get("audio_base64") or data.get("audio_b64") or ""
        assert isinstance(audio, str) and len(audio) > 100, "audio_base64 too short/missing"

    def test_voice_list_voices(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/voice/voices", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        # Either a list or a dict containing 'voices'
        voices = data if isinstance(data, list) else data.get("voices", [])
        assert isinstance(voices, list) and len(voices) >= 1


# ============================================================
# Notifications ingest + stats
# ============================================================
class TestNotifications:
    nid = None

    def test_ingest_bank_notification(self, base_url, api_client):
        payload = {
            "title": "HDFC Bank",
            "text": "Rs.500 debited from A/c X1234 at Swiggy on 19-Jun. Avl bal Rs.5000",
            "package": "com.hdfc",
        }
        r = api_client.post(f"{base_url}/api/notifications/ingest", json=payload, timeout=45)
        assert r.status_code == 200, r.text
        data = r.json()
        _no_mongo_id(data)
        assert "id" in data
        TestNotifications.nid = data["id"]
        # Classification should mark as transaction (field name: 'kind')
        kind = (data.get("kind") or data.get("category") or data.get("type") or "").lower()
        assert "trans" in kind or kind in {"bank", "finance", "payment"}, f"unexpected kind: {kind}; full: {data}"
        # Should also extract amount and merchant for a debit notification
        assert data.get("amount") == 500.0
        assert (data.get("merchant") or "").lower() == "swiggy"

    def test_list_notifications_contains_ingested(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/notifications", timeout=30)
        assert r.status_code == 200, r.text
        lst = r.json()
        _no_mongo_id(lst)
        assert any(n.get("id") == TestNotifications.nid for n in lst)

    def test_stats_endpoint(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/notifications/stats", timeout=30)
        assert r.status_code == 200, r.text
        _no_mongo_id(r.json())

    @classmethod
    def teardown_class(cls):
        base = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
        if cls.nid:
            try:
                requests.delete(f"{base}/api/notifications/{cls.nid}", timeout=10)
            except Exception:
                pass


# ============================================================
# Finance Brain
# ============================================================
class TestFinance:
    def test_process_notification(self, base_url, api_client):
        payload = {
            "title": "ICICI Bank",
            "text": "Rs.250 spent on Zomato using ICICI Card on 20-Jun.",
            "package": "com.icici",
        }
        r = api_client.post(f"{base_url}/api/finance/process-notification", json=payload, timeout=45)
        assert r.status_code == 200, r.text
        _no_mongo_id(r.json())

    def test_spending_summary(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/finance/spending-summary", params={"days": 30}, timeout=30)
        assert r.status_code == 200, r.text
        _no_mongo_id(r.json())

    def test_insights_and_categories(self, base_url, api_client):
        for path in ["/api/finance/insights", "/api/finance/categories"]:
            r = api_client.get(f"{base_url}{path}", timeout=30)
            assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"


# ============================================================
# Dashboard
# ============================================================
class TestDashboard:
    @pytest.mark.parametrize(
        "path",
        [
            "/api/dashboard?days=30",
            "/api/dashboard/usage",
            "/api/dashboard/spending",
            "/api/dashboard/productivity",
            "/api/dashboard/insights",
        ],
    )
    def test_dashboard_endpoints_ok(self, base_url, api_client, path):
        r = api_client.get(f"{base_url}{path}", timeout=45)
        assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:300]}"
        _no_mongo_id(r.json())


# ============================================================
# Knowledge Vault
# ============================================================
class TestKnowledge:
    doc_id = None

    def test_upload_and_list(self, base_url):
        content = b"Nova test knowledge document. Keywords: pineapple, quokka, archipelago."
        files = {"file": ("TEST_nova_kb.txt", io.BytesIO(content), "text/plain")}
        r = requests.post(f"{base_url}/api/knowledge/upload", files=files, timeout=60)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        _no_mongo_id(data)
        TestKnowledge.doc_id = data.get("id") or data.get("doc_id") or (data.get("document") or {}).get("id")
        assert TestKnowledge.doc_id, f"no doc id in upload response: {data}"

        r = requests.get(f"{base_url}/api/knowledge/documents", timeout=30)
        assert r.status_code == 200
        body = r.json()
        _no_mongo_id(body)
        docs = body if isinstance(body, list) else body.get("documents", [])
        assert any((d.get("id") or d.get("doc_id")) == TestKnowledge.doc_id for d in docs)

    def test_search(self, base_url):
        r = requests.post(
            f"{base_url}/api/knowledge/search",
            json={"query": "quokka", "limit": 5},
            timeout=45,
        )
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        _no_mongo_id(body)
        results = body if isinstance(body, list) else body.get("results", [])
        assert isinstance(results, list)

    def test_stats(self, base_url):
        r = requests.get(f"{base_url}/api/knowledge/stats", timeout=30)
        assert r.status_code == 200
        _no_mongo_id(r.json())

    def test_delete(self, base_url):
        assert TestKnowledge.doc_id, "no doc to delete"
        r = requests.delete(f"{base_url}/api/knowledge/documents/{TestKnowledge.doc_id}", timeout=30)
        assert r.status_code == 200


# ============================================================
# Phone Calls (MOCK)
# ============================================================
class TestCallsMock:
    call_id = None

    def test_create_call(self, base_url, api_client):
        payload = {"phone_number": "+919999999999", "purpose": "TEST_purpose"}
        r = api_client.post(f"{base_url}/api/calls", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        _no_mongo_id(data)
        # response: {"call": {...}, "message": "..."} or direct dict
        call = data.get("call") or data
        TestCallsMock.call_id = call.get("id") or data.get("call_id") or data.get("id")
        assert TestCallsMock.call_id, f"no call id in response: {data}"

    def test_list_and_get(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/calls", timeout=30)
        assert r.status_code == 200
        _no_mongo_id(r.json())
        r = api_client.get(f"{base_url}/api/calls/{TestCallsMock.call_id}", timeout=30)
        assert r.status_code == 200
        _no_mongo_id(r.json())

    def test_cancel(self, base_url, api_client):
        # Create a fresh scheduled call (so it stays in "pending"/"scheduled" while we cancel)
        scheduled = "2099-01-01T00:00:00+00:00"
        r = api_client.post(
            f"{base_url}/api/calls",
            json={"phone_number": "+919999999998", "purpose": "TEST_cancel", "scheduled_at": scheduled},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        call = (r.json().get("call") or r.json())
        cid = call.get("id")
        r = api_client.post(f"{base_url}/api/calls/{cid}/cancel", timeout=30)
        assert r.status_code == 200, r.text


# ============================================================
# Incoming calls (MOCK) + missed-call reminders
# ============================================================
class TestIncomingCalls:
    icall_id = None
    reminder_id = None

    def test_register(self, base_url, api_client):
        payload = {"phone_number": "+919876543210", "contact_name": "TEST_Caller"}
        r = api_client.post(f"{base_url}/api/incoming-calls/register", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        _no_mongo_id(data)
        TestIncomingCalls.icall_id = data.get("id") or (data.get("call") or {}).get("id")
        assert TestIncomingCalls.icall_id

    def test_active_list(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/incoming-calls/active", timeout=30)
        assert r.status_code == 200
        _no_mongo_id(r.json())

    def test_mark_missed_creates_reminder(self, base_url, api_client):
        r = api_client.post(
            f"{base_url}/api/incoming-calls/{TestIncomingCalls.icall_id}/missed",
            timeout=30,
        )
        assert r.status_code == 200, r.text
        # Verify missed-calls list contains a pending reminder for this call
        r = api_client.get(f"{base_url}/api/missed-calls", params={"status": "pending"}, timeout=30)
        assert r.status_code == 200
        body = r.json()
        _no_mongo_id(body)
        reminders = body if isinstance(body, list) else body.get("reminders", [])
        assert any(
            m.get("call_id") == TestIncomingCalls.icall_id
            for m in reminders
        ), f"No missed-call reminder for call {TestIncomingCalls.icall_id}"


# ============================================================
# Digital Twin
# ============================================================
class TestTwin:
    def test_profile(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/twin/profile", timeout=30)
        assert r.status_code == 200, r.text
        _no_mongo_id(r.json())

    def test_learn(self, base_url, api_client):
        r = api_client.post(
            f"{base_url}/api/twin/learn",
            json={"message": "I prefer concise responses and dark mode.", "context": "chat"},
            timeout=30,
        )
        assert r.status_code == 200, r.text

    def test_style_prompt(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/twin/style-prompt", timeout=30)
        assert r.status_code == 200, r.text


# ============================================================
# Chief of Staff
# ============================================================
class TestChief:
    def test_morning_briefing(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/chief/morning-briefing", timeout=60)
        assert r.status_code == 200, r.text[:300]
        _no_mongo_id(r.json())

    def test_suggestions(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/chief/suggestions", timeout=60)
        assert r.status_code == 200, r.text[:300]
        _no_mongo_id(r.json())


# ============================================================
# Chat with Tools
# ============================================================
class TestChatTools:
    def test_chat_tools_no_crash(self, base_url, api_client):
        r = api_client.post(f"{base_url}/api/sessions", json={"title": "TEST_tools"})
        sid = r.json()["id"]
        try:
            r = api_client.post(
                f"{base_url}/api/chat/tools",
                json={"session_id": sid, "message": "What is 2+2?", "use_tools": True},
                timeout=120,
            )
            assert r.status_code == 200, r.text[:400]
            _no_mongo_id(r.json())
        finally:
            api_client.delete(f"{base_url}/api/sessions/{sid}")
