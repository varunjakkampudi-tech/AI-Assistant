"""
PERSONAL KNOWLEDGE GRAPH
========================
Builds a graph of nodes (people / projects / skills / topics / goals) and edges
(relationships) from existing structured data:

  - Memories  (`db.memories.category in {person, project, skill, goal, meeting, date, preference}`)
  - Goals
  - Knowledge documents (topic tags)
  - Frequent contacts (digital twin)
  - Transaction merchants (top recurring → 'spending' nodes)

Edges are inferred when two entities co-occur in the same chat session, the same
memory content, or the same goal description.
"""
from __future__ import annotations
import re
import logging
from collections import defaultdict
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


_CATEGORY_TO_TYPE = {
    "person": "person",
    "project": "project",
    "skill": "skill",
    "goal": "goal",
    "meeting": "event",
    "date": "event",
    "preference": "topic",
    "other": "topic",
}


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")[:64] or "node"


async def build_graph(db) -> Dict[str, Any]:
    """Build the full personal knowledge graph."""
    nodes: Dict[str, Dict[str, Any]] = {}
    edges_set: set = set()
    edges: List[Dict[str, Any]] = []

    def add_node(node_id: str, label: str, ntype: str, importance: int = 3, meta: Dict | None = None):
        if node_id in nodes:
            n = nodes[node_id]
            n["importance"] = max(n["importance"], importance)
            n["weight"] = n.get("weight", 1) + 1
        else:
            nodes[node_id] = {
                "id": node_id,
                "label": label,
                "type": ntype,
                "importance": importance,
                "weight": 1,
                **(meta or {}),
            }

    def add_edge(a: str, b: str, kind: str):
        if a == b:
            return
        key = (a, b, kind) if a < b else (b, a, kind)
        if key in edges_set:
            return
        edges_set.add(key)
        edges.append({"source": a, "target": b, "kind": kind})

    # The root "Me" node
    root_id = "me"
    add_node(root_id, "Me", "self", importance=5)

    # --- Memories ---
    async for m in db.memories.find({}, {"_id": 0}):
        subj = m.get("subject") or ""
        cat = m.get("category") or "other"
        if not subj:
            continue
        ntype = _CATEGORY_TO_TYPE.get(cat, "topic")
        node_id = f"{ntype}:{_slug(subj)}"
        add_node(node_id, subj, ntype, importance=int(m.get("importance", 3)),
                 meta={"content": (m.get("content") or "")[:200]})
        add_edge(root_id, node_id, "knows")

        # Co-mention inside content: link entities that appear in the same memory
        content_lower = (m.get("content") or "").lower()
        # We'll fill these after we collect all node labels (second pass)

    # --- Goals as nodes ---
    async for g in db.goals.find({}, {"_id": 0}):
        title = g.get("title") or ""
        if not title:
            continue
        gid = f"goal:{_slug(title)}"
        add_node(gid, title, "goal", importance=4, meta={"progress": g.get("progress", 0)})
        add_edge(root_id, gid, "has-goal")

    # --- Knowledge documents ---
    if "knowledge_documents" in await db.list_collection_names():
        async for k in db.knowledge_documents.find({}, {"_id": 0}):
            fname = k.get("filename") or "Document"
            did = f"doc:{_slug(fname)}"
            add_node(did, fname, "document", importance=2,
                     meta={"summary": (k.get("summary") or "")[:200]})
            add_edge(root_id, did, "owns")

    # --- Frequent contacts ---
    profile = await db.user_profile.find_one({"id": "user_profile"}, {"_id": 0}) or {}
    for c in (profile.get("frequent_contacts") or [])[:30]:
        name = c.get("name") or ""
        if not name:
            continue
        cid = f"person:{_slug(name)}"
        add_node(cid, name, "person", importance=3,
                 meta={"relationship": c.get("relationship") or "contact"})
        add_edge(root_id, cid, "contacts")

    # --- Top recurring transaction merchants → 'spending' nodes ---
    merchant_counts: Dict[str, int] = defaultdict(int)
    async for t in db.notifications.find({"kind": "transaction"}, {"_id": 0, "merchant": 1}):
        merchant = (t.get("merchant") or "").strip()
        if merchant and merchant != "Unknown":
            merchant_counts[merchant] += 1
    for merchant, count in sorted(merchant_counts.items(), key=lambda x: -x[1])[:10]:
        mid = f"spend:{_slug(merchant)}"
        add_node(mid, merchant, "spending", importance=2, meta={"count": count})
        add_edge(root_id, mid, "spends-at")

    # --- Co-mention edges (second pass on memories) ---
    labels_by_id = {nid: n["label"].lower() for nid, n in nodes.items() if nid != root_id}
    async for m in db.memories.find({}, {"_id": 0, "content": 1, "subject": 1}):
        text = ((m.get("content") or "") + " " + (m.get("subject") or "")).lower()
        if not text.strip():
            continue
        present = [nid for nid, lbl in labels_by_id.items() if lbl and lbl in text]
        for i, a in enumerate(present):
            for b in present[i + 1:]:
                add_edge(a, b, "co-mention")

    return {
        "root": root_id,
        "nodes": list(nodes.values()),
        "edges": edges,
        "counts": {
            "nodes": len(nodes),
            "edges": len(edges),
            "by_type": _count_by_type(nodes),
        },
    }


def _count_by_type(nodes: Dict[str, Dict[str, Any]]) -> Dict[str, int]:
    out: Dict[str, int] = defaultdict(int)
    for n in nodes.values():
        out[n["type"]] += 1
    return dict(out)


async def related_to(db, query: str, depth: int = 1) -> Dict[str, Any]:
    """Return the sub-graph related to a given label (case-insensitive substring match)."""
    graph = await build_graph(db)
    q = (query or "").lower().strip()
    if not q:
        return graph

    matched_ids = {n["id"] for n in graph["nodes"] if q in n["label"].lower()}
    if not matched_ids:
        return {"root": graph["root"], "nodes": [], "edges": [], "counts": {"nodes": 0, "edges": 0}}

    # BFS
    keep = set(matched_ids)
    frontier = set(matched_ids)
    for _ in range(depth):
        new_frontier = set()
        for e in graph["edges"]:
            if e["source"] in frontier and e["target"] not in keep:
                new_frontier.add(e["target"])
            if e["target"] in frontier and e["source"] not in keep:
                new_frontier.add(e["source"])
        keep |= new_frontier
        frontier = new_frontier
        if not frontier:
            break

    sub_nodes = [n for n in graph["nodes"] if n["id"] in keep]
    sub_edges = [e for e in graph["edges"] if e["source"] in keep and e["target"] in keep]
    return {
        "root": graph["root"],
        "query": query,
        "nodes": sub_nodes,
        "edges": sub_edges,
        "counts": {"nodes": len(sub_nodes), "edges": len(sub_edges)},
    }
