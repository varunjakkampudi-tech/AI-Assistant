"""
Backend tests for Nova AI Assistant API.
Covers: root info, session CRUD, chat (Bedrock Nova Lite), multi-turn context,
message persistence, transcription (Whisper via Emergent), edge cases.
"""
import os
import time
import struct
import wave
import pytest
import requests
from pathlib import Path


# ---------------- helpers ----------------
def _make_silent_wav(path: str, seconds: float = 1.0, framerate: int = 16000):
    n_frames = int(seconds * framerate)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(framerate)
        # Tiny low-amplitude tone so Whisper doesn't reject pure silence
        for i in range(n_frames):
            val = int(500 * ((i % 200) / 200.0 - 0.5))
            wf.writeframesraw(struct.pack("<h", val))


def _no_mongo_id(obj):
    """Recursively assert no '_id' key leaking in response payloads."""
    if isinstance(obj, dict):
        assert "_id" not in obj, f"Found _id leaking in response: {obj}"
        for v in obj.values():
            _no_mongo_id(v)
    elif isinstance(obj, list):
        for v in obj:
            _no_mongo_id(v)


# ---------------- 1. Root ----------------
class TestRoot:
    def test_root_returns_api_info(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "message" in data and "Nova" in data["message"]
        assert data.get("model") == "amazon.nova-lite-v1:0"


# ---------------- 2. Session CRUD ----------------
class TestSessions:
    created_ids = []

    def test_create_session(self, base_url, api_client):
        r = api_client.post(f"{base_url}/api/sessions", json={"title": "TEST_Session_A"})
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("id", "title", "created_at", "updated_at"):
            assert k in data, f"missing key {k}"
        assert data["title"] == "TEST_Session_A"
        _no_mongo_id(data)
        TestSessions.created_ids.append(data["id"])

    def test_list_sessions_sorted_desc(self, base_url, api_client):
        # Create two extra sessions with a small gap to verify ordering
        ids = []
        for title in ["TEST_S1", "TEST_S2"]:
            r = api_client.post(f"{base_url}/api/sessions", json={"title": title})
            assert r.status_code == 200
            ids.append(r.json()["id"])
            time.sleep(0.05)
        TestSessions.created_ids.extend(ids)

        r = api_client.get(f"{base_url}/api/sessions")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) >= 2
        _no_mongo_id(data)
        ts = [s["updated_at"] for s in data]
        assert ts == sorted(ts, reverse=True), "Sessions not sorted by updated_at desc"

    def test_delete_session_cleans_messages(self, base_url, api_client):
        # Create a session, post a chat to add messages, then delete and verify
        r = api_client.post(f"{base_url}/api/sessions", json={"title": "TEST_DEL"})
        sid = r.json()["id"]

        # Add a message via /chat (only if Bedrock works); if not, skip the persistence delete check
        chat_r = api_client.post(
            f"{base_url}/api/chat",
            json={"session_id": sid, "message": "Hi (test)"},
            timeout=90,
        )
        # Regardless of chat success, ensure session deletes
        d = api_client.delete(f"{base_url}/api/sessions/{sid}")
        assert d.status_code == 200
        assert d.json().get("ok") is True

        # Verify list no longer contains it
        lst = api_client.get(f"{base_url}/api/sessions").json()
        assert all(s["id"] != sid for s in lst)

        # Messages endpoint should now return [] for this session
        m = api_client.get(f"{base_url}/api/sessions/{sid}/messages")
        assert m.status_code == 200
        assert m.json() == []

        if chat_r.status_code != 200:
            pytest.fail(f"/api/chat failed: {chat_r.status_code} {chat_r.text[:300]}")

    @classmethod
    def teardown_class(cls):
        base = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
        for sid in cls.created_ids:
            try:
                requests.delete(f"{base}/api/sessions/{sid}", timeout=10)
            except Exception:
                pass


# ---------------- 3. Chat (Bedrock Nova Lite) ----------------
class TestChat:
    sid = None

    def test_chat_returns_assistant_reply_and_persists(self, base_url, api_client):
        # create session
        r = api_client.post(f"{base_url}/api/sessions", json={"title": "TEST_Chat"})
        sid = r.json()["id"]
        TestChat.sid = sid

        payload = {"session_id": sid, "message": "My name is Pyro. Please remember it."}
        r = api_client.post(f"{base_url}/api/chat", json=payload, timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        _no_mongo_id(data)

        assert data["session_id"] == sid
        for k in ("user_message", "assistant_message"):
            assert k in data
            for f in ("id", "session_id", "role", "content", "created_at"):
                assert f in data[k]
        assert data["user_message"]["role"] == "user"
        assert data["user_message"]["content"] == payload["message"]
        assert data["assistant_message"]["role"] == "assistant"
        assert isinstance(data["assistant_message"]["content"], str)
        assert len(data["assistant_message"]["content"].strip()) > 0

        # GET messages should now contain both, chronologically
        m = api_client.get(f"{base_url}/api/sessions/{sid}/messages")
        assert m.status_code == 200
        msgs = m.json()
        _no_mongo_id(msgs)
        assert len(msgs) >= 2
        assert msgs[0]["role"] == "user"
        assert msgs[1]["role"] == "assistant"

    def test_chat_multi_turn_context(self, base_url, api_client):
        sid = TestChat.sid
        assert sid, "previous test must have created a session"
        r = api_client.post(
            f"{base_url}/api/chat",
            json={"session_id": sid, "message": "What is my name? Reply with just the name."},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        reply = r.json()["assistant_message"]["content"].lower()
        assert "pyro" in reply, f"Multi-turn context failed; reply: {reply!r}"

    def test_chat_invalid_session_creates_on_the_fly(self, base_url, api_client):
        bogus_sid = "TEST_NONEXISTENT_SESSION_42"
        # Make sure it does not exist
        api_client.delete(f"{base_url}/api/sessions/{bogus_sid}")

        r = api_client.post(
            f"{base_url}/api/chat",
            json={"session_id": bogus_sid, "message": "Hello there."},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        # session should exist now
        lst = api_client.get(f"{base_url}/api/sessions").json()
        assert any(s["id"] == bogus_sid for s in lst)
        # cleanup
        api_client.delete(f"{base_url}/api/sessions/{bogus_sid}")

    def test_chat_empty_message_400(self, base_url, api_client):
        r = api_client.post(
            f"{base_url}/api/chat",
            json={"session_id": "anything", "message": "   "},
            timeout=20,
        )
        assert r.status_code == 400

    @classmethod
    def teardown_class(cls):
        if cls.sid:
            base = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
            try:
                requests.delete(f"{base}/api/sessions/{cls.sid}", timeout=10)
            except Exception:
                pass


# ---------------- 4. Transcription ----------------
class TestTranscribe:
    def test_transcribe_silent_wav_returns_text_field(self, base_url, tmp_path):
        wav = tmp_path / "test_silent.wav"
        _make_silent_wav(str(wav), seconds=1.0)
        with open(wav, "rb") as f:
            files = {"file": ("test_silent.wav", f, "audio/wav")}
            r = requests.post(f"{base_url}/api/transcribe", files=files, timeout=120)
        assert r.status_code == 200, f"transcribe failed: {r.status_code} {r.text[:500]}"
        data = r.json()
        assert "text" in data
        assert isinstance(data["text"], str)
