"""
Iter-9 backend test suite.

Covers the brand-new endpoints introduced in iteration 9:
- POST/GET/DELETE /api/suggestions
- PUT /api/career/profile/auto-apply
- POST /api/career/profile/parse-resume
- POST /api/career/jobs/{id}/apply
- GET /api/finance/transactions
- Sign-in scaffolding regressions (email OTP still works, Apple is still a stub)
"""
from __future__ import annotations

import io
import os
import uuid
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or os.environ.get("EXPO_PUBLIC_BACKEND_URL"))
if not BASE_URL:
    raise RuntimeError("Frontend backend URL env var missing")
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"
TIMEOUT = 60


# ---------------- Helpers ----------------
def _email() -> str:
    return f"test_iter9_{uuid.uuid4().hex[:10]}@oraos.app"


def _signin():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    email = _email()
    r = s.post(f"{API}/auth/otp/request", json={"email": email}, timeout=TIMEOUT)
    assert r.status_code == 200, f"otp/request: {r.status_code} {r.text}"
    code = r.json().get("dev_code")
    assert code, "dev_code missing in OTP request response"
    r = s.post(f"{API}/auth/otp/verify",
               json={"email": email, "code": code}, timeout=TIMEOUT)
    assert r.status_code == 200, f"otp/verify: {r.status_code} {r.text}"
    tok = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s, email, tok


@pytest.fixture(scope="module")
def authed():
    s, email, tok = _signin()
    yield s
    # best-effort cleanup
    try:
        s.post(f"{API}/account/delete", timeout=TIMEOUT)
    except Exception:
        pass


# ---------------- Suggestions ----------------
class TestSuggestions:
    def test_create_lists_and_delete(self, authed):
        payload = {"title": "TEST_iter9 idea",
                   "body": "It would be great if ORA could do X.",
                   "kind": "feature"}
        r = authed.post(f"{API}/suggestions", json=payload, timeout=TIMEOUT)
        assert r.status_code in (200, 201), f"create: {r.status_code} {r.text}"
        item = r.json()
        for k in ("id", "title", "body", "kind", "status", "upvotes", "created_at"):
            assert k in item, f"missing {k} in {item}"
        assert item["title"] == payload["title"]
        assert item["body"] == payload["body"]
        assert item["kind"] == "feature"
        assert item["status"] == "received"
        assert item["upvotes"] == 0
        sid = item["id"]

        # GET list
        r = authed.get(f"{API}/suggestions", timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        arr = r.json()
        assert isinstance(arr, list)
        assert any(x.get("id") == sid for x in arr), "newly created not present"

        # DELETE
        r = authed.delete(f"{API}/suggestions/{sid}", timeout=TIMEOUT)
        assert r.status_code == 200
        assert r.json() == {"ok": True}

        # Verify removal
        r = authed.get(f"{API}/suggestions", timeout=TIMEOUT)
        assert all(x.get("id") != sid for x in r.json())

    def test_create_validation(self, authed):
        r = authed.post(f"{API}/suggestions",
                        json={"title": "", "body": ""}, timeout=TIMEOUT)
        assert r.status_code == 400

    def test_kind_normalization(self, authed):
        r = authed.post(f"{API}/suggestions",
                        json={"title": "TEST_iter9 bogus kind",
                              "body": "x", "kind": "weird"},
                        timeout=TIMEOUT)
        assert r.status_code in (200, 201)
        item = r.json()
        assert item["kind"] == "other"
        authed.delete(f"{API}/suggestions/{item['id']}", timeout=TIMEOUT)


# ---------------- Career auto-apply toggle ----------------
class TestCareerAutoApply:
    def test_toggle_on(self, authed):
        r = authed.put(f"{API}/career/profile/auto-apply",
                       json={"enabled": True, "min_score": 80}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        prof = r.json()
        assert prof.get("auto_apply_enabled") is True
        assert prof.get("auto_apply_min_score") == 80

    def test_toggle_off(self, authed):
        r = authed.put(f"{API}/career/profile/auto-apply",
                       json={"enabled": False, "min_score": 75}, timeout=TIMEOUT)
        assert r.status_code == 200
        prof = r.json()
        assert prof.get("auto_apply_enabled") is False
        assert prof.get("auto_apply_min_score") == 75


# ---------------- Career parse-resume ----------------
class TestCareerParseResume:
    def test_parse_text_resume(self, authed):
        resume = (
            "Varun Iter9\nvarun.iter9@oraos.app | +91-9000000000 | Bengaluru, IN\n"
            "Senior Backend Engineer\n\n"
            "Summary: 8 years building scalable systems in Python and Go.\n\n"
            "Skills: Python, FastAPI, MongoDB, Go, Kubernetes, AWS\n\n"
            "Experience:\n"
            "  - Senior Backend Engineer, Acme Corp, 2020-2024\n"
            "      • Built core APIs handling 5M req/day\n"
            "      • Led migration to async stack\n"
            "  - Backend Engineer, BetaCo, 2016-2020\n"
            "      • Designed event sourcing pipeline\n\n"
            "Certifications: AWS Solutions Architect Associate\n"
            "Education: B.Tech CSE, IIT Madras, 2016\n"
        )
        # Strip auth content-type so we send multipart
        s = requests.Session()
        s.headers.update({k: v for k, v in authed.headers.items()
                          if k.lower() == "authorization"})
        files = {"file": ("resume.txt", io.BytesIO(resume.encode("utf-8")), "text/plain")}
        r = s.post(f"{API}/career/profile/parse-resume",
                   files=files, timeout=90)
        assert r.status_code == 200, f"parse-resume: {r.status_code} {r.text[:400]}"
        data = r.json()
        assert "profile" in data and "extracted_fields" in data
        prof = data["profile"]
        # Bedrock should detect at least these basics
        assert isinstance(prof.get("skills"), list) and len(prof["skills"]) > 0
        assert prof.get("years_experience", 0) >= 1, f"years={prof.get('years_experience')}"
        # Name extraction should match
        assert "Varun" in (prof.get("name") or "")

    def test_empty_file_rejected(self, authed):
        s = requests.Session()
        s.headers.update({k: v for k, v in authed.headers.items()
                          if k.lower() == "authorization"})
        files = {"file": ("empty.txt", io.BytesIO(b""), "text/plain")}
        r = s.post(f"{API}/career/profile/parse-resume",
                   files=files, timeout=TIMEOUT)
        assert r.status_code == 400


# ---------------- Career one-click apply ----------------
class TestCareerJobApply:
    def test_apply_404_when_missing(self, authed):
        r = authed.post(f"{API}/career/jobs/does-not-exist/apply", timeout=TIMEOUT)
        assert r.status_code == 404

    def test_apply_existing_job(self, authed):
        # Seed a job via existing endpoint
        seed = {
            "title": "Senior Python Engineer (TEST_iter9)",
            "company": "ORA Test Corp",
            "location": "Remote",
            "description": "Build distributed Python systems with FastAPI and MongoDB. "
                           "5+ years required.",
            "source": "manual",
            "source_url": "https://example.com/jobs/iter9",
            "raw_text": (
                "Senior Python Engineer at ORA Test Corp (Remote). "
                "Build distributed Python systems with FastAPI and MongoDB. "
                "5+ years experience required. Bonus: Kubernetes, async, Go."
            ),
        }
        r = authed.post(f"{API}/career/jobs", json=seed, timeout=TIMEOUT)
        assert r.status_code in (200, 201), f"job create: {r.status_code} {r.text}"
        job = r.json()
        job_id = job.get("id") or job.get("job", {}).get("id")
        assert job_id, f"no id in job response: {job}"

        # One-click apply  (NOTE: endpoint reads db.jobs, not db.career_jobs --
        # will likely 404 in the current build; flagged in test report.)
        r = authed.post(f"{API}/career/jobs/{job_id}/apply", timeout=90)
        if r.status_code == 404:
            pytest.fail(
                "Endpoint /api/career/jobs/{id}/apply queries db.jobs but jobs "
                "are stored in db.career_jobs — collection-name mismatch."
            )
        assert r.status_code == 200, f"apply: {r.status_code} {r.text[:400]}"
        out = r.json()
        assert out.get("ok") is True
        app_doc = out.get("application") or {}
        assert app_doc.get("stage") == "applied", f"app={app_doc}"
        assert "artifacts" in out
        # cleanup
        authed.delete(f"{API}/career/jobs/{job_id}", timeout=TIMEOUT)


# ---------------- Finance transactions ----------------
class TestFinanceTransactions:
    def test_list(self, authed):
        r = authed.get(f"{API}/finance/transactions?limit=5&days=90",
                       timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)


# ---------------- Regression: existing public endpoints still work ----------------
class TestRegression:
    def test_otp_request_still_returns_dev_code(self):
        r = requests.post(f"{API}/auth/otp/request",
                          json={"email": _email()}, timeout=TIMEOUT)
        assert r.status_code == 200
        assert "dev_code" in r.json()

    def test_apple_still_stub(self):
        r = requests.post(f"{API}/auth/apple/start",
                          json={"identity_token": "x"}, timeout=TIMEOUT)
        # 501 by design OR 400/422 — should NOT be 200
        assert r.status_code != 200
