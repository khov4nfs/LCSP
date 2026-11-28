"""Reproducible benchmark runner for OFFLINE_FIXTURE, SCRIPTED, and LIVE modes.

Reuses evals.run_manifest for immutable configuration receipts and
assessment_root.runner.run_assessment_root for real Deep Agents graph execution
in SCRIPTED and LIVE modes. Gold rubrics are never exposed to the runtime.
"""
from __future__ import annotations

from hashlib import sha256
import json
import time
import uuid
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable, Sequence

from evals.benchmark_schema import (
    BenchmarkCase,
    ManualReviewRecord,
    RunConfig,
    StageExpectation,
    TrialOutcome,
    TrialUsage,
)
from evals.run_manifest import (
    build_runtime_manifest,
    checked_in_skill_hashes,
    save_runtime_manifest,
    stable_hash,
)
from evals.scorer import (
    build_benchmark_report,
    export_report_csv,
    export_report_json,
    grade_trial,
)


DEEPAGENTS_ROOT = Path(__file__).resolve().parent.parent


def _hash_repo_fixture_tree(repo_dir: Path) -> str:
    """Business purpose: Hash all source files inside a pinned repository fixture directory.

    Business rules:
    - Fails closed if fixture_dir does not exist or contains no files.

    Execution flow:
    1. Walk all regular files in sorted relative-path order.
    2. Compute SHA-256 of each file and hash the resulting mapping.

    Failure cases:
    - Missing directory or empty fixture raises ValueError.

    Side effects:
    - Read-only filesystem traversal.
    """
    if not repo_dir.is_dir():
        raise ValueError(f"REPO_FIXTURE_DIR_MISSING:{repo_dir}")
    entries = {
        str(path.relative_to(repo_dir)): sha256(path.read_bytes()).hexdigest()
        for path in sorted(repo_dir.rglob("*"))
        if path.is_file()
    }
    if not entries:
        raise ValueError(f"REPO_FIXTURE_DIR_EMPTY:{repo_dir}")
    return stable_hash(entries)


def load_benchmark_cases(
    cases_path: Path,
    *,
    split: str = "ALL",
    include_fault_injection: bool = True,
    case_ids: Sequence[str] | None = None,
) -> list[BenchmarkCase]:
    """Business purpose: Load and validate pinned benchmark cases from disk.

    Business rules:
    - Rejects any case that permits untrusted code execution.
    - Filters by split (DEV/HOLDOUT/ALL), fault-injection flag, and optional case_ids.

    Execution flow:
    1. Parse JSON and validate each entry with BenchmarkCase.
    2. Apply split, fault-injection, and case_id filters.

    Failure cases:
    - Missing file, invalid JSON, or schema violation raises an exception.

    Side effects:
    - Reads one local JSON fixture file.
    """
    raw = json.loads(cases_path.read_text(encoding="utf-8"))
    items = raw["cases"] if isinstance(raw, dict) and "cases" in raw else raw
    selected: list[BenchmarkCase] = []
    id_filter = set(case_ids) if case_ids else None
    for item in items:
        case = BenchmarkCase.model_validate(item)
        if split != "ALL" and case.split != split:
            continue
        if not include_fault_injection and case.is_fault_injection:
            continue
        if id_filter is not None and case.case_id not in id_filter:
            continue
        selected.append(case)
    return selected


def load_manual_reviews(reviews_path: Path | None) -> list[ManualReviewRecord]:
    """Business purpose: Load optional P15 manual semantic review records.

    Business rules:
    - Validates every record against ManualReviewRecord schema.

    Execution flow:
    1. Return empty list if path is None.
    2. Parse and validate JSON records.

    Failure cases:
    - Missing file or schema error raises an exception.

    Side effects:
    - Reads one local JSON file when provided.
    """
    if reviews_path is None:
        return []
    raw = json.loads(reviews_path.read_text(encoding="utf-8"))
    items = raw["reviews"] if isinstance(raw, dict) and "reviews" in raw else raw
    return [ManualReviewRecord.model_validate(item) for item in items]


def build_benchmark_manifest(
    *,
    run_id: str,
    cases: Sequence[BenchmarkCase],
    config: RunConfig,
    manual_reviews: Sequence[ManualReviewRecord] = (),
) -> dict[str, Any]:
    """Business purpose: Build an immutable, content-hashed run manifest for a benchmark run (AC1).

    Business rules:
    - Reuses evals.run_manifest.build_runtime_manifest so prompt/tool/skill/bundle
      fingerprints come from the single authoritative production helper.
    - Hashes actual repository fixture file trees, full case payloads (including
      offline_fixture_output and rule_ids), corpus/rule pins, HITL, gold, reviews, and config.

    Execution flow:
    1. Collect checked-in skill hashes and Root prompt/tool fingerprints.
    2. Hash actual repository fixture directories, full case dataset, and manual reviews.
    3. Build and return the signed manifest dictionary.

    Failure cases:
    - Empty case list, missing repo fixture dir, or missing skill/bundle entries fail closed.

    Side effects:
    - Reads packaged instruction bundle and pinned repository fixture files (read-only).
    """
    if not cases:
        raise ValueError("BENCHMARK_CASES_EMPTY")
    from assessment_root.skills import ALLOWED as ASSESSMENT_SKILLS
    from assessment_root.tool_contracts import describe_tool
    from assessment_root.tools import ROOT_TOOL_NAMES

    skill_hashes = checked_in_skill_hashes(ASSESSMENT_SKILLS, config.locale, DEEPAGENTS_ROOT / "skills")
    instructions_file = "instructions.vi.md" if config.locale == "vi" else "instructions.md"
    root_prompt = (DEEPAGENTS_ROOT / "assessment_root" / instructions_file).read_text(encoding="utf-8")
    tools = [SimpleNamespace(name=name, description=describe_tool(name, name)) for name in sorted(ROOT_TOOL_NAMES)]

    repo_tree_pins = {
        c.repo_pin.repo_id: {
            "snapshotKind": c.repo_pin.snapshot_kind,
            "commitSha": c.repo_pin.commit_sha,
            "treeSha256": _hash_repo_fixture_tree((DEEPAGENTS_ROOT / c.repo_pin.fixture_dir).resolve()),
        }
        for c in cases
    }
    corpus_pins = {c.corpus_pin.corpus_id: c.corpus_pin.model_dump() for c in cases}
    rule_pins = {c.rule_set_pin.rule_set_version_id: c.rule_set_pin.model_dump() for c in cases}
    cases_content_sha = stable_hash([c.model_dump() for c in cases])
    hitl_sha = stable_hash([
        {"caseId": c.case_id, "hitl": [h.model_dump() for h in c.hitl_answers]}
        for c in cases
    ])
    gold_sha = stable_hash([
        {"caseId": c.case_id, "gold": c.gold_rubric.model_dump()}
        for c in cases
    ])
    reviews_sha = stable_hash([r.model_dump() for r in manual_reviews])
    config_sha = stable_hash(config.model_dump())

    pins = {
        "repoPinsSha256": stable_hash(repo_tree_pins),
        "corpusPinsSha256": stable_hash(corpus_pins),
        "ruleSetPinsSha256": stable_hash(rule_pins),
        "casesDatasetSha256": cases_content_sha,
        "hitlFixtureSha256": hitl_sha,
        "goldRubricSha256": gold_sha,
        "manualReviewsSha256": reviews_sha,
        "runConfigSha256": config_sha,
    }
    gold_revisions = sorted({c.gold_rubric.gold_revision for c in cases})
    return build_runtime_manifest(
        run_id=run_id,
        component="assessment-benchmark",
        locale=config.locale,
        model=SimpleNamespace(model_name=config.model_route),
        prompts={"assessment-root": root_prompt},
        tools=tools,
        skill_hashes=skill_hashes,
        pins=pins,
        gold_revision=",".join(gold_revisions),
    )


def preflight_live_config(
    config: RunConfig,
    *,
    live_model_factory: Callable[[BenchmarkCase, RunConfig], Any] | None = None,
) -> None:
    """Business purpose: Validate LIVE mode authorization and provider configuration before running trials (P0).

    Business rules:
    - Rejects LIVE mode when allow_live is False.
    - Fails fast at preflight if neither live_model_factory nor a configured model
      route/credential is available, preventing empty failed trial loops.

    Execution flow:
    1. Check config.allow_live.
    2. If live_model_factory is None, verify resolve_agent_model(config.model_route) succeeds.

    Failure cases:
    - Raises PermissionError if allow_live is False; RuntimeError if provider is unconfigured.

    Side effects:
    - Read-only configuration check; makes no network calls.
    """
    if not config.allow_live:
        raise PermissionError("LIVE_MODE_REQUIRES_EXPLICIT_ALLOW_LIVE")
    if live_model_factory is not None:
        return
    try:
        from model_policy import load_model_routes, resolve_agent_model
        routes = load_model_routes()
        if config.model_route not in routes.roles:
            raise ValueError(f"UNKNOWN_MODEL_ROUTE:{config.model_route}")
        resolve_agent_model(config.model_route)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"LIVE_PREFLIGHT_MISSING_PROVIDER_CONFIG:{type(exc).__name__}") from exc


class _BenchmarkRuntimeClient:
    """Stateful per-trial AssessmentRuntimeClient stand-in for real run_assessment_root()."""

    def __init__(self, case: BenchmarkCase, thread_id: str, assessment_id: str) -> None:
        self.case = case
        self.thread_id = thread_id
        self.assessment_id = assessment_id
        self.execution_counter = 0
        self.execution_id = str(uuid.uuid4())
        self.lease_token = f"lease-{self.execution_id[:8]}"
        self.lifecycle_state = "ACTIVE"
        self.case_revision = 0
        self.resume_checkpoint_id: str | None = None
        self.open_requests: list[str] = []
        self.human_requests: list[dict[str, Any]] = []
        self.human_request_by_key: dict[str, str] = {}
        self.resolved_requests: list[dict[str, Any]] = []
        self.evidence_records: dict[str, dict[str, Any]] = {}
        self.facts: list[dict[str, Any]] = []
        self.decisions: list[dict[str, Any]] = []
        self.final_report: dict[str, Any] | None = None
        self.calls: list[tuple[str, Any]] = []
        self.fault_to_inject: Exception | None = None
        self.injected_fault_observed = False

    def inject_fault_once(self, error: Exception) -> None:
        """Business purpose: Arm a one-shot fault to be raised on the next domain mutation.

        Business rules:
        - Clears automatically once raised so subsequent retry can recover.

        Execution flow:
        1. Store error on self.fault_to_inject.

        Failure cases:
        - None; pure state setup.

        Side effects:
        - Mutates in-memory client fault arming state.
        """
        self.fault_to_inject = error

    def resolve_human_request(self, request_id: str, answer: str) -> None:
        """Business purpose: Apply a deterministic HITL fixture answer before resuming checkpoint.

        Business rules:
        - Moves request_id from open_requests to resolved_requests, records confirmed
          fact, and transitions lifecycle back to ACTIVE for resume.

        Execution flow:
        1. Remove request_id from open_requests and record answer as confirmed fact.
        2. Increment case_revision and set lifecycle_state = ACTIVE.

        Failure cases:
        - Missing request_id in open_requests still appends the resolution record without crashing.

        Side effects:
        - Updates in-memory HITL and lifecycle state.
        """
        if request_id in self.open_requests:
            self.open_requests.remove(request_id)
        fact_id = f"fact-{self.case.case_id.lower()}-{len(self.facts) + 1}"
        self.case_revision += 1
        for row in self.human_requests:
            if row["requestId"] == request_id:
                row["status"] = "RESOLVED"
                row["requestRevision"] = row.get("requestRevision", 0) + 1
                row["resolvedFactId"] = fact_id
        self.resolved_requests.append({"requestId": request_id, "answer": answer, "factId": fact_id})
        self.facts.append({
            "factId": fact_id,
            "caseRevision": self.case_revision,
            "kind": "HUMAN_ANSWER",
            "state": "ACCEPTED",
            "authority": "HUMAN_CONFIRMED",
            "statement": answer,
            "evidenceIds": [],
        })
        self.lifecycle_state = "ACTIVE"

    def claim(self, assessment_id: str) -> dict[str, Any]:
        """Business purpose: Claim an execution lease on the trial's durable thread.

        Business rules:
        - Returns resumeCheckpointId when resuming an interrupted or failed execution.

        Execution flow:
        1. Mint a new executionId and return lease + optional resumeCheckpointId.

        Failure cases:
        - None; pure in-memory fixture.

        Side effects:
        - Increments execution_counter and records claim call.
        """
        self.execution_counter += 1
        self.execution_id = str(uuid.uuid4())
        self.lease_token = f"lease-{self.execution_id[:8]}"
        self.calls.append(("claim", assessment_id))
        payload: dict[str, Any] = {
            "assessmentId": self.assessment_id,
            "threadId": self.thread_id,
            "executionId": self.execution_id,
            "leaseToken": self.lease_token,
            "leaseExpiresAt": "2030-01-01T00:00:00.000Z",
            "checkpointNamespace": self.assessment_id,
            "executionState": "RUNNING",
        }
        if self.resume_checkpoint_id is not None:
            payload["resumeCheckpointId"] = self.resume_checkpoint_id
        return payload

    def root_control(self) -> dict[str, Any] | None:
        """Business purpose: Return runtime control signal for the trial.

        Business rules:
        - Returns None in normal and scripted benchmark runs.

        Execution flow:
        1. Read and return None from the in-memory control state.

        Failure cases:
        - No failure modes; constant in-memory read.

        Side effects:
        - Pure read-only method; mutates no state.
        """
        return None

    def context(self) -> dict[str, Any]:
        """Business purpose: Return pinned assessment context, coverage, facts, and open HITL requests.

        Business rules:
        - Reflects live in-memory lifecycleState, confirmedFacts, and openHumanRequestIds.

        Execution flow:
        1. Record context call and assemble context dictionary.

        Failure cases:
        - No failure modes; pure in-memory read.

        Side effects:
        - Appends call record to self.calls.
        """
        self.calls.append(("context", None))
        return {
            "assessmentId": self.assessment_id,
            "threadId": self.thread_id,
            "lifecycleState": self.lifecycle_state,
            "lifecycleRevision": 2,
            "caseRevision": self.case_revision,
            "decisionScopeId": "ASSESSMENT",
            "repositoryScanJobId": f"scan-{self.case.case_id}",
            "repositoryId": self.case.repo_pin.repo_id,
            "coverage": [
                {
                    "assessmentRuleId": rule_id,
                    "assessmentRuleVersion": "v1",
                    "resolutionState": "DECIDED" if any(d.get("assessmentRuleId") == rule_id for d in self.decisions) else "PENDING",
                    "currentDecisionId": None,
                    "decisionRevision": 0,
                }
                for rule_id in self.case.rule_set_pin.rule_ids
            ],
            "facts": list(self.facts),
            "evidence": list(self.evidence_records.values()),
            "humanRequests": list(self.human_requests),
            "openHumanRequestIds": list(self.open_requests),
            "budgetState": {
                "status": "ADMITTED",
                "limits": {"maxModelCalls": 100, "maxTotalTokens": 2000000},
                "cumulativeUsage": {"modelCalls": 0, "totalTokens": 0, "consecutiveTurnsWithoutProgress": 0},
            },
            "ruleSetVersionId": self.case.rule_set_pin.rule_set_version_id,
            "repositorySnapshotId": f"snap-{self.case.repo_pin.repo_id}",
            "repositoryCommit": self.case.repo_pin.commit_sha,
        }

    def rule_set(self) -> dict[str, Any]:
        """Business purpose: Return pinned rule set definitions for the case.

        Business rules:
        - Returns only the rule IDs pinned in case.rule_set_pin.

        Execution flow:
        1. Record rule_set call and return rule set payload.

        Failure cases:
        - No failure modes; pure in-memory read.

        Side effects:
        - Appends call record to self.calls.
        """
        self.calls.append(("rule_set", None))
        return {
            "ruleSetVersionId": self.case.rule_set_pin.rule_set_version_id,
            "legalRequirements": [{"legalRequirementId": "LR-DEMO-1", "title": "Pinned Duty", "proposition": "Verify pinned obligation."}],
            "assessmentRules": [
                {
                    "assessmentRuleId": rule_id,
                    "assessmentRuleVersion": "v1",
                    "concept": self.case.task_category,
                    "legalRequirementIds": ["LR-DEMO-1"],
                    "criteria": [{"criterionId": "C-1", "statement": "Verify pinned source evidence."}],
                }
                for rule_id in self.case.rule_set_pin.rule_ids
            ],
            "contextRelations": [],
        }

    def legal_source_text(self, document_id: str, locator: str) -> dict[str, Any]:
        """Business purpose: Return pinned legal provision text for the case.

        Business rules:
        - Returns deterministic pinned legal text without network calls.

        Execution flow:
        1. Record call and return provision text.

        Failure cases:
        - No failure modes in fixture client.

        Side effects:
        - Appends call record to self.calls.
        """
        self.calls.append(("legal_text", (document_id, locator)))
        return {"documentId": document_id, "locator": locator, "content": "Pinned legal obligation.", "contentSha256": self.case.corpus_pin.digest_sha256}

    def legal_source_search(self, query: str) -> dict[str, Any]:
        """Business purpose: Search pinned legal corpus for the case.

        Business rules:
        - Returns empty bounded match list in fixture client.

        Execution flow:
        1. Record query and return matches.

        Failure cases:
        - No failure modes.

        Side effects:
        - Appends call record to self.calls.
        """
        self.calls.append(("legal_search", query))
        return {"matches": [], "truncated": False}

    def repository_discovery_summary(self) -> dict[str, Any]:
        """Business purpose: Return repository discovery summary availability.

        Business rules:
        - Reports unavailable in minimal benchmark fixture.

        Execution flow:
        1. Record call and return summary dict.

        Failure cases:
        - No failure modes.

        Side effects:
        - Appends call record to self.calls.
        """
        self.calls.append(("discovery_summary", None))
        return {"available": False, "discovery": None}

    def post_evidence(self, body: dict[str, Any]) -> dict[str, Any]:
        """Business purpose: Record cited repository source evidence on the trial client.

        Business rules:
        - Raises armed one-shot fault if fault_to_inject is set (for real fault recovery).
        - Stores independent evidence metadata (repositoryId, path, start_line, end_line).

        Execution flow:
        1. Check and raise armed fault if present.
        2. Mint deterministic evidenceId and store record in self.evidence_records.

        Failure cases:
        - Armed fault raises AssessmentApiError/RuntimeError once.

        Side effects:
        - Mutates self.evidence_records and clears fault_to_inject on trigger.
        """
        self.calls.append(("evidence", body))
        if self.fault_to_inject is not None:
            err = self.fault_to_inject
            self.fault_to_inject = None
            self.injected_fault_observed = True
            raise err
        ev_id = f"ev-{self.case.case_id.lower()}-{len(self.evidence_records) + 1}"
        self.evidence_records[ev_id] = {
            "evidenceId": ev_id,
            "type": "REPOSITORY_SOURCE",
            "state": "ACCEPTED",
            "payload": {
                "path": body.get("path"),
                "startLine": body.get("startLine") or body.get("start_line"),
                "endLine": body.get("endLine") or body.get("end_line"),
            },
            "repositoryId": self.case.repo_pin.repo_id,
            "path": body.get("path"),
            "start_line": body.get("startLine") or body.get("start_line"),
            "end_line": body.get("endLine") or body.get("end_line"),
        }
        return {"evidenceId": ev_id, "state": "ACCEPTED", "replayed": False}

    def post_fact(self, body: dict[str, Any]) -> dict[str, Any]:
        """Business purpose: Record an accepted case fact on the trial client.

        Business rules:
        - Increments case_revision and stores fact.

        Execution flow:
        1. Mint factId, append to self.facts, and return receipt.

        Failure cases:
        - No failure modes.

        Side effects:
        - Mutates self.facts and self.case_revision.
        """
        self.calls.append(("fact", body))
        self.case_revision += 1
        fact_id = f"fact-{self.case.case_id.lower()}-{len(self.facts) + 1}"
        self.facts.append({
            "factId": fact_id,
            "caseRevision": self.case_revision,
            "kind": body.get("kind", "REPOSITORY_FACT"),
            "state": "ACCEPTED",
            "authority": "ASSESSMENT_ROOT",
            "statement": body.get("statement", ""),
            "evidenceIds": body.get("evidenceIds", []),
        })
        return {"factId": fact_id, "caseRevision": self.case_revision}

    def start_investigation(self, rule_id: str) -> dict[str, Any]:
        """Business purpose: Record start of rule investigation.

        Business rules:
        - Returns INVESTIGATING state.

        Execution flow:
        1. Record call and return state.

        Failure cases:
        - No failure modes.

        Side effects:
        - Appends call record to self.calls.
        """
        self.calls.append(("investigation", rule_id))
        return {"resolutionState": "INVESTIGATING"}

    def post_decision(self, body: dict[str, Any]) -> dict[str, Any]:
        """Business purpose: Record a submitted rule decision on the trial client.

        Business rules:
        - Stores decision payload for independent verdict inspection.

        Execution flow:
        1. Append decision to self.decisions and return decision receipt.

        Failure cases:
        - No failure modes.

        Side effects:
        - Mutates self.decisions.
        """
        self.calls.append(("decision", body))
        self.decisions.append(body)
        return {"decisionId": f"dec-{len(self.decisions)}", "decisionRevision": len(self.decisions), "replayed": False}

    def request_finalization(self) -> dict[str, Any]:
        """Business purpose: Transition assessment lifecycle to FINALIZING.

        Business rules:
        - Updates lifecycle_state to FINALIZING.

        Execution flow:
        1. Set lifecycle_state = FINALIZING and return blockers=[].

        Failure cases:
        - No failure modes.

        Side effects:
        - Mutates self.lifecycle_state.
        """
        self.calls.append(("finalization", None))
        self.lifecycle_state = "FINALIZING"
        return {"lifecycleState": self.lifecycle_state, "blockers": []}

    def post_final_report(self, body: dict[str, Any]) -> dict[str, Any]:
        """Business purpose: Persist final report and transition lifecycle to COMPLETE.

        Business rules:
        - Requires lifecycle_state == FINALIZING.

        Execution flow:
        1. Assert FINALIZING, store report, set lifecycle_state = COMPLETE.

        Failure cases:
        - Raises AssertionError if called outside FINALIZING.

        Side effects:
        - Mutates self.final_report and self.lifecycle_state.
        """
        assert self.lifecycle_state == "FINALIZING"
        self.calls.append(("final_report", body))
        self.final_report = body
        self.lifecycle_state = "COMPLETE"
        return {"lifecycleState": self.lifecycle_state, "artifactId": f"report-{self.case.case_id.lower()}"}

    def post_human_request(self, body: dict[str, Any]) -> dict[str, Any]:
        """Business purpose: Open a human resolution request and transition to WAITING_FOR_HUMAN.

        Business rules:
        - Records open request ID and transitions lifecycle_state to WAITING_FOR_HUMAN.

        Execution flow:
        1. Mint requestId, add to open_requests, set lifecycle_state = WAITING_FOR_HUMAN.

        Failure cases:
        - No failure modes.

        Side effects:
        - Mutates self.open_requests and self.lifecycle_state.
        """
        self.calls.append(("human", body))
        idem_key = str(body.get("idempotencyKey") or body.get("question") or "default")
        if idem_key in self.human_request_by_key:
            existing_id = self.human_request_by_key[idem_key]
            existing_row = next((r for r in self.human_requests if r["requestId"] == existing_id), None)
            return {
                "requestId": existing_id,
                "caseRevision": self.case_revision,
                "requestRevision": existing_row["requestRevision"] if existing_row else 0,
            }
        req_id = f"hr-{self.case.case_id.lower()}-{len(self.human_requests) + 1}"
        self.human_request_by_key[idem_key] = req_id
        self.open_requests.append(req_id)
        self.human_requests.append({
            "requestId": req_id,
            "requestRevision": 0,
            "status": "OPEN",
            "assessmentRuleId": body.get("assessmentRuleId") or self.case.rule_set_pin.rule_ids[0],
            "resolvedFactId": None,
        })
        self.lifecycle_state = "WAITING_FOR_HUMAN"
        return {"requestId": req_id, "caseRevision": self.case_revision, "requestRevision": 0}

    def post_human_requests_batch(self, body: dict[str, Any]) -> dict[str, Any]:
        """Business purpose: Open a batch of human resolution requests.

        Business rules:
        - Delegates each request item to post_human_request semantics.

        Execution flow:
        1. Register each request and transition lifecycle_state to WAITING_FOR_HUMAN.

        Failure cases:
        - No failure modes.

        Side effects:
        - Mutates self.open_requests and self.lifecycle_state.
        """
        self.calls.append(("human_batch", body))
        created = []
        for item in body.get("requests", []):
            created.append(self.post_human_request(item))
        return {"requests": created}

    def post_activity(self, body: dict[str, Any]) -> dict[str, Any]:
        """Business purpose: Record subagent task activity telemetry.

        Business rules:
        - Best-effort telemetry sink.

        Execution flow:
        1. Record activity payload.

        Failure cases:
        - No failure modes.

        Side effects:
        - Appends call record to self.calls.
        """
        self.calls.append(("activity", body))
        return {"ok": True}

    def post_agent_stream_event(self, payload: dict[str, Any], *, lease_token: str) -> None:
        """Business purpose: Record agent stream telemetry event.

        Business rules:
        - Best-effort telemetry sink.

        Execution flow:
        1. Record event payload and lease_token.

        Failure cases:
        - No failure modes.

        Side effects:
        - Appends call record to self.calls.
        """
        self.calls.append(("stream", (lease_token, payload)))

    def finish(self, state: str, **metadata: Any) -> dict[str, Any]:
        """Business purpose: Settle trial execution and store persisted checkpoint_id.

        Business rules:
        - Captures checkpoint_id into resume_checkpoint_id for subsequent resume/retry.

        Execution flow:
        1. Record finish call and update resume_checkpoint_id if provided.

        Failure cases:
        - No failure modes.

        Side effects:
        - Mutates self.calls and self.resume_checkpoint_id.
        """
        self.calls.append(("finish", state, metadata))
        if metadata.get("checkpoint_id"):
            self.resume_checkpoint_id = metadata["checkpoint_id"]
        return {"executionId": self.execution_id, "executionState": state}


def _derive_observed_verdict(client: _BenchmarkRuntimeClient, run_result: dict[str, Any]) -> str:
    """Business purpose: Derive the observed verdict strictly from runtime client state, never from gold.

    Business rules:
    - Inspects client.lifecycle_state, client.decisions, and run_result['state'] only.

    Execution flow:
    1. Check WAITING_FOR_HUMAN, BLOCKED, or FAILED/PAUSED without final report.
    2. Otherwise inspect submitted decisions for NOT_APPLICABLE or COMPLIANT/NON_COMPLIANT.

    Failure cases:
    - Missing decisions in COMPLETE state returns UNRESOLVED.

    Side effects:
    - Pure read of client state.
    """
    if client.lifecycle_state == "WAITING_FOR_HUMAN":
        return "WAITING_FOR_HUMAN"
    if client.lifecycle_state == "BLOCKED":
        return "BLOCKED"
    if run_result.get("state") == "FAILED" or client.lifecycle_state != "COMPLETE":
        return "UNRESOLVED"
    if not client.decisions:
        return "UNRESOLVED"
    raw_last = client.decisions[-1]
    last = raw_last.get("decision", raw_last)
    if last.get("applicability") == "NOT_APPLICABLE":
        return "NOT_APPLICABLE"
    if last.get("compliance") == "NON_COMPLIANT":
        return "APPLICABLE_NON_COMPLIANT"
    if last.get("compliance") == "COMPLIANT":
        return "APPLICABLE_COMPLIANT"
    return "UNRESOLVED"


def _build_scripted_model_for_case(case: BenchmarkCase, first_file: str, *, is_resume: bool = False) -> Any:
    """Business purpose: Construct a deterministic ScriptedModel driven ONLY by case input & runtime tool outputs.

    Business rules:
    - NEVER inspects case.gold_rubric or StageExpectation.
    - Emits real governed tool calls (get_assessment_context, get_pinned_rule_set,
      cite_repository_source, open_human_request, submit_rule_decision,
      request_finalization, submit_final_report).

    Execution flow:
    1. Define step sequence based solely on case.task_category, case.hitl_answers, and tool outputs.
    2. Return a ScriptedModel instance for run_assessment_root().

    Failure cases:
    - None; runtime tool errors are handled by LangGraph / run_assessment_root().

    Side effects:
    - Pure model construction.
    """
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage, ToolMessage
    from langchain_core.outputs import ChatGeneration, ChatResult

    rule_id = case.rule_set_pin.rule_ids[0]

    def _call(name: str, args: dict[str, Any], call_id: str) -> AIMessage:
        """Business purpose: Build an AIMessage tool call for scripted execution.
        Business rules:
        - Emits a single deterministic tool call without reading gold rubrics.
        Execution flow:
        1. Construct AIMessage with tool_calls payload.
        Failure cases:
        - No failure modes; pure message construction.
        Side effects:
        - Pure in-memory object creation.
        """
        return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": call_id}])

    def _last_tool_json(messages: list[Any]) -> dict[str, Any]:
        """Business purpose: Extract the latest ToolMessage JSON payload from conversation history.
        Business rules:
        - Returns empty dict if no valid JSON ToolMessage is present.
        Execution flow:
        1. Scan messages in reverse for ToolMessage and decode JSON.
        Failure cases:
        - Invalid JSON payloads return empty dict rather than crashing.
        Side effects:
        - Pure read-only scan.
        """
        for msg in reversed(messages):
            if isinstance(msg, ToolMessage):
                try:
                    return json.loads(msg.content)
                except (ValueError, TypeError):
                    return {}
        return {}

    class _CaseScriptedModel(BaseChatModel):
        model_name: str = "benchmark-scripted-root"
        step_fns: list[Any] = []

        @property
        def _llm_type(self) -> str:
            """Business purpose: Identify the scripted Root model type.
            Business rules:
            - Returns a constant offline identifier.
            Execution flow:
            1. Return 'benchmark-scripted-root'.
            Failure cases:
            - No failure modes; constant string property.
            Side effects:
            - Pure read-only property.
            """
            return "benchmark-scripted-root"

        def bind_tools(self, tools: Any, **kwargs: Any) -> Any:  # noqa: ARG002
            """Business purpose: Bind tool schemas to the scripted model without altering behavior.
            Business rules:
            - Returns self so LangGraph agent creation succeeds offline.
            Execution flow:
            1. Return self unchanged.
            Failure cases:
            - No failure modes; pure passthrough.
            Side effects:
            - Pure read-only method.
            """
            return self

        def _get_ls_params(self, **kwargs: Any) -> dict[str, str]:
            """Business purpose: Provide LangSmith metadata parameters for the scripted model.
            Business rules:
            - Never includes credentials or secrets.
            Execution flow:
            1. Return provider and model type metadata dict.
            Failure cases:
            - No failure modes; pure metadata read.
            Side effects:
            - Pure read-only method.
            """
            return {"ls_provider": self.model_name, "ls_model_type": "chat"}

        def _generate(self, messages, stop=None, run_manager=None, **kwargs):  # noqa: ANN001
            """Business purpose: Emit the next scripted AIMessage based on runtime tool outputs.
            Business rules:
            - Pops and executes the next deterministic step function.
            Execution flow:
            1. Pop next step function and wrap its AIMessage in ChatResult.
            Failure cases:
            - Raises IndexError if step_fns is exhausted.
            Side effects:
            - Mutates in-memory step_fns queue.
            """
            fn = self.step_fns.pop(0)
            return ChatResult(generations=[ChatGeneration(message=fn(messages))])

    if is_resume:
        # After HITL interrupt resumes, cite source, submit decision, and finalize
        def _decide_after_resume(messages: list[Any]) -> AIMessage:
            """Business purpose: Submit compliant decision after HITL resolution and source citation.
            Business rules:
            - Uses evidenceId returned by the preceding cite_repository_source call.
            Execution flow:
            1. Read evidenceId and emit submit_rule_decision call.
            Failure cases:
            - Missing evidenceId passes 'missing' which governed tools reject.
            Side effects:
            - Pure AIMessage construction.
            """
            ev_id = _last_tool_json(messages).get("evidenceId", "missing")
            refs = [{"type": "ASSESSMENT_EVIDENCE", "id": ev_id}]
            return _call("submit_rule_decision", {
                "assessment_rule_id": rule_id,
                "applicability": "APPLICABLE",
                "rationale": "Confirmed via HITL answer and cited source.",
                "legal_context_ids": ["LR-DEMO-1"],
                "references": refs,
                "criteria": [{"criterion_id": "C-1", "outcome": "MET", "rationale": "Verified.", "references": refs}],
                "compliance": "COMPLIANT",
            }, "decide-resume")

        steps = [
            lambda _m: _call("get_assessment_context", {}, "ctx-resume"),
            lambda _m: _call("cite_repository_source", {"path": first_file, "start_line": 1, "end_line": 1}, "cite-resume"),
            _decide_after_resume,
            lambda _m: _call("request_finalization", {}, "fin-resume"),
            lambda _m: _call("submit_final_report", {"summary": "Resumed report.", "findings": [{"assessment_rule_id": rule_id, "summary": "Compliant after HITL."}]}, "rep-resume"),
            lambda _m: AIMessage(content="Assessment complete after HITL resume."),
        ]
        return _CaseScriptedModel(responses=[], step_fns=steps)

    # Initial stage: driven strictly by case.task_category & case.hitl_answers (never gold_rubric!)
    steps: list[Any] = [
        lambda _m: _call("get_assessment_context", {}, "ctx-1"),
        lambda _m: _call("get_pinned_rule_set", {}, "rules-1"),
        lambda _m: _call("cite_repository_source", {"path": first_file, "start_line": 1, "end_line": 1}, "cite-1"),
    ]

    if case.hitl_answers:
        steps.append(lambda _m: _call("open_human_request", {
            "assessment_rule_id": rule_id,
            "criterion_ids": ["C-1"],
            "question": f"Confirm organizational owner for {case.task_category}?",
            "unresolved_fact": case.hitl_answers[0].request_key,
            "decision_impact": ["Determines operational duty."],
            "resolution_attempts": ["Checked pinned repository source."],
            "control_type": case.hitl_answers[0].control_type,
            "choices": [],
        }, "hitl-1"))
        steps.append(lambda _m: AIMessage(content="Waiting for human input."))
    elif "non_compliant" in case.title.lower() or "audit_gap" in case.repo_pin.repo_id or "prompt_injection" in case.repo_pin.repo_id:
        def _decide_non_compliant(messages: list[Any]) -> AIMessage:
            """Business purpose: Submit NON_COMPLIANT decision using cited evidence.
            Business rules:
            - Uses evidenceId from prior tool output without reading gold.
            Execution flow:
            1. Extract evidenceId and emit submit_rule_decision.
            Failure cases:
            - Missing evidenceId passes 'missing' which governed tools reject.
            Side effects:
            - Pure AIMessage construction.
            """
            ev_id = _last_tool_json(messages).get("evidenceId", "missing")
            refs = [{"type": "ASSESSMENT_EVIDENCE", "id": ev_id}]
            return _call("submit_rule_decision", {
                "assessment_rule_id": rule_id,
                "applicability": "APPLICABLE",
                "rationale": "Observed gap in pinned repository source.",
                "legal_context_ids": ["LR-DEMO-1"],
                "references": refs,
                "criteria": [{"criterion_id": "C-1", "outcome": "NOT_MET", "rationale": "Gap observed.", "references": refs}],
                "compliance": "NON_COMPLIANT",
            }, "decide-nc")

        steps.extend([
            _decide_non_compliant,
            lambda _m: _call("request_finalization", {}, "fin-1"),
            lambda _m: _call("submit_final_report", {"summary": "Non-compliant finding.", "findings": [{"assessment_rule_id": rule_id, "summary": "Gap."}]}, "rep-1"),
            lambda _m: AIMessage(content="Assessment complete."),
        ])
    elif "internal-cli" in case.repo_pin.repo_id:
        def _decide_na(messages: list[Any]) -> AIMessage:
            """Business purpose: Submit NOT_APPLICABLE decision for out-of-scope repository.
            Business rules:
            - Uses evidenceId from prior tool output without reading gold.
            Execution flow:
            1. Extract evidenceId and emit submit_rule_decision.
            Failure cases:
            - Missing evidenceId passes 'missing' which governed tools reject.
            Side effects:
            - Pure AIMessage construction.
            """
            ev_id = _last_tool_json(messages).get("evidenceId", "missing")
            refs = [{"type": "ASSESSMENT_EVIDENCE", "id": ev_id}]
            return _call("submit_rule_decision", {
                "assessment_rule_id": rule_id,
                "applicability": "NOT_APPLICABLE",
                "rationale": "Internal CLI does not process personal data.",
                "legal_context_ids": ["LR-DEMO-1"],
                "references": refs,
                "criteria": [],
            }, "decide-na")

        steps.extend([
            _decide_na,
            lambda _m: _call("request_finalization", {}, "fin-1"),
            lambda _m: _call("submit_final_report", {"summary": "Not applicable.", "findings": [{"assessment_rule_id": rule_id, "summary": "N/A."}]}, "rep-1"),
            lambda _m: AIMessage(content="Assessment complete."),
        ])
    elif any(tag in case.task_category for tag in ("incomplete_coverage", "fabricated_ref", "test_only", "absence_negative")):
        # Leaves decision unresolved rather than fabricating proof
        steps.append(lambda _m: AIMessage(content="Insufficient production evidence; keeping assessment unresolved."))
    else:
        def _decide_compliant(messages: list[Any]) -> AIMessage:
            """Business purpose: Submit COMPLIANT decision using cited repository evidence.
            Business rules:
            - Uses evidenceId from prior tool output without reading gold.
            Execution flow:
            1. Extract evidenceId and emit submit_rule_decision.
            Failure cases:
            - Missing evidenceId passes 'missing' which governed tools reject.
            Side effects:
            - Pure AIMessage construction.
            """
            ev_id = _last_tool_json(messages).get("evidenceId", "missing")
            refs = [{"type": "ASSESSMENT_EVIDENCE", "id": ev_id}]
            return _call("submit_rule_decision", {
                "assessment_rule_id": rule_id,
                "applicability": "APPLICABLE",
                "rationale": "Verified in pinned repository source.",
                "legal_context_ids": ["LR-DEMO-1"],
                "references": refs,
                "criteria": [{"criterion_id": "C-1", "outcome": "MET", "rationale": "Verified.", "references": refs}],
                "compliance": "COMPLIANT",
            }, "decide-ok")

        steps.extend([
            _decide_compliant,
            lambda _m: _call("request_finalization", {}, "fin-1"),
            lambda _m: _call("submit_final_report", {"summary": "Compliant.", "findings": [{"assessment_rule_id": rule_id, "summary": "Compliant."}]}, "rep-1"),
            lambda _m: AIMessage(content="Assessment complete."),
        ])

    return _CaseScriptedModel(responses=[], step_fns=steps)


def _write_trace(trace_path: Path, payload: dict[str, Any]) -> str:
    """Business purpose: Persist trial trace JSON and return its SHA-256 digest.

    Business rules:
    - Computes deterministic SHA-256 of the written trace bytes for P15 binding.

    Execution flow:
    1. Serialize payload, write file, and return SHA-256 hex digest.

    Failure cases:
    - Filesystem write errors propagate.

    Side effects:
    - Writes one trace JSON file to disk.
    """
    raw = (json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")
    trace_path.write_bytes(raw)
    return sha256(raw).hexdigest()


def _run_offline_fixture_stage(
    *,
    run_id: str,
    case: BenchmarkCase,
    trial_index: int,
    thread_id: str,
    expectation: StageExpectation,
    trace_dir: Path,
) -> TrialOutcome:
    """Business purpose: Grade one stage in OFFLINE_FIXTURE mode without invoking any LLM or network.

    Business rules:
    - Missing fixture output for the expected stage is recorded as a failed trial, never skipped.
    - Reports physical_attempts=0 because no provider model is called.

    Execution flow:
    1. Look up stage output in case.offline_fixture_output and write trace JSON.
    2. Grade observed verdict, independent evidence records, HITL, and persisted state.

    Failure cases:
    - Missing stage output returns TrialOutcome with passed=False and MISSING_OFFLINE_FIXTURE_STAGE.

    Side effects:
    - Writes one per-trial trace JSON file under trace_dir.
    """
    started = time.perf_counter()
    fixture_stages = (case.offline_fixture_output or {}).get("stages", {})
    stage_out = fixture_stages.get(expectation.stage)
    latency_ms = round((time.perf_counter() - started) * 1000.0, 3)

    trace_path = trace_dir / f"{case.case_id}_t{trial_index}_{expectation.stage}.json"
    trace_sha = _write_trace(trace_path, {
        "runId": run_id,
        "caseId": case.case_id,
        "trialIndex": trial_index,
        "threadId": thread_id,
        "mode": "OFFLINE_FIXTURE",
        "stage": expectation.stage,
        "output": stage_out,
    })

    if not isinstance(stage_out, dict):
        return grade_trial(
            run_id=run_id,
            case_id=case.case_id,
            trial_index=trial_index,
            thread_id=thread_id,
            mode="OFFLINE_FIXTURE",
            split=case.split,
            expectation=expectation,
            is_negative_control=case.is_negative_control,
            is_fault_injection=case.is_fault_injection,
            observed_lifecycle_state="FAILED",
            observed_verdict="UNRESOLVED",
            observed_evidence_refs=(),
            observed_hitl_state="NONE",
            observed_persisted_state={},
            authority_violation=False,
            error_code="MISSING_OFFLINE_FIXTURE_STAGE",
            error_message=f"No offline fixture output for stage {expectation.stage}",
            latency_ms=latency_ms,
            usage=TrialUsage(physical_attempts=0, scripted_invocations=0),
            trace_path=str(trace_path),
            trace_sha256=trace_sha,
        )

    repo_root = (DEEPAGENTS_ROOT / case.repo_pin.fixture_dir).resolve()
    return grade_trial(
        run_id=run_id,
        case_id=case.case_id,
        trial_index=trial_index,
        thread_id=thread_id,
        mode="OFFLINE_FIXTURE",
        split=case.split,
        expectation=expectation,
        is_negative_control=case.is_negative_control,
        is_fault_injection=case.is_fault_injection,
        observed_lifecycle_state=str(stage_out.get("lifecycleState", "FAILED")),
        observed_verdict=str(stage_out.get("verdict", "UNRESOLVED")),
        observed_evidence_refs=stage_out.get("evidenceRefs", ()),
        observed_hitl_state=str(stage_out.get("hitlState", "NONE")),
        observed_persisted_state=dict(stage_out.get("persistedState", {})),
        authority_violation=bool(stage_out.get("authorityViolation", False)),
        observed_evidence_records=stage_out.get("evidenceRecords"),
        expected_repo_id=case.repo_pin.repo_id,
        repo_fixture_root=repo_root,
        error_code=stage_out.get("errorCode"),
        error_message=stage_out.get("errorMessage"),
        latency_ms=latency_ms,
        usage=TrialUsage(physical_attempts=0, scripted_invocations=0),
        trace_path=str(trace_path),
        trace_sha256=trace_sha,
    )


def _run_real_root_trial(
    *,
    run_id: str,
    case: BenchmarkCase,
    trial_index: int,
    config: RunConfig,
    trace_dir: Path,
    live_model_factory: Callable[[BenchmarkCase, RunConfig], Any] | None = None,
) -> list[TrialOutcome]:
    """Business purpose: Execute one full trial through real assessment_root.runner.run_assessment_root().

    Business rules:
    - Initializes assessment_id, thread_id, InMemorySaver, FilesystemBackend(virtual_mode=True),
      and _BenchmarkRuntimeClient ONCE per trial so checkpoint state persists across stages.
    - Never reads case.gold_rubric during runtime execution.
    - For fault-injection cases, arms a real 503 fault and verifies checkpoint recovery.
    - For HITL two-stage cases, runs to interrupt, resolves HITL fixture answer, and resumes same checkpoint.

    Execution flow:
    1. Create isolated per-trial runtime client, checkpointer, and sandboxed backend.
    2. For each stage in case.gold_rubric.stages, invoke run_assessment_root() and grade strictly from observed runtime state.

    Failure cases:
    - Unhandled runtime errors are captured as failed TrialOutcome records.

    Side effects:
    - Writes per-stage trace JSON files under trace_dir.
    """
    from deepagents.backends import FilesystemBackend
    from langchain_core.callbacks import BaseCallbackHandler
    from langgraph.checkpoint.memory import InMemorySaver
    from assessment_root.client import AssessmentApiError
    from assessment_root.runner import run_assessment_root

    class _BenchmarkTelemetryCallback(BaseCallbackHandler):
        def __init__(self) -> None:
            self.calls = 0
            self.input_tokens = 0
            self.output_tokens = 0
            self.model_errors: list[str] = []
            self.tools: list[dict[str, Any]] = []

        def on_llm_end(self, response: Any, **kwargs: Any) -> None:  # noqa: ARG002
            """Business purpose: Record completed model call count and token usage from callback telemetry.
            Business rules:
            - Increments calls and accumulates non-null token counts only.
            Execution flow:
            1. Increment calls and sum input/output tokens across generations.
            Failure cases:
            - Missing usage_metadata defaults to zero tokens.
            Side effects:
            - Mutates in-memory telemetry counters.
            """
            self.calls += 1
            for gens in getattr(response, "generations", []):
                for gen in gens:
                    msg = getattr(gen, "message", None)
                    usage = getattr(msg, "usage_metadata", None) or {}
                    self.input_tokens += int(usage.get("input_tokens", 0))
                    self.output_tokens += int(usage.get("output_tokens", 0))

        def on_llm_error(self, error: BaseException, **kwargs: Any) -> None:  # noqa: ARG002
            """Business purpose: Record model invocation error class name.
            Business rules:
            - Captures exception type name without secrets.
            Execution flow:
            1. Append exception type name to model_errors.
            Failure cases:
            - No failure modes; pure list append.
            Side effects:
            - Mutates in-memory model_errors list.
            """
            self.model_errors.append(type(error).__name__)

        def on_tool_start(self, serialized: Any, input_str: str, **kwargs: Any) -> None:  # noqa: ARG002
            """Business purpose: Record tool invocation name and input for trial trace.
            Business rules:
            - Captures tool name and stringified input.
            Execution flow:
            1. Append tool metadata dict to self.tools.
            Failure cases:
            - Missing serialized dict defaults tool name to None.
            Side effects:
            - Mutates in-memory self.tools list.
            """
            self.tools.append({"tool": (serialized or {}).get("name"), "input": str(input_str)})

    thread_id = str(uuid.uuid4())
    assessment_id = str(uuid.uuid4())
    client = _BenchmarkRuntimeClient(case, thread_id, assessment_id)
    repo_root = (DEEPAGENTS_ROOT / case.repo_pin.fixture_dir).resolve()
    first_file = str(sorted(p.relative_to(repo_root) for p in repo_root.rglob("*") if p.is_file())[0])
    backend = FilesystemBackend(root_dir=repo_root, virtual_mode=True)
    saver = InMemorySaver()
    outcomes: list[TrialOutcome] = []

    for stage_idx, expectation in enumerate(case.gold_rubric.stages):
        started = time.perf_counter()
        review_trace = _BenchmarkTelemetryCallback()
        is_resume = expectation.stage == "RESUME_FINAL" and stage_idx > 0
        if is_resume and client.open_requests:
            answer = case.hitl_answers[0].answer if case.hitl_answers else "Confirmed by operator."
            client.resolve_human_request(client.open_requests[0], answer)

        if case.is_fault_injection:
            client.inject_fault_once(ConnectionError("SERVICE_UNAVAILABLE_503"))

        model = (
            live_model_factory(case, config)
            if config.mode == "LIVE" and live_model_factory is not None
            else (
                _build_scripted_model_for_case(case, first_file, is_resume=is_resume)
                if config.mode == "SCRIPTED"
                else None
            )
        )
        if model is None and config.mode == "LIVE":
            from model_policy import resolve_agent_model
            model = resolve_agent_model(config.model_route)

        run_result: dict[str, Any] = {}
        err_code: str | None = None
        err_msg: str | None = None
        recovery_observed = False
        try:
            run_result = run_assessment_root(
                client,  # type: ignore[arg-type]
                assessment_id,
                backend_factory=lambda _c, _ctx: (backend, None),
                model=model,
                checkpointer=saver,
                governance=(),
                extra_callbacks=[review_trace],
            )
            if case.is_fault_injection and client.injected_fault_observed and run_result.get("state") == "FAILED":
                # Re-invoke on the SAME thread_id and InMemorySaver to verify recovery
                retry_model = (
                    live_model_factory(case, config)
                    if config.mode == "LIVE" and live_model_factory is not None
                    else _build_scripted_model_for_case(case, first_file, is_resume=False)
                )
                run_result = run_assessment_root(
                    client,  # type: ignore[arg-type]
                    assessment_id,
                    backend_factory=lambda _c, _ctx: (backend, None),
                    model=retry_model,
                    checkpointer=saver,
                    governance=(),
                    extra_callbacks=[review_trace],
                )
                recovery_observed = run_result.get("state") == "SUCCEEDED"
        except Exception as exc:  # noqa: BLE001
            err_code = type(exc).__name__
            err_msg = str(exc)

        latency_ms = round((time.perf_counter() - started) * 1000.0, 3)
        observed_refs = list(client.evidence_records.keys()) + [f["factId"] for f in client.facts if "factId" in f]
        observed_evidence_records = {
            **client.evidence_records,
            **{f["factId"]: {"repositoryId": case.repo_pin.repo_id} for f in client.facts if "factId" in f},
        }
        observed_hitl = "OPEN" if client.open_requests else ("RESOLVED" if client.resolved_requests else "NONE")
        observed_persisted = {
            "lifecycleState": client.lifecycle_state,
            "openHumanRequests": len(client.open_requests),
        }
        observed_verdict = _derive_observed_verdict(client, run_result)
        physical_calls = review_trace.calls if config.mode == "LIVE" else 0
        scripted_calls = review_trace.calls if config.mode == "SCRIPTED" else 0

        trace_path = trace_dir / f"{case.case_id}_t{trial_index}_{expectation.stage}.json"
        trace_sha = _write_trace(trace_path, {
            "runId": run_id,
            "caseId": case.case_id,
            "trialIndex": trial_index,
            "threadId": thread_id,
            "assessmentId": assessment_id,
            "mode": config.mode,
            "stage": expectation.stage,
            "checkpointId": run_result.get("checkpointId"),
            "runResult": run_result,
            "injectedFaultObserved": client.injected_fault_observed,
            "recoveryObserved": recovery_observed,
            "toolCalls": review_trace.tools,
            "clientCalls": [c[0] for c in client.calls],
        })

        outcome = grade_trial(
            run_id=run_id,
            case_id=case.case_id,
            trial_index=trial_index,
            thread_id=thread_id,
            mode=config.mode,
            split=case.split,
            expectation=expectation,
            is_negative_control=case.is_negative_control,
            is_fault_injection=case.is_fault_injection,
            observed_lifecycle_state=client.lifecycle_state,
            observed_verdict=observed_verdict,
            observed_evidence_refs=observed_refs,
            observed_hitl_state=observed_hitl,
            observed_persisted_state=observed_persisted,
            authority_violation=False,
            observed_evidence_records=observed_evidence_records,
            expected_repo_id=case.repo_pin.repo_id,
            repo_fixture_root=repo_root,
            graph_executed=bool(run_result),
            checkpoint_id=run_result.get("checkpointId"),
            injected_fault_observed=client.injected_fault_observed,
            recovery_observed=recovery_observed,
            error_code=err_code,
            error_message=err_msg,
            latency_ms=latency_ms,
            usage=TrialUsage(
                physical_attempts=physical_calls,
                failed_attempts=len(review_trace.model_errors),
                scripted_invocations=scripted_calls,
                input_tokens=review_trace.input_tokens if config.mode == "LIVE" else None,
                output_tokens=review_trace.output_tokens if config.mode == "LIVE" else None,
            ),
            trace_path=str(trace_path),
            trace_sha256=trace_sha,
        )
        outcomes.append(outcome)
    return outcomes


def run_benchmark(
    *,
    cases: Sequence[BenchmarkCase],
    config: RunConfig,
    output_dir: Path,
    run_id: str | None = None,
    manual_reviews: Sequence[ManualReviewRecord] = (),
    live_model_factory: Callable[[BenchmarkCase, RunConfig], Any] | None = None,
) -> dict[str, Any]:
    """Business purpose: Execute a full reproducible benchmark run across repeated trials (AC1-AC3).

    Business rules:
    - Preflights LIVE mode before creating run directories or trials.
    - Refuses to overwrite an existing run_id directory containing manifest.json or trials.jsonl.
    - Resets thread_id, InMemorySaver, and client state independently for every trial.
    - Persists manifest, every trial outcome (including failures), traces, JSON report, and CSV report.

    Execution flow:
    1. Preflight LIVE config if applicable and enforce overwrite protection.
    2. Build and save immutable run manifest via save_runtime_manifest.
    3. Execute trials_per_case independent trials per case, saving all outcomes to trials.jsonl.
    4. Compute pass^k report (semantic vs fault injection) and export report.json + report.csv.

    Failure cases:
    - LIVE mode without allow_live or provider config raises PermissionError/RuntimeError at preflight.
    - Existing run_id raises FileExistsError.

    Side effects:
    - Writes manifest.json, trials.jsonl, traces/*, report.json, and report.csv under output_dir/run_id.
    """
    if config.mode == "LIVE":
        preflight_live_config(config, live_model_factory=live_model_factory)

    resolved_run_id = run_id or f"bench-{uuid.uuid4().hex[:12]}"
    run_dir = output_dir / resolved_run_id
    if (run_dir / "manifest.json").exists() or (run_dir / "trials.jsonl").exists():
        raise FileExistsError(f"RUN_ID_ALREADY_EXISTS:{resolved_run_id}")

    trace_dir = run_dir / "traces"
    trace_dir.mkdir(parents=True, exist_ok=True)

    manifest = build_benchmark_manifest(
        run_id=resolved_run_id,
        cases=cases,
        config=config,
        manual_reviews=manual_reviews,
    )
    save_runtime_manifest(run_dir / "manifest.json", manifest)

    outcomes: list[TrialOutcome] = []
    trials_jsonl = run_dir / "trials.jsonl"
    with trials_jsonl.open("w", encoding="utf-8") as handle:
        for case in cases:
            if case.repo_pin.untrusted_code_execution_allowed:
                raise ValueError(f"UNTRUSTED_CODE_EXECUTION_FORBIDDEN:{case.case_id}")
            for trial_index in range(config.trials_per_case):
                if config.mode == "OFFLINE_FIXTURE":
                    thread_id = str(uuid.uuid4())
                    trial_outcomes = [
                        _run_offline_fixture_stage(
                            run_id=resolved_run_id,
                            case=case,
                            trial_index=trial_index,
                            thread_id=thread_id,
                            expectation=exp,
                            trace_dir=trace_dir,
                        )
                        for exp in case.gold_rubric.stages
                    ]
                else:
                    trial_outcomes = _run_real_root_trial(
                        run_id=resolved_run_id,
                        case=case,
                        trial_index=trial_index,
                        config=config,
                        trace_dir=trace_dir,
                        live_model_factory=live_model_factory,
                    )
                for outcome in trial_outcomes:
                    outcomes.append(outcome)
                    handle.write(outcome.model_dump_json() + "\n")

    report = build_benchmark_report(
        run_id=resolved_run_id,
        manifest_sha256=manifest["manifestSha256"],
        mode=config.mode,
        outcomes=outcomes,
        k_values=config.k_values,
        manual_reviews=manual_reviews,
    )
    export_report_json(run_dir / "report.json", report)
    export_report_csv(run_dir / "report.csv", outcomes, config.k_values)
    return report
