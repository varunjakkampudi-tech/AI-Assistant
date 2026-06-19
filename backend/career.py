"""
CAREER COPILOT — backend module
================================
Sustainable architecture:

  db.career_profile      single doc (id='career_profile') — master resume + skills
  db.career_jobs         every JD we've ingested (manual paste, URL fetch, board sync)
  db.career_applications pipeline state per (resume,job) pair
  db.career_artifacts    tailored resumes / cover letters / interview kits (LLM output)
  db.career_boards       configured job-board sources to poll

Flow (per user spec):
  Discover  ─► Auto-score ─► Tailor (resume + cover letter) ─► User review
  ─► One-click "Mark applied" + open external site ─► Track stage ─► Interview kit
"""
from __future__ import annotations
import re
import json
import uuid
import logging
import httpx
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Callable

logger = logging.getLogger(__name__)

# ==================== Pipeline stages ====================
STAGES = [
    "discovered", "shortlisted", "applied", "assessment",
    "interview", "offer", "rejected", "withdrawn",
]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ==================== Resume Profile ====================

DEFAULT_PROFILE = {
    "id": "career_profile",
    "name": "",
    "headline": "",
    "summary": "",
    "current_role": "",
    "current_company": "",
    "years_experience": 0,
    "location": "",
    "remote_preference": "any",     # any | onsite | hybrid | remote
    "expected_ctc_inr": 0,           # 0 means undisclosed
    "notice_period_days": 30,
    "open_to_work": True,
    "links": {"linkedin": "", "github": "", "portfolio": ""},

    "skills": [],                    # ["AEM", "AWS", "Linux", "Terraform"]
    "certifications": [],            # ["AWS SAA-C03", "AEM Sites Developer"]
    "experience": [],                # [{title, company, start, end, bullets[]}]
    "education": [],                 # [{degree, school, year}]
    "projects": [],                  # [{name, summary, stack[]}]

    # Filters Nova uses when ranking jobs
    "filters": {
        "titles": [],                # ["AEM Developer", "DevOps Engineer", "SRE"]
        "min_years": 0,
        "max_years": 99,
        "locations": [],             # ["Hyderabad", "Bangalore", "Remote"]
        "min_match_score": 70,
    },

    "created_at": None,
    "updated_at": None,
}


async def get_profile(db) -> Dict[str, Any]:
    doc = await db.career_profile.find_one({"id": "career_profile"}, {"_id": 0})
    if doc:
        return doc
    fresh = {**DEFAULT_PROFILE, "created_at": utc_now_iso(), "updated_at": utc_now_iso()}
    await db.career_profile.insert_one(fresh)
    fresh.pop("_id", None)
    return fresh


async def update_profile(db, updates: Dict[str, Any]) -> Dict[str, Any]:
    profile = await get_profile(db)
    # Shallow merge with a few list-aware ones
    for k, v in (updates or {}).items():
        profile[k] = v
    profile["updated_at"] = utc_now_iso()
    await db.career_profile.update_one({"id": "career_profile"}, {"$set": profile}, upsert=True)
    profile.pop("_id", None)
    return profile


# ==================== Job ingestion (URL / paste) ====================

_HTML_TAG = re.compile(r"<[^>]+>")
_WHITESPACE = re.compile(r"\s+")


def _strip_html(html: str) -> str:
    text = _HTML_TAG.sub(" ", html or "")
    text = text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&#39;", "'")
    text = text.replace("&quot;", '"').replace("&lt;", "<").replace("&gt;", ">")
    return _WHITESPACE.sub(" ", text).strip()


async def fetch_jd_from_url(url: str) -> Dict[str, Any]:
    """Best-effort fetch + extract. Works on Greenhouse/Lever/most static pages.
    Returns {title, company, location, raw_text, source}.
    """
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True,
                                     headers={"User-Agent": "Mozilla/5.0 NovaJobScraper"}) as http:
            r = await http.get(url)
            html = r.text if r.status_code == 200 else ""
    except Exception as e:
        logger.warning("JD fetch failed for %s: %s", url, e)
        return {"title": "", "company": "", "location": "", "raw_text": "", "source": url}

    if not html:
        return {"title": "", "company": "", "location": "", "raw_text": "", "source": url}

    # Title — from <title>
    title_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.DOTALL | re.IGNORECASE)
    raw_title = _strip_html(title_match.group(1)) if title_match else ""

    # JSON-LD JobPosting (common pattern on company sites)
    company, location = "", ""
    title = raw_title
    description_text = ""
    for m in re.finditer(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
                          html, re.DOTALL | re.IGNORECASE):
        try:
            data = json.loads(m.group(1).strip())
            if isinstance(data, list):
                data = next((x for x in data if isinstance(x, dict) and x.get("@type") == "JobPosting"), None)
            if isinstance(data, dict) and data.get("@type") == "JobPosting":
                title = data.get("title") or title
                org = data.get("hiringOrganization") or {}
                if isinstance(org, dict):
                    company = org.get("name") or company
                loc = data.get("jobLocation") or {}
                if isinstance(loc, list):
                    loc = loc[0] if loc else {}
                if isinstance(loc, dict):
                    addr = loc.get("address") or {}
                    location = addr.get("addressLocality") or addr.get("addressRegion") or location
                description_text = _strip_html(data.get("description") or description_text)
                break
        except Exception:
            continue

    # Fallback: dump all body text
    if not description_text:
        # Drop scripts and styles
        cleaned = re.sub(r"<script.*?</script>", " ", html, flags=re.DOTALL | re.IGNORECASE)
        cleaned = re.sub(r"<style.*?</style>", " ", cleaned, flags=re.DOTALL | re.IGNORECASE)
        description_text = _strip_html(cleaned)[:8000]

    return {
        "title": title[:200],
        "company": company[:120],
        "location": location[:120],
        "raw_text": description_text[:8000],
        "source": url,
    }


async def create_job(db, *, source: str, source_url: Optional[str], title: str,
                     company: str, location: str, raw_text: str,
                     external_id: Optional[str] = None) -> Dict[str, Any]:
    """Idempotent insert (dedup by source_url or external_id)."""
    if source_url:
        existing = await db.career_jobs.find_one({"source_url": source_url}, {"_id": 0})
        if existing:
            return existing
    if external_id:
        existing = await db.career_jobs.find_one({"external_id": external_id}, {"_id": 0})
        if existing:
            return existing
    job = {
        "id": str(uuid.uuid4()),
        "source": source,              # "url", "greenhouse", "lever", "manual"
        "source_url": source_url,
        "external_id": external_id,
        "title": title[:200],
        "company": company[:120],
        "location": location[:120],
        "raw_text": (raw_text or "")[:12000],
        "match_score": None,           # populated by score_job
        "match_breakdown": None,
        "created_at": utc_now_iso(),
    }
    await db.career_jobs.insert_one(job)
    job.pop("_id", None)
    return job


async def list_jobs(db, min_score: Optional[int] = None, limit: int = 100) -> List[Dict[str, Any]]:
    q: Dict[str, Any] = {}
    if min_score is not None:
        q["match_score"] = {"$gte": min_score}
    rows = await db.career_jobs.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    # Decorate with current application stage
    jids = [r["id"] for r in rows]
    apps = await db.career_applications.find({"job_id": {"$in": jids}}, {"_id": 0}).to_list(2000)
    app_by_job = {a["job_id"]: a for a in apps}
    for r in rows:
        r["application"] = app_by_job.get(r["id"])
    return rows


async def delete_job(db, job_id: str) -> bool:
    res = await db.career_jobs.delete_one({"id": job_id})
    await db.career_applications.delete_many({"job_id": job_id})
    await db.career_artifacts.delete_many({"job_id": job_id})
    return res.deleted_count > 0


# ==================== Scoring ====================

SCORE_PROMPT = (
    "You are a senior tech recruiter scoring how well a candidate fits a job. "
    "Output ONLY a JSON object with: "
    "  score (integer 0-100), "
    "  strengths (array of 3-6 short bullet strings — concrete skills the candidate has that match), "
    "  gaps (array of 0-5 short bullet strings — what's missing or weak), "
    "  recommendation (one of 'apply' | 'consider' | 'skip'), "
    "  rationale (1-2 sentences). "
    "Be honest. A 0-50 means a clear miss, 70-85 strong match, 86+ near-perfect."
)


def _resume_compact(profile: Dict[str, Any]) -> str:
    lines = [
        f"Name: {profile.get('name', '')}",
        f"Headline: {profile.get('headline', '')}",
        f"Years experience: {profile.get('years_experience', 0)}",
        f"Current role: {profile.get('current_role', '')} @ {profile.get('current_company', '')}",
        f"Location: {profile.get('location', '')}  Remote pref: {profile.get('remote_preference', '')}",
        f"Skills: {', '.join(profile.get('skills') or [])}",
        f"Certifications: {', '.join(profile.get('certifications') or [])}",
        f"Summary: {profile.get('summary', '')}",
    ]
    for e in (profile.get("experience") or [])[:6]:
        lines.append(f"- {e.get('title', '')} @ {e.get('company', '')} ({e.get('start', '')}–{e.get('end', '') or 'now'}): {'; '.join(e.get('bullets') or [])[:400]}")
    for p in (profile.get("projects") or [])[:4]:
        lines.append(f"* {p.get('name', '')}: {p.get('summary', '')[:200]} | stack: {', '.join(p.get('stack') or [])}")
    return "\n".join(lines)


def _safe_json_object(text: str) -> dict:
    if not text:
        return {}
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return {}
    try:
        return json.loads(m.group(0))
    except Exception:
        return {}


async def score_job(db, job_id: str, bedrock_call: Callable) -> Dict[str, Any]:
    job = await db.career_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise ValueError("Job not found")
    profile = await get_profile(db)

    prompt = (
        f"CANDIDATE RESUME:\n{_resume_compact(profile)}\n\n"
        f"JOB DESCRIPTION:\nTitle: {job.get('title')}\nCompany: {job.get('company')}\n"
        f"Location: {job.get('location')}\n\n{(job.get('raw_text') or '')[:6000]}\n\n"
        "Return only the JSON object."
    )
    try:
        raw = await bedrock_call(
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            system_text=SCORE_PROMPT,
            max_tokens=700,
            temperature=0.2,
        )
    except Exception as e:
        logger.warning("Score LLM failed: %s", e)
        raw = ""

    obj = _safe_json_object(raw)
    score = int(obj.get("score") or 0)
    score = max(0, min(100, score))
    strengths = [str(x)[:200] for x in (obj.get("strengths") or [])][:6]
    gaps = [str(x)[:200] for x in (obj.get("gaps") or [])][:5]
    recommendation = (obj.get("recommendation") or "consider").lower()
    if recommendation not in {"apply", "consider", "skip"}:
        recommendation = "consider"
    rationale = (obj.get("rationale") or "").strip()[:500]

    breakdown = {
        "strengths": strengths,
        "gaps": gaps,
        "recommendation": recommendation,
        "rationale": rationale,
        "scored_at": utc_now_iso(),
    }
    await db.career_jobs.update_one(
        {"id": job_id},
        {"$set": {"match_score": score, "match_breakdown": breakdown}},
    )
    return {"job_id": job_id, "score": score, **breakdown}


# ==================== AI tailoring ====================

RESUME_PROMPT = (
    "Rewrite the candidate's resume to match the target JD. Be honest — do NOT invent "
    "experience the candidate doesn't have. Reorder/emphasise relevant work, surface the "
    "matching skills first, drop unrelated bullets. Output ONLY a JSON object: "
    "{ summary: str, top_skills: [str], experience_bullets: [str] (10-14 strong, JD-targeted bullets), "
    "  key_projects: [{name, summary}], suggested_resume_title: str }"
)

COVER_LETTER_PROMPT = (
    "Write a short, sharp cover letter (180-260 words) for the role from the candidate's voice. "
    "Concrete, specific, no fluff. Output ONLY a JSON object: { subject: str, body: str }."
)

INTERVIEW_KIT_PROMPT = (
    "Generate a complete interview prep kit for this role+candidate. Output ONLY a JSON object: "
    "{ technical: [{q,a}] (15 items - core technical questions with model answers), "
    "  scenario: [{q,a}] (8 items - real-world situations), "
    "  managerial: [{q,a}] (6 items - behavioural / leadership), "
    "  topics_to_revise: [str] (8 topics)}. "
    "Tailor questions to the JD's specific stack."
)


async def generate_artifact(db, job_id: str, kind: str, bedrock_call: Callable,
                            style_prompt: str = "") -> Dict[str, Any]:
    """Generate a tailored resume / cover letter / interview kit for this job."""
    if kind not in {"resume", "cover_letter", "interview_kit"}:
        raise ValueError(f"Unknown kind {kind!r}")
    job = await db.career_jobs.find_one({"id": job_id}, {"_id": 0})
    if not job:
        raise ValueError("Job not found")
    profile = await get_profile(db)

    sys_map = {
        "resume": RESUME_PROMPT,
        "cover_letter": COVER_LETTER_PROMPT,
        "interview_kit": INTERVIEW_KIT_PROMPT,
    }
    system_text = sys_map[kind]
    if style_prompt:
        system_text += f"\n\nWrite in this voice: {style_prompt}"

    prompt = (
        f"CANDIDATE PROFILE:\n{_resume_compact(profile)}\n\n"
        f"TARGET JOB:\n{job.get('title')} @ {job.get('company')} ({job.get('location')})\n\n"
        f"{(job.get('raw_text') or '')[:6000]}\n\n"
        "Return only the JSON object."
    )
    try:
        raw = await bedrock_call(
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            system_text=system_text,
            max_tokens=1800 if kind == "interview_kit" else 1100,
            temperature=0.4,
        )
    except Exception as e:
        logger.warning("Tailoring LLM failed (%s): %s", kind, e)
        raw = ""

    payload = _safe_json_object(raw) or {}
    doc = {
        "id": str(uuid.uuid4()),
        "job_id": job_id,
        "kind": kind,
        "payload": payload,
        "created_at": utc_now_iso(),
    }
    # Keep only latest artifact of each kind per job
    await db.career_artifacts.delete_many({"job_id": job_id, "kind": kind})
    await db.career_artifacts.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def get_artifact(db, job_id: str, kind: str) -> Optional[Dict[str, Any]]:
    return await db.career_artifacts.find_one({"job_id": job_id, "kind": kind}, {"_id": 0})


# ==================== Applications / CRM ====================

async def upsert_application(db, job_id: str, stage: str, notes: str = "") -> Dict[str, Any]:
    if stage not in STAGES:
        raise ValueError(f"Invalid stage. Use one of {STAGES}")
    existing = await db.career_applications.find_one({"job_id": job_id}, {"_id": 0})
    now = utc_now_iso()
    if existing:
        history = existing.get("history") or []
        if not history or history[-1].get("stage") != stage:
            history.append({"stage": stage, "at": now, "notes": notes})
        await db.career_applications.update_one(
            {"job_id": job_id},
            {"$set": {"stage": stage, "history": history, "updated_at": now, "notes": notes}},
        )
        existing.update({"stage": stage, "history": history, "updated_at": now, "notes": notes})
        return existing
    doc = {
        "id": str(uuid.uuid4()),
        "job_id": job_id,
        "stage": stage,
        "notes": notes,
        "history": [{"stage": stage, "at": now, "notes": notes}],
        "created_at": now,
        "updated_at": now,
    }
    await db.career_applications.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def pipeline_summary(db) -> Dict[str, Any]:
    rows = await db.career_applications.find({}, {"_id": 0}).to_list(2000)
    by_stage: Dict[str, int] = {s: 0 for s in STAGES}
    for r in rows:
        s = r.get("stage", "discovered")
        by_stage[s] = by_stage.get(s, 0) + 1
    total_apps = sum(by_stage.values()) - by_stage.get("discovered", 0)
    interviews = by_stage.get("interview", 0) + by_stage.get("offer", 0)
    offers = by_stage.get("offer", 0)
    resp_rate = round(interviews / total_apps * 100, 1) if total_apps else 0
    return {
        "by_stage": by_stage,
        "metrics": {
            "applications": total_apps,
            "interviews": interviews,
            "offers": offers,
            "response_rate_pct": resp_rate,
        },
    }


# ==================== Job boards (sustainable public APIs) ====================

GREENHOUSE_BASE = "https://boards-api.greenhouse.io/v1/boards/{}/jobs?content=true"
LEVER_BASE = "https://api.lever.co/v0/postings/{}?mode=json"

# Curated default board list — companies that use Greenhouse / Lever publicly
DEFAULT_BOARDS = [
    {"name": "Stripe", "kind": "greenhouse", "slug": "stripe"},
    {"name": "Airbnb", "kind": "greenhouse", "slug": "airbnb"},
    {"name": "Notion", "kind": "greenhouse", "slug": "notion"},
    {"name": "Razorpay", "kind": "lever", "slug": "razorpay"},
    {"name": "Cred", "kind": "lever", "slug": "cred"},
    {"name": "Postman", "kind": "lever", "slug": "postman"},
    {"name": "Zomato", "kind": "lever", "slug": "zomato"},
    {"name": "Swiggy", "kind": "lever", "slug": "swiggy"},
]


def _location_text(loc) -> str:
    if isinstance(loc, dict):
        return loc.get("name", "") or loc.get("addressLocality", "") or ""
    if isinstance(loc, str):
        return loc
    return ""


async def _fetch_greenhouse(board_slug: str) -> List[Dict[str, Any]]:
    url = GREENHOUSE_BASE.format(board_slug)
    try:
        async with httpx.AsyncClient(timeout=20.0) as http:
            r = await http.get(url)
            if r.status_code != 200:
                return []
            data = r.json()
    except Exception as e:
        logger.warning("Greenhouse fetch failed for %s: %s", board_slug, e)
        return []
    jobs = data.get("jobs") or []
    out = []
    for j in jobs:
        out.append({
            "external_id": f"gh:{board_slug}:{j.get('id')}",
            "source": "greenhouse",
            "source_url": j.get("absolute_url"),
            "title": j.get("title", ""),
            "company": board_slug.title(),
            "location": _location_text(j.get("location")),
            "raw_text": _strip_html(j.get("content") or "")[:12000],
        })
    return out


async def _fetch_lever(slug: str) -> List[Dict[str, Any]]:
    url = LEVER_BASE.format(slug)
    try:
        async with httpx.AsyncClient(timeout=20.0) as http:
            r = await http.get(url)
            if r.status_code != 200:
                return []
            data = r.json() or []
    except Exception as e:
        logger.warning("Lever fetch failed for %s: %s", slug, e)
        return []
    out = []
    for j in data:
        cats = j.get("categories") or {}
        out.append({
            "external_id": f"lever:{slug}:{j.get('id')}",
            "source": "lever",
            "source_url": j.get("hostedUrl") or j.get("applyUrl"),
            "title": j.get("text", ""),
            "company": slug.title(),
            "location": cats.get("location") or "",
            "raw_text": _strip_html(j.get("descriptionPlain") or j.get("description") or "")[:12000],
        })
    return out


async def sync_boards(db, bedrock_call: Callable,
                      auto_score: bool = True, max_per_board: int = 30) -> Dict[str, Any]:
    """Pull jobs from every configured board, dedupe by external_id, optionally score them."""
    configured = await db.career_boards.find({}, {"_id": 0}).to_list(50)
    if not configured:
        configured = DEFAULT_BOARDS

    profile = await get_profile(db)
    title_filters = [t.lower() for t in (profile.get("filters", {}).get("titles") or [])]
    loc_filters = [l.lower() for l in (profile.get("filters", {}).get("locations") or [])]

    new_jobs: List[Dict[str, Any]] = []
    for b in configured:
        kind, slug = b.get("kind"), b.get("slug")
        if not slug:
            continue
        if kind == "greenhouse":
            postings = await _fetch_greenhouse(slug)
        elif kind == "lever":
            postings = await _fetch_lever(slug)
        else:
            continue
        # Filter by user titles/locations if set
        kept = 0
        for p in postings:
            tl = (p["title"] or "").lower()
            ll = (p["location"] or "").lower()
            if title_filters and not any(t in tl for t in title_filters):
                continue
            if loc_filters and not any(l in ll for l in loc_filters):
                # allow remote if filter has "remote" or location is empty/remote-ish
                if "remote" in loc_filters and ("remote" in ll or not ll):
                    pass
                else:
                    continue
            existing = await db.career_jobs.find_one({"external_id": p["external_id"]}, {"_id": 0})
            if existing:
                continue
            job = await create_job(db, **p)
            new_jobs.append(job)
            kept += 1
            if kept >= max_per_board:
                break

    # Score the new ones (best-effort, parallel small batches)
    scored = 0
    for job in new_jobs:
        try:
            await score_job(db, job["id"], bedrock_call)
            scored += 1
        except Exception as e:
            logger.warning("auto-score failed: %s", e)

    await db.sync_state.update_one(
        {"id": "career_boards"},
        {"$set": {
            "id": "career_boards",
            "last_run_at": utc_now_iso(),
            "new_jobs": len(new_jobs),
            "scored": scored,
        }},
        upsert=True,
    )
    return {"new_jobs": len(new_jobs), "scored": scored,
            "boards_checked": len(configured)}


async def list_boards(db) -> List[Dict[str, Any]]:
    rows = await db.career_boards.find({}, {"_id": 0}).to_list(100)
    if not rows:
        return DEFAULT_BOARDS
    return rows


async def replace_boards(db, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cleaned = []
    for it in (items or []):
        kind = (it.get("kind") or "").lower()
        slug = (it.get("slug") or "").strip()
        if kind not in {"greenhouse", "lever"} or not slug:
            continue
        cleaned.append({"name": it.get("name") or slug.title(), "kind": kind, "slug": slug})
    await db.career_boards.delete_many({})
    if cleaned:
        await db.career_boards.insert_many([dict(x) for x in cleaned])
    return cleaned
