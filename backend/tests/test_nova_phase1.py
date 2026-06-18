"""
Phase 1 expansion tests for Nova AI Assistant:
- Memory auto-extraction + manual CRUD + filters
- Cross-session memory recall
- Goals CRUD (with auto-complete on progress=100)
- Reminders CRUD with status filter
- Session pin (pinned-first sorting) + search
- Chat with image attachment (Bedrock Nova Lite Converse)
- Image persistence in stored ChatMessage
- No ObjectId/_id leaks anywhere
"""
import os
import time
import base64
import pytest
import requests


# ----------- helpers -----------
def _no_mongo_id(obj):
    if isinstance(obj, dict):
        assert "_id" not in obj, f"Found _id leaking: {obj}"
        for v in obj.values():
            _no_mongo_id(v)
    elif isinstance(obj, list):
        for v in obj:
            _no_mongo_id(v)


# A real 1x1 red PNG (valid bytes — Bedrock requires valid image data)
_TINY_PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
)
TINY_PNG_B64 = base64.b64encode(_TINY_PNG_BYTES).decode("ascii")


# Track created IDs across tests for hard cleanup
_CREATED = {"sessions": [], "memories": [], "goals": [], "reminders": []}


def _hard_cleanup(base_url):
    for sid in _CREATED["sessions"]:
        try:
            requests.delete(f"{base_url}/api/sessions/{sid}", timeout=10)
        except Exception:
            pass
    for mid in _CREATED["memories"]:
        try:
            requests.delete(f"{base_url}/api/memories/{mid}", timeout=10)
        except Exception:
            pass
    for gid in _CREATED["goals"]:
        try:
            requests.delete(f"{base_url}/api/goals/{gid}", timeout=10)
        except Exception:
            pass
    for rid in _CREATED["reminders"]:
        try:
            requests.delete(f"{base_url}/api/reminders/{rid}", timeout=10)
        except Exception:
            pass


@pytest.fixture(scope="module", autouse=True)
def _final_cleanup(base_url):
    yield
    _hard_cleanup(base_url)


# ---------------- 1. Memories: manual CRUD & filters ----------------
class TestMemoriesManual:
    def test_create_memory(self, base_url, api_client):
        payload = {
            "category": "person",
            "subject": "TEST_Aruna",
            "content": "TEST_Aruna had surgery on July 10",
            "importance": 4,
        }
        r = api_client.post(f"{base_url}/api/memories", json=payload)
        assert r.status_code == 200, r.text
        m = r.json()
        _no_mongo_id(m)
        for k in ("id", "category", "subject", "content", "importance", "created_at"):
            assert k in m
        assert m["category"] == "person"
        assert m["subject"] == "TEST_Aruna"
        assert "surgery" in m["content"].lower()
        assert m["importance"] == 4
        _CREATED["memories"].append(m["id"])

    def test_list_memories_filter_category(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/memories", params={"category": "person"})
        assert r.status_code == 200, r.text
        data = r.json()
        _no_mongo_id(data)
        assert isinstance(data, list)
        assert any(x["subject"] == "TEST_Aruna" for x in data)
        for x in data:
            assert x["category"] == "person"

    def test_list_memories_filter_search(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/memories", params={"search": "surgery"})
        assert r.status_code == 200, r.text
        data = r.json()
        _no_mongo_id(data)
        assert any("surgery" in (x.get("content", "") + x.get("subject", "")).lower() for x in data)

    def test_delete_memory(self, base_url, api_client):
        # create & delete a throwaway one
        cr = api_client.post(
            f"{base_url}/api/memories",
            json={"category": "other", "subject": "TEST_ToDelete", "content": "to be removed"},
        )
        mid = cr.json()["id"]
        d = api_client.delete(f"{base_url}/api/memories/{mid}")
        assert d.status_code == 200 and d.json().get("ok") is True
        lst = api_client.get(f"{base_url}/api/memories").json()
        assert all(x["id"] != mid for x in lst)


# ---------------- 2. Memory auto-extraction from chat ----------------
class TestMemoryAutoExtraction:
    sid_a = None
    sid_b = None

    def test_chat_triggers_memory_extraction(self, base_url, api_client):
        s = api_client.post(f"{base_url}/api/sessions", json={"title": "TEST_MemAuto"})
        sid = s.json()["id"]
        TestMemoryAutoExtraction.sid_a = sid
        _CREATED["sessions"].append(sid)

        msg = "My mother Aruna had surgery on July 10. She is recovering well."
        r = api_client.post(
            f"{base_url}/api/chat",
            json={"session_id": sid, "message": msg},
            timeout=120,
        )
        assert r.status_code == 200, r.text
        # Give background extraction time to run
        deadline = time.time() + 25
        found = None
        while time.time() < deadline:
            time.sleep(3)
            lst = api_client.get(f"{base_url}/api/memories").json()
            _no_mongo_id(lst)
            for m in lst:
                blob = (m.get("subject", "") + " " + m.get("content", "")).lower()
                if "aruna" in blob or "july 10" in blob or "surgery" in blob:
                    found = m
                    break
            if found:
                break
        assert found, "Background memory extraction did not store a memory about Aruna/surgery within 25s"
        _CREATED["memories"].append(found["id"])
        # category should ideally be 'person' but model can pick others — assert it's a known category
        assert found["category"] in {
            "person", "project", "goal", "skill", "meeting", "date", "preference", "other"
        }

    def test_cross_session_recall(self, base_url, api_client):
        assert TestMemoryAutoExtraction.sid_a, "previous test must have run"
        # Brand new session — model should pull the memory from the system prompt
        s = api_client.post(f"{base_url}/api/sessions", json={"title": "TEST_MemRecall"})
        sid = s.json()["id"]
        TestMemoryAutoExtraction.sid_b = sid
        _CREATED["sessions"].append(sid)

        r = api_client.post(
            f"{base_url}/api/chat",
            json={
                "session_id": sid,
                "message": "When did my mother have her surgery? Reply briefly with the date.",
            },
            timeout=120,
        )
        assert r.status_code == 200, r.text
        reply = r.json()["assistant_message"]["content"].lower()
        assert ("july 10" in reply) or ("aruna" in reply) or ("july" in reply and "10" in reply), \
            f"Cross-session recall failed; reply: {reply!r}"


# ---------------- 3. Goals CRUD ----------------
class TestGoals:
    gid = None

    def test_create_goal(self, base_url, api_client):
        r = api_client.post(
            f"{base_url}/api/goals",
            json={"title": "TEST_Run 5K", "description": "Training plan", "target": "March"},
        )
        assert r.status_code == 200, r.text
        g = r.json()
        _no_mongo_id(g)
        for k in ("id", "title", "description", "target", "progress", "status", "created_at", "updated_at"):
            assert k in g
        assert g["progress"] == 0 and g["status"] == "active"
        TestGoals.gid = g["id"]
        _CREATED["goals"].append(g["id"])

    def test_list_goals(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/goals")
        assert r.status_code == 200
        data = r.json()
        _no_mongo_id(data)
        assert any(x["id"] == TestGoals.gid for x in data)

    def test_update_goal_progress(self, base_url, api_client):
        r = api_client.put(
            f"{base_url}/api/goals/{TestGoals.gid}", json={"progress": 50}
        )
        assert r.status_code == 200, r.text
        g = r.json()
        assert g["progress"] == 50 and g["status"] == "active"

    def test_update_goal_progress_100_auto_complete(self, base_url, api_client):
        r = api_client.put(
            f"{base_url}/api/goals/{TestGoals.gid}", json={"progress": 100}
        )
        assert r.status_code == 200, r.text
        g = r.json()
        assert g["progress"] == 100
        assert g["status"] == "completed", f"Expected auto-complete; got status={g['status']}"

    def test_delete_goal(self, base_url, api_client):
        # Create & delete a throwaway goal
        cr = api_client.post(f"{base_url}/api/goals", json={"title": "TEST_ToDelGoal"})
        gid = cr.json()["id"]
        d = api_client.delete(f"{base_url}/api/goals/{gid}")
        assert d.status_code == 200 and d.json().get("ok") is True
        lst = api_client.get(f"{base_url}/api/goals").json()
        assert all(x["id"] != gid for x in lst)

    def test_update_nonexistent_goal_404(self, base_url, api_client):
        r = api_client.put(f"{base_url}/api/goals/TEST_NOPE_GOAL", json={"progress": 10})
        assert r.status_code == 404


# ---------------- 4. Reminders CRUD ----------------
class TestReminders:
    rid = None

    def test_create_reminder(self, base_url, api_client):
        r = api_client.post(
            f"{base_url}/api/reminders",
            json={"text": "TEST_Email John", "condition": "after certification arrives"},
        )
        assert r.status_code == 200, r.text
        rem = r.json()
        _no_mongo_id(rem)
        for k in ("id", "text", "condition", "status", "created_at", "updated_at"):
            assert k in rem
        assert rem["status"] == "pending"
        TestReminders.rid = rem["id"]
        _CREATED["reminders"].append(rem["id"])

    def test_list_reminders_filter_pending(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/reminders", params={"status": "pending"})
        assert r.status_code == 200
        data = r.json()
        _no_mongo_id(data)
        assert any(x["id"] == TestReminders.rid for x in data)
        for x in data:
            assert x["status"] == "pending"

    def test_update_reminder_done(self, base_url, api_client):
        r = api_client.put(
            f"{base_url}/api/reminders/{TestReminders.rid}", json={"status": "done"}
        )
        assert r.status_code == 200
        assert r.json()["status"] == "done"
        # Filter pending should no longer include it
        pending = api_client.get(f"{base_url}/api/reminders", params={"status": "pending"}).json()
        assert all(x["id"] != TestReminders.rid for x in pending)

    def test_delete_reminder(self, base_url, api_client):
        cr = api_client.post(f"{base_url}/api/reminders", json={"text": "TEST_ToDelRem"})
        rid = cr.json()["id"]
        d = api_client.delete(f"{base_url}/api/reminders/{rid}")
        assert d.status_code == 200 and d.json().get("ok") is True

    def test_update_nonexistent_reminder_404(self, base_url, api_client):
        r = api_client.put(f"{base_url}/api/reminders/TEST_NOPE_REM", json={"status": "done"})
        assert r.status_code == 404


# ---------------- 5. Sessions: pin & search ----------------
class TestSessionsPinSearch:
    def test_pin_toggles_and_sorts_first(self, base_url, api_client):
        # Create two normal sessions
        s1 = api_client.post(f"{base_url}/api/sessions", json={"title": "TEST_PinA"}).json()
        time.sleep(0.1)
        s2 = api_client.post(f"{base_url}/api/sessions", json={"title": "TEST_PinB"}).json()
        time.sleep(0.1)
        s3 = api_client.post(f"{base_url}/api/sessions", json={"title": "TEST_PinC"}).json()
        _CREATED["sessions"].extend([s1["id"], s2["id"], s3["id"]])

        # Pin s1 (oldest)
        p = api_client.post(f"{base_url}/api/sessions/{s1['id']}/pin")
        assert p.status_code == 200
        assert p.json()["pinned"] is True

        lst = api_client.get(f"{base_url}/api/sessions").json()
        _no_mongo_id(lst)
        # The pinned session must appear before any unpinned session in the returned list
        ids_order = [x["id"] for x in lst]
        idx_s1 = ids_order.index(s1["id"])
        idx_s2 = ids_order.index(s2["id"])
        idx_s3 = ids_order.index(s3["id"])
        assert idx_s1 < idx_s2 and idx_s1 < idx_s3, (
            f"Pinned session not first. Order: {ids_order}"
        )
        # Among unpinned, newest (s3) before s2
        assert idx_s3 < idx_s2, f"Unpinned not sorted by updated_at desc. Order: {ids_order}"

        # Unpin and verify it falls back to updated_at sort
        p2 = api_client.post(f"{base_url}/api/sessions/{s1['id']}/pin")
        assert p2.status_code == 200 and p2.json()["pinned"] is False

    def test_pin_nonexistent_404(self, base_url, api_client):
        r = api_client.post(f"{base_url}/api/sessions/TEST_NOPE_PIN/pin")
        assert r.status_code == 404

    def test_search_sessions_by_title(self, base_url, api_client):
        s = api_client.post(
            f"{base_url}/api/sessions", json={"title": "TEST_UniqueZebraTopic"}
        ).json()
        _CREATED["sessions"].append(s["id"])
        # Case-insensitive partial match
        r = api_client.get(f"{base_url}/api/sessions", params={"search": "zebratopic"})
        assert r.status_code == 200, r.text
        data = r.json()
        _no_mongo_id(data)
        assert any(x["id"] == s["id"] for x in data)
        for x in data:
            assert "zebratopic" in x["title"].lower()


# ---------------- 6. Chat with image attachment ----------------
class TestChatWithImage:
    def test_chat_with_image_returns_reply_and_persists(self, base_url, api_client):
        s = api_client.post(f"{base_url}/api/sessions", json={"title": "TEST_Image"}).json()
        sid = s["id"]
        _CREATED["sessions"].append(sid)

        payload = {
            "session_id": sid,
            "message": "What color is this image? Reply briefly.",
            "image_b64": TINY_PNG_B64,
            "image_mime": "image/png",
        }
        r = api_client.post(f"{base_url}/api/chat", json=payload, timeout=120)
        assert r.status_code == 200, r.text
        data = r.json()
        _no_mongo_id(data)
        reply = data["assistant_message"]["content"]
        assert isinstance(reply, str) and len(reply.strip()) > 0, "Empty reply for image chat"
        # user_message must echo content
        assert data["user_message"]["content"] == payload["message"]
        # user_message should have image_b64 populated in the response too
        assert data["user_message"].get("image_b64") == TINY_PNG_B64

    def test_stored_message_persists_image_b64(self, base_url, api_client):
        # Reuse a freshly-created session for clean assertion
        s = api_client.post(f"{base_url}/api/sessions", json={"title": "TEST_ImagePersist"}).json()
        sid = s["id"]
        _CREATED["sessions"].append(sid)

        r = api_client.post(
            f"{base_url}/api/chat",
            json={
                "session_id": sid,
                "message": "Describe this 1x1 image briefly.",
                "image_b64": TINY_PNG_B64,
                "image_mime": "image/png",
            },
            timeout=120,
        )
        assert r.status_code == 200, r.text

        msgs = api_client.get(f"{base_url}/api/sessions/{sid}/messages").json()
        _no_mongo_id(msgs)
        user_msgs = [m for m in msgs if m["role"] == "user"]
        assert user_msgs, "No user message stored"
        assert user_msgs[0].get("image_b64") == TINY_PNG_B64, "image_b64 not persisted on stored ChatMessage"


# ---------------- 7. Regression: chat without image still works ----------------
class TestRegression:
    def test_chat_without_image(self, base_url, api_client):
        s = api_client.post(f"{base_url}/api/sessions", json={"title": "TEST_Regress"}).json()
        sid = s["id"]
        _CREATED["sessions"].append(sid)
        r = api_client.post(
            f"{base_url}/api/chat",
            json={"session_id": sid, "message": "Hello in one short sentence."},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        assert len(r.json()["assistant_message"]["content"].strip()) > 0

    def test_root_still_works(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/")
        assert r.status_code == 200
        assert "Nova" in r.json().get("message", "")
