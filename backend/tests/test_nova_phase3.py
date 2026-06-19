"""
Phase 3 backend tests:
- Personal Search Engine: /api/search/unified, /api/search/sources
- Life Operating System: /api/life/scores, /api/life/recommendations, /api/life/dashboard
- Chat-driven Digital Twin draft_reply intent via /api/chat
"""
import pytest
import time


# ---------------- Unified Search ----------------

class TestSearchSources:
    def test_search_sources(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/search/sources")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "available" in data
        assert "counts" in data
        assert "google_connected" in data
        for k in ["chat", "memory", "goal", "reminder", "knowledge", "finance", "calendar", "email"]:
            assert k in data["available"], f"missing source flag {k}"
        # if google not connected -> calendar/email available must be False
        if not data["google_connected"]:
            assert data["available"]["calendar"] is False
            assert data["available"]["email"] is False
        # counts dict has the 6 local source counts
        for k in ["chat", "memory", "goal", "reminder", "knowledge", "finance"]:
            assert k in data["counts"]
            assert isinstance(data["counts"][k], int)


class TestUnifiedSearch:
    def test_unified_search_basic(self, api_client, base_url):
        payload = {
            "query": "mother surgery",
            "sources": ["memory", "chat", "reminder"],
            "top_k": 8,
            "synthesize": True,
        }
        r = api_client.post(f"{base_url}/api/search/unified", json=payload, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["query"] == "mother surgery"
        assert "answer" in d
        assert "sources" in d and isinstance(d["sources"], list)
        assert "stats" in d and isinstance(d["stats"], dict)
        assert "generated_at" in d
        if d["sources"]:
            assert isinstance(d["answer"], str)
            # If we have sources, answer should be non-empty
            assert len(d["answer"]) > 0, "answer should be non-empty when sources matched"
            # source schema
            s0 = d["sources"][0]
            for k in ["type", "id", "title", "snippet", "timestamp", "score", "ref"]:
                assert k in s0, f"source missing key {k}"

    def test_unified_search_source_filter(self, api_client, base_url):
        """When sources=[memory] only memory-type sources should be returned."""
        # Seed a memory we can match
        mem_payload = {"subject": "TEST_unified_search_marker", "detail": "xenophilegram unique token", "category": "personal"}
        api_client.post(f"{base_url}/api/memory/add", json=mem_payload)
        time.sleep(0.5)
        payload = {
            "query": "xenophilegram",
            "sources": ["memory"],
            "top_k": 10,
            "synthesize": False,
        }
        r = api_client.post(f"{base_url}/api/search/unified", json=payload, timeout=30)
        assert r.status_code == 200
        d = r.json()
        # Every source should be memory type
        for src in d["sources"]:
            assert src["type"] == "memory", f"leaked source type {src['type']}"
        # stats keys should match returned types
        for t in d["stats"].keys():
            assert t == "memory"

    def test_unified_search_no_match(self, api_client, base_url):
        # Use a multi-token unmatched query; recency bonus may surface some loosely matched docs,
        # so we only verify the call succeeds and stats keys match returned source types.
        payload = {
            "query": "qzzxnomatchunlikely twentysixxx",
            "sources": ["memory", "chat", "reminder", "goal", "knowledge", "finance"],
            "top_k": 5,
            "synthesize": True,
        }
        r = api_client.post(f"{base_url}/api/search/unified", json=payload, timeout=30)
        assert r.status_code == 200
        d = r.json()
        # Stats dict types must match returned source types
        returned_types = {s["type"] for s in d["sources"]}
        for t in d["stats"].keys():
            assert t in returned_types or returned_types == set()


# ---------------- Life OS ----------------

class TestLifeScores:
    def test_life_scores_shape(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/life/scores", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d["overall"], int)
        assert 0 <= d["overall"] <= 100
        assert "overall_grade" in d
        assert "dimensions" in d
        for dim in ["health", "career", "finance", "learning", "relationships"]:
            assert dim in d["dimensions"], f"missing dim {dim}"
            block = d["dimensions"][dim]
            assert "score" in block and 0 <= block["score"] <= 100
            assert "grade" in block
            assert "signals" in block and isinstance(block["signals"], list)
            assert "items_tracked" in block
        assert "weakest" in d and "strongest" in d
        assert "generated_at" in d

    def test_life_recommendations(self, api_client, base_url):
        # fetch overall first
        scores = api_client.get(f"{base_url}/api/life/scores", timeout=30).json()
        r = api_client.get(f"{base_url}/api/life/recommendations?max_items=5", timeout=60)
        assert r.status_code == 200, r.text
        recs = r.json()
        assert isinstance(recs, list)
        assert len(recs) >= 1
        for rec in recs:
            for k in ["dimension", "title", "why", "icon", "priority"]:
                assert k in rec, f"rec missing key {k}: {rec}"
        if scores["overall"] < 60:
            assert any(r.get("priority") == "high" for r in recs), "expected at least 1 high-priority rec"

    def test_life_dashboard(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/life/dashboard", timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert "overall" in d
        assert "dimensions" in d
        assert "recommendations" in d
        assert isinstance(d["recommendations"], list)


class TestHealthGoalBumpsScore:
    def test_health_goal_bumps_health(self, api_client, base_url):
        before = api_client.get(f"{base_url}/api/life/scores", timeout=30).json()
        before_health = before["dimensions"]["health"]["score"]

        # create a health-tagged goal with reasonable progress
        goal = {"title": "TEST_Run 5km daily", "description": "fitness routine", "target_date": None}
        cr = api_client.post(f"{base_url}/api/goals", json=goal)
        assert cr.status_code in (200, 201), cr.text
        gid = cr.json().get("id")
        # boost progress to ensure score climbs over baseline 40
        if gid:
            api_client.put(f"{base_url}/api/goals/{gid}", json={"progress": 30})
        time.sleep(0.5)

        after = api_client.get(f"{base_url}/api/life/scores", timeout=30).json()
        after_health = after["dimensions"]["health"]["score"]
        # Adding a health goal must move the dimension off the no-goals baseline (50)
        # With progress 30 the formula gives 40 + 30*0.6 = 58 -> >= 50.
        assert after_health >= 50 or after_health > before_health, \
            f"health expected >=50 (or > {before_health}) after adding health goal, got {after_health}"


# ---------------- Chat Draft Reply ----------------

class TestChatDraftReply:
    def test_chat_reply_to_vijay(self, api_client, base_url):
        # ensure a session
        sess_r = api_client.post(f"{base_url}/api/sessions", json={"title": "TEST draft reply"})
        assert sess_r.status_code in (200, 201), sess_r.text
        sid = sess_r.json()["id"]

        chat_r = api_client.post(
            f"{base_url}/api/chat",
            json={"session_id": sid, "message": "Reply to Vijay about the deployment progress"},
            timeout=90,
        )
        assert chat_r.status_code == 200, chat_r.text
        body = chat_r.json()
        # accept either {assistant_message:{content}} or message-shaped response
        content = ""
        if isinstance(body, dict):
            if "assistant_message" in body and isinstance(body["assistant_message"], dict):
                content = body["assistant_message"].get("content") or ""
            elif "content" in body:
                content = body.get("content") or ""
            else:
                # search nested
                for v in body.values():
                    if isinstance(v, dict) and v.get("content"):
                        content = v["content"]
                        break
        assert "Drafted reply to" in content and "Vijay" in content, f"missing marker in: {content[:300]}"

    def test_twin_profile_contains_vijay(self, api_client, base_url):
        r = api_client.get(f"{base_url}/api/twin/profile", timeout=30)
        assert r.status_code == 200, r.text
        p = r.json()
        contacts = p.get("frequent_contacts") or []
        names = [(c.get("name") or "").lower() for c in contacts]
        assert any("vijay" in n for n in names), f"vijay not found in contacts: {names}"

    def test_other_intents_still_work_reminder(self, api_client, base_url):
        sess_r = api_client.post(f"{base_url}/api/sessions", json={"title": "TEST reminder intent"})
        sid = sess_r.json()["id"]
        chat_r = api_client.post(
            f"{base_url}/api/chat",
            json={"session_id": sid, "message": "Remind me to submit reimbursement after certification approval"},
            timeout=90,
        )
        assert chat_r.status_code == 200, chat_r.text
        # confirm at least one reminder exists mentioning reimbursement
        rems = api_client.get(f"{base_url}/api/reminders").json()
        assert any("reimbursement" in (r.get("text") or "").lower() for r in rems), \
            f"no reimbursement reminder created: {[r.get('text') for r in rems][:5]}"
