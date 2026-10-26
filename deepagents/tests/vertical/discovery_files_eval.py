"""Opt-in Phase 5 discovery evaluation; --self-test never constructs a provider model.

Run from deepagents/: PYTHONPATH=.:tests .venv/bin/python
tests/vertical/discovery_files_eval.py --out /absolute/output [--self-test]
Live approval: LCSP_FBD_LIVE_APPROVED=owner-approved-2026-10-24-phase5.
The output directory must be empty. Every invocation owns and removes its database.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from contextlib import contextmanager, ExitStack
import hashlib
import json
import multiprocessing
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import sys
import threading
import time
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler

ROOT = Path(__file__).resolve().parents[3]
APPROVAL = "owner-approved-2026-10-24-phase5"
DOCUMENT = "luat-so-134-2025-qh15-luat-tri-tue-nhan-tao"
VERSION = "c5579ca5-748a-499d-b5d1-327f9e39ef17"
CONTAINER = "lcsp-fbd-eval-pg"
DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55449/lcsp_review_frontier_test"
GOLDEN = ROOT / "reports/lcsp360-fbd/golden-luat-134.json"
HARD_CALLS, HARD_INPUT, HARD_SECONDS = 600, 12_000_000, 5400
UNDECLARED_WINDOW = 131_072


def require_live_approval(environ=None):
    if (os.environ if environ is None else environ).get("LCSP_FBD_LIVE_APPROVED") != APPROVAL:
        raise RuntimeError(f"Live evaluation refused: LCSP_FBD_LIVE_APPROVED must equal {APPROVAL}")


def limits(environ=None):
    env = os.environ if environ is None else environ
    result = {}
    for name, ceiling in (("LCSP_RSP_MAX_MODEL_CALLS", HARD_CALLS), ("LCSP_RSP_MAX_INPUT_TOKENS", HARD_INPUT)):
        value = int(env.get(name, ceiling))
        if not 0 < value <= ceiling:
            raise ValueError(f"{name} must be between 1 and {ceiling}; overrides only downward")
        result[name] = value
    return result


def command(args, *, env=None, input=None, timeout=180, cwd=ROOT):
    result = subprocess.run(args, input=input, text=True, capture_output=True, cwd=cwd,
                            env=env, timeout=timeout, check=False)
    if result.returncode:
        # Do not echo provider credentials, connection URLs or source text from child errors.
        raise RuntimeError(f"{Path(args[0]).name} {args[1] if len(args) > 1 else ''} exited {result.returncode}")
    return result.stdout.strip()


@contextmanager
def disposable_database():
    owner = secrets.token_hex(16)
    # docker run refuses an existing name; never adopt or delete someone else's container.
    container_id = command(["docker", "run", "-d", "--name", CONTAINER,
        "--label", f"lcsp.fbd.eval.owner={owner}", "-e", "POSTGRES_PASSWORD=postgres",
        "-e", "POSTGRES_DB=lcsp_review_frontier_test", "-p", "127.0.0.1:55449:5432", "postgres:16"])
    env = {**os.environ, "DATABASE_URL": DATABASE_URL, "LCSP_FBD_EVAL_OWNER": owner,
           "LCSP_FBD_EVAL_CONTAINER_ID": container_id,
           "LEGAL_CLAIM_DISCOVERY_DIAGNOSTICS_ENABLED": "true"}
    try:
        for _ in range(60):
            ready = subprocess.run(["docker", "exec", container_id, "pg_isready", "-U", "postgres"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if ready.returncode == 0:
                break
            time.sleep(0.5)
        else:
            raise RuntimeError("Disposable Postgres did not become ready")
        # The postgres image restarts once after initialising; pg_isready can answer before that restart.
        for attempt in range(6):
            try:
                command(["pnpm", "exec", "prisma", "migrate", "deploy"], env=env, cwd=ROOT / "apps/api", timeout=240)
                break
            except RuntimeError:
                if attempt == 5:
                    raise
                time.sleep(3)
        yield env
    finally:
        command(["docker", "rm", "-f", container_id], timeout=30)


class Bridge:
    def __init__(self, env):
        self.process = subprocess.Popen(["pnpm", "exec", "tsx", "apps/api/test/support/discovery-files-eval-bridge.ts"],
            cwd=ROOT, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.lock = threading.Lock()

    def call(self, action, request):
        with self.lock:
            self.process.stdin.write(json.dumps({"action": action, "request": request}) + "\n")
            self.process.stdin.flush()
            for line in self.process.stdout:
                try:
                    value = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if "error" in value:
                    raise RuntimeError(value["error"])
                if "result" in value:
                    return value["result"]
            raise RuntimeError("Evaluation API bridge exited")

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            self.process.wait(timeout=10)


class EvaluationApi:
    def __init__(self, bridge):
        self.bridge = bridge

    def source_review_operation(self, run_id, revision, action, **fields):
        return self.bridge.call("REVIEW", {"preparationRunId": run_id, "inventoryRevision": revision, "action": action, **fields})

    def claim_inventory_operation(self, run_id, action, revision, **fields):
        return self.bridge.call("INVENTORY", {"preparationRunId": run_id, "revision": revision, "action": action, **fields})

    def validate_compliance_rule_set(self, *args, **kwargs):
        raise AssertionError("Discovery-only evaluation cannot validate Rules")

    def submit_compliance_rule_set(self, *args, **kwargs):
        raise AssertionError("Discovery-only evaluation cannot submit Rules")


REFERENCE_DOCUMENT = "luat-so-71-2025-qh15-luat-cong-nghiep-cong-nghe-so"


def export_corpus(articles=None):
    """The only dev-DB operation: a fixed, read-only transaction through psql.

    Luật 134 is reviewed; Luật 71 (partly repealed by Điều 33) is exported with the role it has in the draft version, so a
    repeal target is a readable pinned node and the document stays out of the review denominator.
    """
    entries = []
    for document in (DOCUMENT, REFERENCE_DOCUMENT):
        sql = f'''BEGIN READ ONLY;
SELECT json_build_object('document', row_to_json(d), 'chunks',
 (SELECT json_agg(c ORDER BY c.locator) FROM "LegalDocumentChunk" c
  WHERE c."legalSourceVersionId" = '{VERSION}' AND c."documentId" = '{document}'))
FROM "LegalSourceDocument" d WHERE d."legalSourceVersionId" = '{VERSION}' AND d."documentId" = '{document}';
ROLLBACK;'''
        raw = command(["docker", "exec", "-i", "fogewise-postgres", "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
                       "-U", "fogewise", "-d", "lcsp_dev"], input=sql)
        value = json.loads(raw)
        if value["document"]["documentId"] != document:
            raise RuntimeError("Pinned v4 document inventory changed")
        for chunk in value["chunks"]:
            if hashlib.sha256(chunk["content"].encode()).hexdigest() != chunk["contentSha256"].removeprefix("sha256:"):
                raise RuntimeError("Dev export content hash mismatch")
        entries.append(value)
    if len(entries[0]["chunks"]) != 198 or entries[0]["document"].get("corpusRole") != "OPERATIVE" or entries[1]["document"].get("corpusRole") != "REFERENCE_ONLY":
        raise RuntimeError("Pinned v4 chunk inventory or corpus roles changed")
    if articles:
        # A slice of the real document (e.g. Điều 14 and 15): same text and hashes, without the rest of the instrument.
        wanted = re.compile(r"^art-(?:" + "|".join(re.escape(a) for a in articles) + r")(?:::|$)")
        entries[0]["chunks"] = [c for c in entries[0]["chunks"] if wanted.match(c["locator"])]
        if not entries[0]["chunks"]:
            raise RuntimeError("The requested articles are not in the pinned document")
        # The structure is parsed from the extracted text, not from chunks: cut the text to the same articles.
        extraction = dict(entries[0]["document"]["extraction"])
        text = "\n".join(extraction["pages"])
        heads = {int(m.group(1)): m.start() for m in re.finditer(r"(?m)^Điều (\d+)\b", text)}
        numbers = sorted(int(a) for a in articles)
        start, end = heads[numbers[0]], heads.get(numbers[-1] + 1, len(text))
        cut = text[start:end]
        extraction.update(pages=[cut], pageCount=1, characterCount=len(cut), frontMatterCharacters=0, textSha256=hashlib.sha256(cut.encode()).hexdigest())
        entries[0]["document"]["extraction"] = extraction
        return {"entries": [entries[0]], "articles": list(articles)}
    return {"entries": entries, "expectedNodes": 665, "expectedReferences": 103}


def synthetic_slice():
    """Three mechanical fixture articles, independent of dev DB and provider availability."""
    from uuid import uuid4
    texts = ["Article 1 — Scope\nThis notice applies to operators.",
             "Article 2 — Definition\nA record means a stored notice.",
             "Article 3 — Duty\nOperators must retain records."]
    sha = lambda s: hashlib.sha256(s.encode()).hexdigest()
    return {"entries": [{"document": {"documentId": "synthetic-fbd", "title": "Synthetic mechanical slice",
        "sourceUrl": "https://example.invalid/fbd", "sourceSha256": sha("\n".join(texts)),
        "sourceEffectStatus": "IN_FORCE"}, "chunks": [{"id": str(uuid4()), "documentId": "synthetic-fbd",
        "locator": f"art-{i}", "content": text, "contentSha256": sha(text), "hierarchy": {},
        "legalStatus": "ACTIVE", "legalEffectStatus": "EFFECTIVE", "legalStatusSourceRef": "synthetic:mechanical"}
        for i, text in enumerate(texts, 1)]}]}


def codes(value):
    if isinstance(value, dict):
        return ({value["code"]} if isinstance(value.get("code"), str) else set()) | set().union(*(codes(v) for v in value.values()), set())
    if isinstance(value, list):
        return set().union(*(codes(v) for v in value), set())
    return set()


class Trace(BaseCallbackHandler):
    """Native callback evidence contains IDs, counts and codes, never model/tool text."""
    run_inline = True
    raise_error = True

    def __init__(self, path):
        self.path, self.lock = path, threading.Lock()
        self.tools = Counter()
        self.rejections = Counter()
        self.rejected_calls = 0
        self.names = {}

    def event(self, kind, **fields):
        with self.lock, self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"at": time.time(), "event": kind, **fields}, ensure_ascii=False) + "\n")

    def on_chat_model_start(self, serialized, messages, *, run_id, **kwargs):
        from middleware.usage_metering import active_agent_role
        self.event("MODEL_START", id=str(run_id), role=active_agent_role())

    def on_llm_end(self, response, *, run_id, **kwargs):
        self.event("MODEL_END", id=str(run_id))

    def on_llm_error(self, error, *, run_id, **kwargs):
        # Provider/gateway error text (status, quota or stream fault); it never contains prompts or source text.
        self.event("MODEL_ERROR", id=str(run_id), errorType=type(error).__name__, message=str(error)[:400])

    def on_tool_start(self, serialized, input_str, *, run_id, **kwargs):
        name = (serialized or {}).get("name", "UNKNOWN")
        with self.lock:
            self.names[str(run_id)] = name
            self.tools[name] += 1
        self.event("TOOL_START", id=str(run_id), tool=name)

    def on_tool_end(self, output, *, run_id, **kwargs):
        content = getattr(output, "content", output)
        try:
            value = json.loads(content) if isinstance(content, str) else content
        except (ValueError, TypeError):
            value = {}
        rejected = getattr(output, "status", None) == "error" or (isinstance(value, dict) and value.get("outcome") == "FAILED")
        found = codes(value) if rejected else set()
        with self.lock:
            name = self.names.pop(str(run_id), "UNKNOWN")
            if rejected:
                self.rejected_calls += 1
                self.rejections.update(found or {"TOOL_ERROR"})
        extra = {"detail": str(content)[:6000 if name == "commit_claims" else 400]} if rejected else {}
        self.event("TOOL_END", id=str(run_id), tool=name, rejected=rejected, codes=sorted(found), **extra)

    def on_tool_error(self, error, *, run_id, **kwargs):
        with self.lock:
            name = self.names.pop(str(run_id), "UNKNOWN")
            self.rejected_calls += 1
            self.rejections[type(error).__name__] += 1
        self.event("TOOL_ERROR", id=str(run_id), tool=name, errorType=type(error).__name__)


def usage_metrics(rows):
    """Physical attempts, including failed/fallback attempts; cache buckets counted once."""
    attempts, responses = {}, {}
    for row in rows:
        key = row.get("invocationId")
        if row.get("event") == "MODEL_ATTEMPT":
            if attempts.get(key, {}).get("attemptStatus") != "COMPLETED":
                attempts[key] = row
        if row.get("event") == "MODEL_RESPONSE":
            responses[key] = row
    roles = defaultdict(lambda: {"modelCalls": 0, "inputTokens": 0, "cachedInputTokens": 0,
                               "cacheWriteTokens": 0, "outputTokens": 0, "totalTokens": 0})
    missing = []
    for key in attempts.keys() | responses.keys():
        row = responses.get(key, attempts.get(key))
        usage = row.get("usage") if row["event"] == "MODEL_RESPONSE" else row
        role = row.get("agentRole", "UNKNOWN")
        role = "producer" if role == "rule-set-preparation" else role
        bucket = roles[role]
        bucket["modelCalls"] += 1
        if row.get("attemptStatus") == "FAILED":
            continue  # rejected by the provider (429/401): no tokens were produced or billed
        if not usage or not all(k in usage for k in ("inputTokens", "inputTokensIncludingCache", "outputTokens")):
            missing.append(key)
            continue
        for field in ("inputTokens", "cachedInputTokens", "cacheWriteTokens", "outputTokens"):
            bucket[field] += int(usage.get(field) or 0)
        bucket["totalTokens"] += int(usage["inputTokensIncludingCache"]) + int(usage["outputTokens"])
    return {"roles": dict(roles), "modelCalls": sum(r["modelCalls"] for r in roles.values()),
            "tokens": sum(r["totalTokens"] for r in roles.values()), "missingUsageCalls": len(missing),
            "accountingComplete": bool(attempts or responses) and not missing}


def under(path, root):
    """True when the node path is the anchor or below it. An anchor is a legal address (article/14/clause/1); the node's
    structural path may carry containers in between (chapter/ii/...), so the anchor matches as a path-segment suffix."""
    path, root = path.rstrip("/") + "/", root.rstrip("/") + "/"
    return root in path if not root.startswith("/document/") else path.startswith(root)


def evaluate_anchors(golden, graph, claims, reference_accounting):
    nodes = {n["nodeId"]: n for n in graph["nodes"]}
    doc = golden["document"]
    def supported(claim, path):
        return any(s.get("nodeId") in nodes and nodes[s["nodeId"]]["documentId"] == doc and
                   under(nodes[s["nodeId"]]["structuralPath"], path) for s in claim.get("sourceSupport", []))
    accounting = {r["referenceId"]: r for r in reference_accounting}
    results = []
    for anchor in golden["anchors"]:
        path = "/" + anchor["path"]
        states = {"RELEVANT", "INTENTIONALLY_NON_OPERATIVE"} if anchor.get("non_operative_ok") else {"RELEVANT"}
        present = [c for c in claims if c.get("state") in states and supported(c, path)]
        kinds = {c["claimType"] for c in present}
        missing = [need for need in anchor["needs"] if not (bool(present) if need == "any" else kinds.intersection(need.split("|")))]
        missing_points = [p for p in anchor.get("point_labels", []) if not any(
            c["claimType"] == "DUTY" and supported(c, path + "/point/" + p) for c in present)]
        if anchor.get("legal_effect"):
            effects = [(c.get("semanticFrame") or {}).get("legalEffect") or {} for c in present]
            matched = any(e.get("kind") == anchor["legal_effect"] and (
                any(nodes.get(t.get("nodeId"), {}).get("documentId") == anchor["target_document"] for t in e.get("targets", [])) or
                any(t.get("documentIdentifier") == anchor["target_document"] and t.get("reason", "").strip() and t.get("locator", "").strip()
                    for t in e.get("unresolvedTargets", []))) for e in effects)
            if not matched:
                missing.append("REPEALS target or reasoned unresolvedTargets naming " + anchor["target_document"])
        if anchor.get("reference_to_document"):
            target = anchor["reference_to_document"]
            refs = [r for r in graph.get("references", []) if r["fromNodeId"] in nodes and under(nodes[r["fromNodeId"]]["structuralPath"], path)]
            if not any(r["referenceId"] in accounting and (
                nodes.get(r.get("toNodeId"), {}).get("documentId") == target or
                (r.get("resolutionState") in {"UNRESOLVED", "AMBIGUOUS"} and
                 target in accounting[r["referenceId"]].get("nonMaterialReason", ""))) for r in refs):
                missing.append("accounted reference to " + target)
        results.append({"path": anchor["path"], "pass": not missing and not missing_points,
                        "types": sorted(kinds), "missing": missing, "missingPoints": missing_points})
    return results


def evaluate_gates(metrics, golden, anchors):
    spec = golden["gates"]
    return {
        "model_calls": metrics["accountingComplete"] and metrics["modelCalls"] <= spec["max_model_calls"],
        "tokens": metrics["accountingComplete"] and metrics["tokens"] <= spec["max_tokens"],
        "minutes": metrics["minutes"] <= spec["max_minutes"],
        "tool_reject_ratio": metrics["toolRejectRatio"] <= spec["max_tool_reject_ratio"],
        "terminal_phase": metrics["claimPhase"] == spec["must_end"] and metrics["executionState"] != "PAUSED",
        "frontier_complete": metrics["frontierComplete"],
        "article_locators": not metrics["unaccountedLocators"] and not metrics["conflictingLocators"],
        "references": metrics["referenceAccountingComplete"],
        "golden_anchors": bool(anchors) and all(a["pass"] for a in anchors),
        "discovery_only": metrics["ruleSets"] == 0,
        "runtime": not metrics.get("errorType"),
    }


def write_report(out, metrics, golden, graph, claims, references):
    anchors = evaluate_anchors(golden, graph, claims, references)
    gates = evaluate_gates(metrics, golden, anchors)
    metrics.update(gates=gates, anchors=anchors, result="PASS" if all(gates.values()) else "FAIL")
    (out / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2))
    (out / "claims.json").write_text(json.dumps(claims, ensure_ascii=False, indent=2))
    lines = ["# File discovery evaluation", "", f"Result: **{metrics['result']}** ({metrics['mode']}).", "",
        f"Calls: {metrics['modelCalls']}; tokens including cache and output: {metrics['tokens']}; minutes: {metrics['minutes']:.2f}.",
        f"Final claim phase: {metrics['claimPhase']}; execution: {metrics['executionState']}.", "",
        "| Gate | Result |", "|---|---|"]
    lines += [f"| {name} | {'PASS' if passed else 'FAIL'} |" for name, passed in gates.items()]
    lines += ["", "## Anchor checks", ""] + [f"- {'PASS' if a['pass'] else 'FAIL'} {a['path']}: types={a['types']}; missing={a['missing']}; missing points={a['missingPoints']}" for a in anchors]
    lines += ["", "## First diagnostic lines", "```json"]
    diagnostic = [json.dumps({"gate": k, "result": "FAIL"}) for k, v in gates.items() if not v]
    trace_lines = (out / "trace.jsonl").read_text().splitlines() if (out / "trace.jsonl").exists() else []
    diagnostic += [line for line in trace_lines if '"rejected": true' in line or 'ERROR' in line or 'PAUSE' in line][:10]
    lines += diagnostic or ["No failing gate or rejected tool event."]
    lines += ["```", "", "## Limits", "",
        "Cross-document targets absent from this one-document source are UNRESOLVED by construction. Every such reference still needs reasoned accounting.",
        "Golden anchors check presence and locator coverage, not legal correctness or completeness of statements. Commit and finalize enforce deterministic provenance, coverage, reference accounting and integrity.",
        "Input tokens exclude separate cache buckets; the token gate adds input including cache plus output exactly once. Missing usage fails cost gates. No monetary price is inferred.",
        "The offline self-test uses three synthetic articles and a scripted model. Its results prove plumbing only and cannot satisfy the real Luật 134 acceptance gate.",
        "The original blob bytes are not copied; document source/extraction metadata and chunk text/hashes are retained. Retrieval validity is a fixture marker, not a rerun of retrieval acceptance.",
        "The database is removed after evidence export. This evaluator has no resume mode or automatic retry.", ""]
    (out / "report.md").write_text("\n".join(lines), encoding="utf-8")
    return metrics


def quota_usage(run_id, out):
    """Production guard: AgentRunBudgetMiddleware quotas (LCSP_RSP_MAX_*) pause the run; the parent adds a hard token watchdog.

    The strict per-request paid admission (bounded_usage) refuses requests whose route/credential identity drifts
    while credential rotation and fallbacks run, which aborts a long multi-agent run; it is kept for the
    separate bounded live evaluation and is not used here.
    """
    from model_policy import resolve_agent_model
    from vertical.live_preparation import LiveUsage
    return LiveUsage(run_id, str(out / "usage.json")), resolve_agent_model("rule-set-preparation")


def scripted_model(context):
    from langchain_core.messages import AIMessage
    from langchain_core.outputs import ChatGeneration, ChatResult
    from middleware.usage_metering import active_agent_role
    from pydantic import Field
    from test_rule_set_preparation_native_isolation_preparation import RuleSetPreparationScriptedModel
    from rule_set_preparation.claim_files import claim_path
    source = context.source_graph
    def call(name, args, id):
        return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": id}])
    child = []
    parent = [call("write_todos", {"todos": [{"content": "Review synthetic Articles", "status": "in_progress"}]}, "todos")]
    duty_file = next(p for p in source.source_files if source.file_articles[p] == "art-3")
    duty_target = claim_path(duty_file).removeprefix("/work/claims/") + "#claim-0"
    for i, (path, ids) in enumerate(sorted(((path, ids) for path, ids in source.source_files.items() if any(source.nodes[nid]["content"].strip() for nid in ids)), key=lambda item: source.file_articles[item[0]], reverse=True)):
        target, claims, no_claims = claim_path(path), [], {}
        for nid in ids:
            node = source.nodes[nid]
            if not node["content"].strip():
                no_claims[source.locators[nid]] = "Synthetic structural heading"
                continue
            kind = {"art-1": "SCOPE", "art-2": "DEFINITION", "art-3": "DUTY"}[source.file_articles[path]]
            claims.append({"key": f"claim-{len(claims)}", "type": kind, "statement": node["content"],
                "actor": "Operators" if kind == "DUTY" else None, "action": "retain records" if kind == "DUTY" else None,
                "authority": "DEFINITION" if kind == "DEFINITION" else "LEGAL_NORMATIVE",
                "assessability": "EXTERNAL_FULFILLMENT" if kind == "DUTY" else "NON_ASSESSABLE", "frame": {},
                "relevant": True, "nonOperativeReason": None,
                "support": [{"locator": source.locators[nid], "quote": node["content"]}],
                # A scope modifier must stay attached to the duty it conditions (cross-file, target committed first).
                "relations": [{"kind": "CONDITION_OF", "to": duty_target}] if kind == "SCOPE" else []})
        value = {"article": source.file_articles[path], "claims": claims, "noClaims": no_claims, "references": {}}
        child.extend([call("read_file", {"file_path": path}, f"read-{i}"),
            call("write_file", {"file_path": target, "content": json.dumps(value)}, f"write-{i}"),
            call("commit_claims", {"paths": [target]}, f"commit-{i}"),
            AIMessage(content="done: 1 article, 1 claim, 0 waiting references")])
        parent.append(call("task", {"subagent_type": "claim-author", "description": json.dumps({"sourceFiles": [path], "claimFiles": [target]})}, f"child-{i}"))
    parent += [call("discovery_status", {}, "status"), call("finalize_semantic_claim_inventory", {}, "finalize")]
    class Model(RuleSetPreparationScriptedModel):
        queues: dict = Field(default_factory=dict)
        def _generate(self, messages, **kwargs):
            role = active_agent_role()
            queue = self.queues[role]
            if not queue:
                raise AssertionError("Unexpected scripted model turn: " + role)
            message = queue.pop(0).model_copy(update={"usage_metadata": {"input_tokens": 20, "output_tokens": 2, "total_tokens": 22, "input_token_details": {"cache_read": 0, "cache_creation": 0}}})
            return ChatResult(generations=[ChatGeneration(message=message)])
    return Model(queues={"rule-set-preparation": parent, "claim-author": child})


def collect_metrics(out, bridge, seed, trace, started, mode, error=None):
    from middleware.usage_recovery import read_usage_evidence
    from rule_set_preparation.source_graph import PinnedSourceGraph
    state = bridge.call("STATE", {"preparationRunId": seed["preparationRunId"]})
    rows = state["rows"]
    claims, references = {}, {}
    source = PinnedSourceGraph(seed["documentGraph"], [c for d in seed["documents"] for c in d["chunks"]])
    accounted, conflicting = set(), set()
    for row in rows:
        payload = row.get("payload") or {}
        for claim in payload.get("claims", []):
            claims[claim["claimId"]] = {**claim, "sourceLocators": [{"nodeId": nid, "locator": source.locators.get(nid),
                "structuralPath": source.nodes[nid]["structuralPath"]} for nid in claim["sourceNodeIds"]]}
        for ref in payload.get("referenceAccounting", []):
            references[ref["referenceId"]] = ref
        if row["state"] == "BLOCKED_REFERENCE":
            for rid in row.get("referenceIds", []):
                references.setdefault(rid, {"referenceId": rid, "material": False,
                    "unresolved": True, "nonMaterialReason": row.get("reason"), "evidence": "BLOCKED_FRONTIER"})
        if row["state"] in {"REVIEWED_WITH_CLAIMS", "REVIEWED_NO_CLAIMS"}:
            accounted.add(row["sourceNodeId"])
        if payload.get("claims") and row.get("reason"):
            conflicting.add(row["sourceNodeId"])
    reference_only = set(seed["documentGraph"].get("referenceOnlyDocumentIds") or [])
    article_ids = {nid for nid, node in source.nodes.items() if "/article/" in node["structuralPath"] and node["documentId"] not in reference_only}
    # Structural headings are covered by their file's deterministic coverage check, not frontier rows.
    row_ids = {r["sourceNodeId"] for r in rows}
    structural = article_ids - row_ids
    for nid in structural:
        owners = [r for r in rows if source.node_files.get(r["sourceNodeId"]) == source.node_files.get(nid)]
        if owners and all(r["sourceNodeId"] in accounted for r in owners):
            accounted.add(nid)
    usage_path = out / "usage.json.sqlite3"
    usage = usage_metrics(read_usage_evidence(usage_path) if usage_path.exists() else [])
    counts = Counter(r["state"] for r in rows)
    all_refs = [r for r in seed["documentGraph"]["references"] if source.nodes[r["fromNodeId"]]["documentId"] not in reference_only]
    reference_counts = Counter()
    for ref in all_refs:
        entry = references.get(ref["referenceId"])
        status = "MISSING" if not entry else "BOUND" if entry.get("material") else "UNRESOLVED" if (
            entry.get("unresolved") or ref["resolutionState"] in {"UNRESOLVED", "AMBIGUOUS"}) else "NON_MATERIAL"
        reference_counts[ref["resolutionState"] + ":" + status] += 1
    calls = sum(trace.tools.values())
    metrics = {**usage, "mode": mode, "runId": seed["preparationRunId"], "minutes": (time.monotonic() - started) / 60,
        "claimPhase": state["run"]["claimPhase"], "executionState": state["run"]["executionState"],
        "frontier": dict(counts), "frontierComplete": bool(rows) and all(r["sourceNodeId"] in accounted for r in rows),
        "claimTypes": dict(Counter(c["claimType"] for c in claims.values())), "toolCalls": dict(trace.tools),
        "toolRejections": dict(trace.rejections), "rejectedToolCalls": trace.rejected_calls,
        "toolRejectRatio": trace.rejected_calls / calls if calls else 1.0,
        "referenceAccounting": dict(reference_counts), "referenceAccountingComplete": all(
            r["referenceId"] in references and (references[r["referenceId"]].get("material") or references[r["referenceId"]].get("nonMaterialReason", "").strip()) for r in all_refs),
        "unaccountedLocators": sorted(source.locators[nid] for nid in article_ids - accounted),
        "conflictingLocators": sorted(conflicting), "ruleSets": state["ruleSets"], "errorType": error,
        "materialization": {"nodes": len(source.nodes), "references": len(all_refs), "articles": sum(n["nodeType"] == "ARTICLE" for n in source.nodes.values())}}
    return metrics, list(claims.values()), list(references.values())


def evaluate(out, env, seed_input, self_test):
    """Runs in an owned process group; the parent can stop every local child at deadline."""
    os.setsid()
    from unittest.mock import patch
    from contextlib import nullcontext
    from vertical.live_preparation import LiveUsage
    from middleware.usage_metering import activate_agent_run_state
    from middleware.failure_policy import AgentRunBudgetExceeded, PaidAdmissionError
    from rule_set_preparation.agent import create_rule_set_preparation_agent
    from rule_set_preparation.runner import PreparationStreamTrace, _TASK
    from rule_set_preparation.source_graph import PinnedSourceGraph
    from rule_set_preparation.tools import RuleSetPreparationContext
    from rule_set_preparation.claim_inventory import ClaimInventory
    from rule_set_preparation.claim_files import rebuild_claim_files
    from rule_set_preparation.legal_source_files import materialize_legal_source
    from orchestration.graph_execution import agent_graph_config
    os.environ.update({k: str(v) for k, v in limits().items()})
    bridge, trace, started = Bridge(env), Trace(out / "trace.jsonl"), time.monotonic()
    seed = None
    try:
        articles = seed_input.pop("articles", None)
        seed = bridge.call("SEED", seed_input)
        (out / "seed.json").write_text(json.dumps(seed, ensure_ascii=False))
        source = PinnedSourceGraph(seed["documentGraph"], [c for d in seed["documents"] for c in d["chunks"]])
        root = out / "workspace"
        materialize_legal_source(seed, root)
        context = RuleSetPreparationContext(seed["preparationRunId"], EvaluationApi(bridge), source_root=root,
            source_graph=source, discovery_only=True, pinned_source_version_id=seed["legalSourceVersionId"])
        context.inventory = ClaimInventory(context)
        rebuild_claim_files(context)
        if self_test:
            model = scripted_model(context)
            usage = LiveUsage(context.run_id, str(out / "usage.json"))
            identity_scope = ExitStack()
            identity_scope.enter_context(patch("middleware.usage_metering.assert_model_identity", return_value=None))
            identity_scope.enter_context(patch("middleware.provider_fallback.ProviderFallbackMiddleware._routes", return_value=("offline", ())))
        else:
            usage, model = quota_usage(context.run_id, out)
            identity_scope = nullcontext()
        error = None
        try:
            with identity_scope, activate_agent_run_state(usage):
                # Live: let the factory resolve each role's route from model_routes.yaml, exactly as production does.
                agent = create_rule_set_preparation_agent(context=context, legal_source_root=root, model=model if self_test else None)
                agent.invoke({"messages": [{"role": "user", "content": _TASK}]},
                    config=agent_graph_config({"callbacks": [trace, PreparationStreamTrace()]}))
        except (AgentRunBudgetExceeded, PaidAdmissionError) as exc:
            paused = bridge.call("PAUSE", {"preparationRunId": context.run_id})
            if paused["executionState"] != "PAUSED":
                raise RuntimeError("API did not establish PAUSED") from exc
            trace.event("PAUSE", errorType=type(exc).__name__, code=getattr(exc, "reason", "AGENT_BUDGET_REACHED"))
        except Exception as exc:
            error = type(exc).__name__
            import traceback
            frames = traceback.extract_tb(exc.__traceback__)
            trace.event("RUNTIME_ERROR", errorType=error, message=str(exc)[:400],
                frames=[{"file": Path(f.filename).name, "line": f.lineno, "function": f.name} for f in frames[-5:]])
            if self_test:
                traceback.print_exc()
        metrics, claims, references = collect_metrics(out, bridge, seed, trace, started,
            "OFFLINE_SELF_TEST" if self_test else "LIVE", error)
        golden = json.loads(GOLDEN.read_text())
        if articles:
            golden["anchors"] = [a for a in golden["anchors"] if a["path"].split("/")[1] in set(articles)]
            metrics["slice"] = {"articles": articles, "anchors": len(golden["anchors"])}
        if self_test:
            golden = {"document": "synthetic-fbd", "gates": golden["gates"], "anchors": [
                {"path": "article/1", "needs": ["SCOPE"]}, {"path": "article/2", "needs": ["DEFINITION"]}, {"path": "article/3", "needs": ["DUTY"]}]}
            metrics["liveApprovalRefusal"] = False
            try:
                require_live_approval({})
            except RuntimeError:
                metrics["liveApprovalRefusal"] = True
        write_report(out, metrics, golden, seed["documentGraph"], claims, references)
    finally:
        bridge.close()


WATCHDOG_TOKENS = min(10_000_000, int(os.environ.get("LCSP_FBD_WATCHDOG_TOKENS", 10_000_000)))


def over_hard_limits(out):
    """Provider spend is bounded even if a quota hook misbehaves: stop everything past 8M tokens or 1.15x the call cap."""
    from middleware.usage_recovery import read_usage_evidence
    path = out / "usage.json.sqlite3"
    if not path.exists():
        return False
    try:
        metrics = usage_metrics(read_usage_evidence(path))
    except Exception:
        return False
    return metrics["tokens"] > WATCHDOG_TOKENS or metrics["modelCalls"] > HARD_CALLS * 1.15


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--articles", help="comma-separated article numbers of Luật 134 to evaluate alone, e.g. 14,15")
    args = parser.parse_args(argv)
    if not args.self_test:
        require_live_approval()
        from vertical.live_preparation import _load_llm_env
        _load_llm_env()
        os.environ["LLM_PROVIDER_TIMEOUT_SECONDS"] = "600"
        from model_policy import resolve_agent_model
        for role in ("rule-set-preparation", "claim-author"):
            model = resolve_agent_model(role)
            if "Scripted" in type(model).__name__ or "Fake" in type(model).__name__:
                raise RuntimeError("Real provider route required")
    limits()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    if any(out.iterdir()):
        raise RuntimeError("Output directory must be empty; no automatic replay")
    seed_input = synthetic_slice() if args.self_test else export_corpus([a.strip() for a in args.articles.split(",")] if args.articles else None)
    started = time.monotonic()
    with disposable_database() as env:
        worker = multiprocessing.get_context("fork").Process(target=evaluate, args=(out, env, seed_input, args.self_test))
        worker.start()
        try:
            while worker.is_alive() and time.monotonic() - started < HARD_SECONDS:
                worker.join(10)
                if not args.self_test and over_hard_limits(out):
                    (out / "deadline.json").write_text(json.dumps({"result": "FAIL", "reason": "WATCHDOG_TOKENS_OR_CALLS"}))
                    break
            if worker.is_alive():
                os.killpg(worker.pid, signal.SIGTERM)
                worker.join(10)
                if worker.is_alive():
                    os.killpg(worker.pid, signal.SIGKILL)
                    worker.join(10)
                (out / "deadline.json").write_text(json.dumps({"result": "FAIL", "reason": "WALL_CLOCK_CAP", "minutes": HARD_SECONDS / 60}))
                raise RuntimeError(f"Evaluation exceeded the {HARD_SECONDS // 60} minute wall-clock cap; provider work stopped")
            if worker.exitcode:
                raise RuntimeError(f"Evaluation worker exited {worker.exitcode}; inspect trace.jsonl")
        finally:
            if worker.is_alive():
                os.killpg(worker.pid, signal.SIGKILL)
                worker.join(10)
    metrics = json.loads((out / "metrics.json").read_text())
    print(json.dumps({k: metrics[k] for k in ("result", "mode", "modelCalls", "tokens", "claimPhase", "frontier", "gates")}, indent=2))
    print(f"Evidence: {out}")
    return 0 if metrics["result"] == "PASS" else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
