"""Reproducible benchmark runner for OFFLINE_FIXTURE, SCRIPTED, and LIVE modes.

Reuses evals.run_manifest for immutable configuration receipts and
assessment_root.runner.run_assessment_root for real Deep Agents graph execution
in SCRIPTED and LIVE modes. Gold rubrics are never exposed to the runtime.
"""
from __future__ import annotations

import json
import re
import time
import uuid
from collections.abc import Callable, Sequence
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from evals.benchmark_schema import (
    BenchmarkCase,
    HitlFixtureAnswer,
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
    build_trial_metadata_map,
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
    """Business purpose: Build an immutable, content-hashed run manifest with expected trial inventory (AC1).

    Business rules:
    - Reuses evals.run_manifest.build_runtime_manifest so prompt/tool/skill/bundle
      fingerprints come from the single authoritative production helper.
    - Hashes actual repository fixture file trees, legal provisions, rule definitions,
      full case payloads, manual reviews, and expected trial inventory.
    - Retains runConfig bytes and its digest for downstream split and trial verification.
    - In LIVE mode, resolves the actual configured model identity for the manifest.

    Execution flow:
    1. Collect checked-in skill hashes, Root prompt/tool fingerprints, and resolved model.
    2. Hash actual repository fixture directories, legal/rule data, cases, and reviews.
    3. Build manifest with expectedTrialInventory and sign with stable_hash.

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

    model_obj: Any = SimpleNamespace(model_name=config.model_route)
    if config.mode == "LIVE":
        try:
            from model_policy import load_model_routes, resolve_agent_model
            routes = load_model_routes()
            if config.model_route in routes.roles:
                model_obj = resolve_agent_model(config.model_route)
        except Exception:  # noqa: BLE001
            model_obj = SimpleNamespace(model_name=config.model_route)

    repo_tree_pins = {
        c.repo_pin.repo_id: {
            "snapshotKind": c.repo_pin.snapshot_kind,
            "commitSha": c.repo_pin.commit_sha,
            "treeSha256": _hash_repo_fixture_tree((DEEPAGENTS_ROOT / c.repo_pin.portable_fixture_dir).resolve()),
        }
        for c in cases
    }
    corpus_pins = {c.case_id: [p.model_dump() for p in c.legal_provisions] for c in cases}
    rule_pins = {c.case_id: [r.model_dump() for r in c.rule_definitions] for c in cases}
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

    expected_inventory = [
        {
            "caseId": c.case_id,
            "stage": exp.stage,
            "trialIndex": t_idx,
            "mode": config.mode,
        }
        for c in cases
        for t_idx in range(config.trials_per_case)
        for exp in c.gold_rubric.stages
    ]

    pins = {
        "repoPinsSha256": stable_hash(repo_tree_pins),
        "corpusPinsSha256": stable_hash(corpus_pins),
        "ruleSetPinsSha256": stable_hash(rule_pins),
        "casesDatasetSha256": cases_content_sha,
        "hitlFixtureSha256": hitl_sha,
        "goldRubricSha256": gold_sha,
        "manualReviewsSha256": reviews_sha,
        "runConfigSha256": config_sha,
        "expectedInventorySha256": stable_hash(expected_inventory),
        "governanceMode": "PRODUCTION_DEFAULT" if config.mode == "LIVE" else "OFFLINE_TEST_BYPASS",
    }
    if config.case_split_manifest_sha256 is not None:
        pins["caseSplitManifestSha256"] = config.case_split_manifest_sha256
    gold_revisions = sorted({c.gold_rubric.gold_revision for c in cases})
    base_manifest = build_runtime_manifest(
        run_id=run_id,
        component="assessment-benchmark",
        locale=config.locale,
        model=model_obj,
        prompts={"assessment-root": root_prompt},
        tools=tools,
        skill_hashes=skill_hashes,
        pins=pins,
        gold_revision=",".join(gold_revisions),
    )
    payload = {k: v for k, v in base_manifest.items() if k != "manifestSha256"}
    payload["expectedTrialInventory"] = expected_inventory
    payload["runConfig"] = config.model_dump()
    if config.git_commit_sha is not None:
        payload["gitCommitSha"] = config.git_commit_sha
    return {**payload, "manifestSha256": stable_hash(payload)}


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
    2. If live_model_factory is None, verify config.model_route is configured and resolves.

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


def _match_hitl_answer(case: BenchmarkCase, request_row: dict[str, Any]) -> HitlFixtureAnswer | None:
    """Business purpose: Match an open HITL request to the case's fixture answer by key or question pattern.

    Business rules:
    - Matches request_key against unresolvedFact or regex question_pattern against question.
    - Never invents a default answer when no fixture entry matches.

    Execution flow:
    1. Inspect each HitlFixtureAnswer in case.hitl_answers.
    2. Return first matching answer or None.

    Failure cases:
    - Invalid regex pattern falls back to case-insensitive substring check.

    Side effects:
    - Pure matching; no state mutation.
    """
    unresolved = str(request_row.get("unresolvedFact") or "").strip().lower()
    question = str(request_row.get("question") or "")
    for candidate in case.hitl_answers:
        if unresolved and candidate.request_key.lower() == unresolved:
            return candidate
    for candidate in case.hitl_answers:
        try:
            if re.search(candidate.question_pattern, question, re.IGNORECASE):
                return candidate
        except re.error:
            if candidate.question_pattern.lower() in question.lower():
                return candidate
    return None


class _BenchmarkRuntimeClient:
    """Stateful per-trial AssessmentRuntimeClient with real legal data and authority/completion gates."""

    def __init__(self, case: BenchmarkCase, thread_id: str, assessment_id: str, *, locale: str = "en") -> None:
        self.case = case
        self.thread_id = thread_id
        self.assessment_id = assessment_id
        self.locale = locale
        self.repo_root = (DEEPAGENTS_ROOT / case.repo_pin.portable_fixture_dir).resolve()
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
        self.authority_violations: list[str] = []
        self.authority_gate_tested = False
        self.completion_gate_tested = False
        self.tested_invariants: set[str] = set()

    def inject_fault_once(self, error: Exception) -> None:
        """Business purpose: Arm a one-shot fault to be raised on the next domain mutation.

        Business rules:
        - Clears automatically once raised so subsequent retry can recover.

        Execution flow:
        1. Store error on self.fault_to_inject.

        Failure cases:
        - No failure modes; pure state assignment.

        Side effects:
        - Mutates in-memory client fault arming state.
        """
        self.fault_to_inject = error

    def resolve_human_request(self, request_id: str, answer_obj: HitlFixtureAnswer) -> None:
        """Business purpose: Apply a matched HITL fixture answer before resuming checkpoint.

        Business rules:
        - Fails closed if request_id is not currently in self.open_requests.
        - Only creates a HUMAN_CONFIRMED_FACT when answer_obj.resolves_fact is True;
          if resolves_fact is False, records RESOLVED_NO_FACT without promoting to a confirmed fact.

        Execution flow:
        1. Verify request_id is in open_requests, remove it, and increment case_revision.
        2. Record HUMAN_CONFIRMED_FACT only if resolves_fact is True; set lifecycle ACTIVE.

        Failure cases:
        - Raises ValueError if request_id is missing or already closed in open_requests.

        Side effects:
        - Updates in-memory HITL, facts (when resolved), and lifecycle state.
        """
        if request_id not in self.open_requests:
            raise ValueError(f"UNKNOWN_OPEN_HUMAN_REQUEST:{request_id}")
        self.open_requests.remove(request_id)
        self.case_revision += 1
        fact_id: str | None = None
        if answer_obj.resolves_fact:
            fact_id = f"fact-{self.case.case_id.lower()}-{len(self.facts) + 1}"
            self.facts.append({
                "factId": fact_id,
                "evidenceType": "HUMAN_CONFIRMED_FACT",
                "requestId": request_id,
                "answer": answer_obj.answer,
                "caseRevision": self.case_revision,
                "kind": "HUMAN_ANSWER",
                "state": "ACCEPTED",
                "status": "RESOLVED",
                "authority": "HUMAN_CONFIRMED",
                "statement": answer_obj.answer,
                "evidenceIds": [],
            })
        for row in self.human_requests:
            if row["requestId"] == request_id:
                row["status"] = "RESOLVED" if answer_obj.resolves_fact else "RESOLVED_NO_FACT"
                row["requestRevision"] = row.get("requestRevision", 0) + 1
                row["resolvedFactId"] = fact_id
        self.resolved_requests.append({
            "requestId": request_id,
            "answer": answer_obj.answer,
            "factId": fact_id,
            "resolvesFact": answer_obj.resolves_fact,
        })
        self.lifecycle_state = "ACTIVE"

    def claim(self, assessment_id: str) -> dict[str, Any]:
        """Business purpose: Claim an execution lease on the trial's durable thread.

        Business rules:
        - Rejects foreign assessment_id to enforce tenant/assessment isolation.
        - Returns resumeCheckpointId when resuming an interrupted or failed execution.

        Execution flow:
        1. Verify assessment_id matches self.assessment_id.
        2. Mint a new executionId and return lease + optional resumeCheckpointId.

        Failure cases:
        - Raises AssessmentApiError(403) on assessment_id mismatch.

        Side effects:
        - Increments execution_counter and records claim call.
        """
        if assessment_id != self.assessment_id:
            self.authority_violations.append("CROSS_ASSESSMENT_CLAIM_REJECTED")
            self.tested_invariants.add("crossAssessmentIsolation")
            from assessment_root.client import AssessmentApiError
            raise AssessmentApiError(403, "ASSESSMENT_SCOPE_MISMATCH", {"assessmentId": assessment_id})
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
            "locale": self.locale,
            "responseLanguage": self.locale,
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
            "locale": self.locale,
            "responseLanguage": self.locale,
            "lifecycleRevision": 2,
            "caseRevision": self.case_revision,
            "decisionScopeId": "ASSESSMENT",
            "repositoryScanJobId": f"scan-{self.case.case_id}",
            "repositoryId": self.case.repo_pin.repo_id,
            "coverage": [
                {
                    "assessmentRuleId": rule_id,
                    "assessmentRuleVersion": "v1",
                    "resolutionState": (
                        "DECIDED"
                        if any(d.get("decision", d).get("assessmentRuleId") == rule_id for d in self.decisions)
                        else "PENDING"
                    ),
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
        """Business purpose: Return case-specific pinned rule definitions, applicability conditions, and exceptions.

        Business rules:
        - Serves real per-case legal requirements, applicability conditions, criteria,
          and exceptions from case.rule_definitions.

        Execution flow:
        1. Record rule_set call and project case.rule_definitions into API payload.

        Failure cases:
        - No failure modes; pure in-memory read.

        Side effects:
        - Appends call record to self.calls.
        """
        self.calls.append(("rule_set", None))
        return {
            "ruleSetVersionId": self.case.rule_set_pin.rule_set_version_id,
            "legalRequirements": [
                {
                    "legalRequirementId": r.legal_requirement_id,
                    "title": r.requirement_title,
                    "proposition": r.requirement_proposition,
                    "applicabilityConditions": list(r.applicability_conditions),
                    "exceptions": list(r.exceptions),
                }
                for r in self.case.rule_definitions
            ],
            "assessmentRules": [
                {
                    "assessmentRuleId": r.rule_id,
                    "assessmentRuleVersion": "v1",
                    "concept": r.concept,
                    "legalRequirementIds": [r.legal_requirement_id],
                    "applicabilityElements": list(r.applicability_conditions),
                    "exceptions": list(r.exceptions),
                    "criteria": [dict(c) for c in r.criteria],
                }
                for r in self.case.rule_definitions
            ],
            "contextRelations": [],
        }

    def legal_source_text(self, document_id: str, locator: str) -> dict[str, Any]:
        """Business purpose: Return pinned legal provision text matching document_id and locator.

        Business rules:
        - Serves case.legal_provisions; raises 404 AssessmentApiError if not found.

        Execution flow:
        1. Search case.legal_provisions for exact (document_id, locator) match.
        2. Return provision payload or raise 404.

        Failure cases:
        - Missing provision raises AssessmentApiError(404).

        Side effects:
        - Appends call record to self.calls.
        """
        self.calls.append(("legal_text", (document_id, locator)))
        for prov in self.case.legal_provisions:
            if prov.document_id == document_id and prov.locator == locator:
                return {
                    "documentId": prov.document_id,
                    "locator": prov.locator,
                    "title": prov.title,
                    "content": prov.content,
                    "contentSha256": prov.content_sha256,
                    "sourceKind": prov.source_kind,
                }
        from assessment_root.client import AssessmentApiError
        raise AssessmentApiError(404, "ASSESSMENT_DOMAIN_REQUEST_INVALID", {"reason": "LEGAL_SOURCE_PROVISION_NOT_FOUND"})

    def legal_source_search(self, query: str) -> dict[str, Any]:
        """Business purpose: Search pinned legal provisions by query terms.

        Business rules:
        - Returns provisions where all query words appear in title or content.

        Execution flow:
        1. Tokenize query and match against case.legal_provisions.

        Failure cases:
        - Empty query returns empty matches.

        Side effects:
        - Appends call record to self.calls.
        """
        self.calls.append(("legal_search", query))
        words = query.lower().split()
        matches = [
            {
                "documentId": prov.document_id,
                "locator": prov.locator,
                "contentSha256": prov.content_sha256,
                "snippet": prov.content[:120],
            }
            for prov in self.case.legal_provisions
            if words and all(w in (prov.title + " " + prov.content).lower() for w in words)
        ]
        return {"matches": matches, "truncated": False}

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
        """Business purpose: Record cited repository source evidence with verified contentSha256.

        Business rules:
        - Raises armed one-shot fault if fault_to_inject is set.
        - Computes actual contentSha256 from the pinned fixture file lines.

        Execution flow:
        1. Check and raise armed fault if present.
        2. Read cited lines from self.repo_root and store typed REPOSITORY_SOURCE record.

        Failure cases:
        - Armed fault raises once; missing file raises AssessmentApiError(400).

        Side effects:
        - Mutates self.evidence_records and clears fault_to_inject on trigger.
        """
        self.calls.append(("evidence", body))
        if self.fault_to_inject is not None:
            err = self.fault_to_inject
            self.fault_to_inject = None
            self.injected_fault_observed = True
            raise err
        rel_path = str(body.get("path") or "")
        start_line = int(body.get("startLine") or body.get("start_line") or 1)
        end_line = int(body.get("endLine") or body.get("end_line") or start_line)
        target = (self.repo_root / rel_path).resolve()
        if not rel_path or not target.is_relative_to(self.repo_root) or not target.is_file():
            from assessment_root.client import AssessmentApiError
            raise AssessmentApiError(400, "ASSESSMENT_EVIDENCE_PATH_INVALID", {"path": rel_path})
        lines = target.read_text(encoding="utf-8").splitlines()
        excerpt = "\n".join(lines[start_line - 1:end_line])
        content_sha = sha256(excerpt.encode("utf-8")).hexdigest()

        ev_id = f"ev-{self.case.case_id.lower()}-{len(self.evidence_records) + 1}"
        self.evidence_records[ev_id] = {
            "evidenceId": ev_id,
            "evidenceType": "REPOSITORY_SOURCE",
            "type": "REPOSITORY_SOURCE",
            "state": "ACCEPTED",
            "payload": {"path": rel_path, "startLine": start_line, "endLine": end_line, "contentSha256": content_sha},
            "repositoryId": self.case.repo_pin.repo_id,
            "commitSha": self.case.repo_pin.commit_sha,
            "path": rel_path,
            "start_line": start_line,
            "end_line": end_line,
            "contentSha256": content_sha,
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
        - Rejects out-of-scope rule_id.

        Execution flow:
        1. Verify rule_id is in case.rule_set_pin.rule_ids and return INVESTIGATING.

        Failure cases:
        - Out-of-scope rule raises AssessmentApiError(403).

        Side effects:
        - Appends call record to self.calls.
        """
        self.authority_gate_tested = True
        if rule_id not in self.case.rule_set_pin.rule_ids:
            self.authority_violations.append(f"OUT_OF_SCOPE_INVESTIGATION:{rule_id}")
            from assessment_root.client import AssessmentApiError
            raise AssessmentApiError(403, "ASSESSMENT_RULE_OUT_OF_SCOPE", {"ruleId": rule_id})
        self.calls.append(("investigation", rule_id))
        return {"resolutionState": "INVESTIGATING"}

    def post_decision(self, body: dict[str, Any]) -> dict[str, Any]:
        """Business purpose: Validate scope and evidence references before persisting a rule decision.

        Business rules:
        - Rejects decisions for rules outside case.rule_set_pin.rule_ids.
        - Rejects decisions with empty or unrecorded evidence/fact references.

        Execution flow:
        1. Mark authority_gate_tested=True and validate rule scope + references.
        2. Append decision to self.decisions and return decision receipt.

        Failure cases:
        - Out-of-scope rule or invalid reference raises AssessmentApiError.

        Side effects:
        - Mutates self.decisions and self.authority_violations on failure.
        """
        from assessment_root.client import AssessmentApiError

        self.calls.append(("decision", body))
        self.authority_gate_tested = True
        dec = body.get("decision", body)
        rule_id = dec.get("assessmentRuleId")
        if rule_id not in self.case.rule_set_pin.rule_ids:
            self.authority_violations.append(f"OUT_OF_SCOPE_RULE:{rule_id}")
            self.tested_invariants.add("outOfScopeRuleRejection")
            raise AssessmentApiError(403, "ASSESSMENT_RULE_OUT_OF_SCOPE", {"assessmentRuleId": rule_id})

        known_ids = set(self.evidence_records.keys()) | {f["factId"] for f in self.facts if "factId" in f}
        refs = dec.get("references") or []
        if not refs:
            raise AssessmentApiError(400, "ASSESSMENT_DECISION_UNSUPPORTED", {"reason": "MISSING_REFERENCES"})
        for ref in refs:
            ref_id = (ref.get("evidenceId") or ref.get("factId") or ref.get("id")) if isinstance(ref, dict) else None
            if not ref_id or ref_id not in known_ids:
                self.authority_violations.append(f"UNVERIFIED_REFERENCE:{ref_id}")
                self.tested_invariants.add("unverifiedReferenceRejection")
                raise AssessmentApiError(400, "ASSESSMENT_EVIDENCE_REFERENCE_INVALID", {"referenceId": ref_id})

        self.decisions.append(body)
        return {"decisionId": f"dec-{len(self.decisions)}", "decisionRevision": len(self.decisions), "replayed": False}

    def request_finalization(self) -> dict[str, Any]:
        """Business purpose: Enforce Completion Gate before transitioning lifecycle to FINALIZING.

        Business rules:
        - Blocks finalization if any pinned rule lacks a decision or any HITL request is open.

        Execution flow:
        1. Mark completion_gate_tested=True and check undecided rules + open HITL requests.
        2. Transition to FINALIZING only when blockers is empty.

        Failure cases:
        - Pending rules or open HITL requests return blockers without FINALIZING.

        Side effects:
        - Mutates self.lifecycle_state only when all blockers are cleared.
        """
        self.calls.append(("finalization", None))
        self.completion_gate_tested = True
        decided_rules = {d.get("decision", d).get("assessmentRuleId") for d in self.decisions}
        blockers: list[str] = []
        for rule_id in self.case.rule_set_pin.rule_ids:
            if rule_id not in decided_rules:
                blockers.append(f"UNDECIDED_RULE:{rule_id}")
                self.tested_invariants.add("completionGateUndecidedRule")
        if self.open_requests:
            blockers.append(f"OPEN_HUMAN_REQUESTS:{len(self.open_requests)}")
            self.tested_invariants.add("completionGateOpenHitl")
        if blockers:
            return {"lifecycleState": self.lifecycle_state, "blockers": blockers}
        self.lifecycle_state = "FINALIZING"
        return {"lifecycleState": self.lifecycle_state, "blockers": []}

    def post_final_report(self, body: dict[str, Any]) -> dict[str, Any]:
        """Business purpose: Persist final report and transition lifecycle to COMPLETE.

        Business rules:
        - Requires lifecycle_state == FINALIZING (enforces Completion Gate).

        Execution flow:
        1. Reject if lifecycle_state != FINALIZING, store report, set COMPLETE.

        Failure cases:
        - Raises AssessmentApiError(409) if called outside FINALIZING.

        Side effects:
        - Mutates self.final_report and self.lifecycle_state.
        """
        if self.lifecycle_state != "FINALIZING":
            from assessment_root.client import AssessmentApiError
            raise AssessmentApiError(409, "ASSESSMENT_NOT_FINALIZING", {"lifecycleState": self.lifecycle_state})
        self.calls.append(("final_report", body))
        self.final_report = body
        self.lifecycle_state = "COMPLETE"
        return {"lifecycleState": self.lifecycle_state, "artifactId": f"report-{self.case.case_id.lower()}"}

    def post_human_request(self, body: dict[str, Any]) -> dict[str, Any]:
        """Business purpose: Open a human resolution request idempotently and transition to WAITING_FOR_HUMAN.

        Business rules:
        - Stores question and unresolvedFact for fixture matching.
        - Replays existing requestId on idempotencyKey match without re-opening resolved requests.

        Execution flow:
        1. Check human_request_by_key for idempotent replay.
        2. Mint requestId, add to open_requests, set lifecycle_state = WAITING_FOR_HUMAN.

        Failure cases:
        - No failure modes.

        Side effects:
        - Mutates self.open_requests, self.human_requests, and self.lifecycle_state.
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
            "question": body.get("question", ""),
            "unresolvedFact": body.get("unresolvedFact", ""),
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
        created = [self.post_human_request(item) for item in body.get("requests", [])]
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


def _build_scripted_model_for_case(
    case: BenchmarkCase,
    first_file: str,
    *,
    is_resume: bool = False,
    confirmed_fact_ids: Sequence[str] = (),
) -> Any:
    """Business purpose: Construct a deterministic ScriptedModel driven ONLY by case input & runtime tool outputs.

    Business rules:
    - NEVER inspects case.gold_rubric or StageExpectation.
    - Emits real governed tool calls including read_legal_source.

    Execution flow:
    1. Define step sequence based solely on case.task_category, case.hitl_answers, and tool outputs.
    2. Return a BaseChatModel subclass instance for run_assessment_root().

    Failure cases:
    - Runtime tool errors are handled by LangGraph / run_assessment_root().

    Side effects:
    - Pure model construction.
    """
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage, ToolMessage
    from langchain_core.outputs import ChatGeneration, ChatResult

    rule_id = case.rule_set_pin.rule_ids[0]
    prov = case.legal_provisions[0]
    repo_root = (DEEPAGENTS_ROOT / case.repo_pin.portable_fixture_dir).resolve()
    total_lines = len((repo_root / first_file).read_text(encoding="utf-8").splitlines()) if (repo_root / first_file).is_file() else 1
    cite_start, cite_end = 1, max(1, total_lines)

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
            for fid in confirmed_fact_ids:
                refs.append({"type": "CONFIRMED_FACT", "id": fid})
            return _call("submit_rule_decision", {
                "assessment_rule_id": rule_id,
                "applicability": "APPLICABLE",
                "rationale": "Confirmed via HITL answer and cited source.",
                "legal_context_ids": [case.rule_definitions[0].legal_requirement_id],
                "references": refs,
                "criteria": [{"criterion_id": "C-1", "outcome": "MET", "rationale": "Verified.", "references": refs}],
                "compliance": "COMPLIANT",
            }, "decide-resume")

        steps = [
            lambda _m: _call("get_assessment_context", {}, "ctx-resume"),
            lambda _m: _call("cite_repository_source", {"path": first_file, "start_line": cite_start, "end_line": cite_end}, "cite-resume"),
            _decide_after_resume,
            lambda _m: _call("request_finalization", {}, "fin-resume"),
            lambda _m: _call("submit_final_report", {"summary": "Resumed report.", "findings": [{"assessment_rule_id": rule_id, "summary": "Compliant after HITL."}]}, "rep-resume"),
            lambda _m: AIMessage(content="Assessment complete after HITL resume."),
        ]
        return _CaseScriptedModel(responses=[], step_fns=steps)

    steps: list[Any] = [
        lambda _m: _call("get_assessment_context", {}, "ctx-1"),
        lambda _m: _call("get_pinned_rule_set", {}, "rules-1"),
        lambda _m: _call("read_legal_source", {"document_id": prov.document_id, "locator": prov.locator}, "law-1"),
        lambda _m: _call("cite_repository_source", {"path": first_file, "start_line": cite_start, "end_line": cite_end}, "cite-1"),
    ]

    if case.hitl_answers:
        steps.append(lambda _m: _call("open_human_request", {
            "assessment_rule_id": rule_id,
            "criterion_ids": ["C-1"],
            "question": f"Provide the missing {case.hitl_answers[0].request_key} fact for {case.task_category}.",
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
            for fid in confirmed_fact_ids:
                refs.append({"type": "CONFIRMED_FACT", "id": fid})
            return _call("submit_rule_decision", {
                "assessment_rule_id": rule_id,
                "applicability": "APPLICABLE",
                "rationale": "Observed gap in pinned repository source.",
                "legal_context_ids": [case.rule_definitions[0].legal_requirement_id],
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
            for fid in confirmed_fact_ids:
                refs.append({"type": "CONFIRMED_FACT", "id": fid})
            return _call("submit_rule_decision", {
                "assessment_rule_id": rule_id,
                "applicability": "NOT_APPLICABLE",
                "rationale": "Internal CLI does not process personal data.",
                "legal_context_ids": [case.rule_definitions[0].legal_requirement_id],
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
            for fid in confirmed_fact_ids:
                refs.append({"type": "CONFIRMED_FACT", "id": fid})
            return _call("submit_rule_decision", {
                "assessment_rule_id": rule_id,
                "applicability": "APPLICABLE",
                "rationale": "Verified in pinned repository source.",
                "legal_context_ids": [case.rule_definitions[0].legal_requirement_id],
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


def _resolve_model_for_trial(
    *,
    case: BenchmarkCase,
    config: RunConfig,
    first_file: str,
    is_resume: bool,
    live_model_factory: Callable[[BenchmarkCase, RunConfig], Any] | None,
    confirmed_fact_ids: Sequence[str] = (),
) -> tuple[Any, bool]:
    """Business purpose: Resolve the model uniformly for initial, retry, and resume runs.

    Business rules:
    - LIVE mode NEVER falls back to SCRIPTED model on initial, retry, or resume.
    - Returns (model, is_simulated_provider) so physical vs simulated calls are separated.

    Execution flow:
    1. For LIVE: use live_model_factory (simulated) or resolve_agent_model(config.model_route) (physical).
    2. For SCRIPTED: build deterministic _CaseScriptedModel.

    Failure cases:
    - Unsupported mode or missing LIVE provider raises RuntimeError.

    Side effects:
    - May resolve configured LangChain model client in LIVE mode.
    """
    if config.mode == "LIVE":
        if live_model_factory is not None:
            return live_model_factory(case, config), True
        from model_policy import resolve_agent_model
        return resolve_agent_model(config.model_route), False
    if config.mode == "SCRIPTED":
        return _build_scripted_model_for_case(
            case,
            first_file,
            is_resume=is_resume,
            confirmed_fact_ids=confirmed_fact_ids,
        ), False
    raise RuntimeError(f"UNSUPPORTED_REAL_ROOT_MODE:{config.mode}")


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
    2. Grade observed verdict, typed evidence records, HITL, and persisted state.

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
    repo_root = (DEEPAGENTS_ROOT / case.repo_pin.portable_fixture_dir).resolve()
    if not isinstance(stage_out, dict):
        outcome = grade_trial(
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
            rule_set_version_id=case.rule_set_pin.rule_set_version_id,
            usage=TrialUsage(physical_attempts=0, simulated_provider_calls=0, scripted_invocations=0),
            trace_path=f"traces/{trace_path.name}",
            trace_sha256=None,
        )
    else:
        outcome = grade_trial(
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
            authority_gate_tested=False,
            completion_gate_tested=False,
            rule_set_version_id=case.rule_set_pin.rule_set_version_id,
            observed_evidence_records=stage_out.get("evidenceRecords"),
            expected_repo_id=case.repo_pin.repo_id,
            expected_commit_sha=case.repo_pin.commit_sha,
            repo_fixture_root=repo_root,
            error_code=stage_out.get("errorCode"),
            error_message=stage_out.get("errorMessage"),
            latency_ms=latency_ms,
            usage=TrialUsage(physical_attempts=0, simulated_provider_calls=0, scripted_invocations=0),
            trace_path=f"traces/{trace_path.name}",
            trace_sha256=None,
        )

    trace_sha = _write_trace(trace_path, {
        "runId": run_id,
        "caseId": case.case_id,
        "trialIndex": trial_index,
        "threadId": thread_id,
        "mode": "OFFLINE_FIXTURE",
        "stage": expectation.stage,
        "output": stage_out,
        "outcomeBinding": {
            "passed": outcome.passed,
            "actualVerdict": outcome.actual_verdict,
            "lifecycleState": outcome.lifecycle_state,
        },
    })
    return outcome.model_copy(update={"trace_sha256": trace_sha})


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
    - LIVE mode uses the same model resolution for initial, retry, and resume (never SCRIPTED).
    - HITL resume matches open request by request_key / question_pattern (never fabricates answers).
    - Tracks real authority_gate_tested, completion_gate_tested, and decision-referenced evidence.

    Execution flow:
    1. Create isolated per-trial runtime client, checkpointer, and sandboxed backend.
    2. For each stage, resolve model uniformly, invoke run_assessment_root(), and grade strictly.

    Failure cases:
    - Unhandled runtime errors or HITL mismatches are captured as failed TrialOutcome records.

    Side effects:
    - Writes per-stage trace JSON files under trace_dir.
    """
    from deepagents.backends import FilesystemBackend
    from langchain_core.callbacks import BaseCallbackHandler
    from langgraph.checkpoint.memory import InMemorySaver

    from assessment_root.runner import run_assessment_root

    class _BenchmarkTelemetryCallback(BaseCallbackHandler):
        def __init__(self) -> None:
            self.attempted_calls = 0
            self.completed_calls = 0
            self.input_tokens = 0
            self.cached_input_tokens = 0
            self.output_tokens = 0
            self.model_errors: list[str] = []
            self.tools: list[dict[str, Any]] = []

        def on_chat_model_start(self, serialized: Any, messages: Any, **kwargs: Any) -> None:  # noqa: ARG002
            """Business purpose: Count every attempted model call including retries and failures.
            Business rules:
            - Increments attempted_calls before provider dispatch.
            Execution flow:
            1. Increment attempted_calls counter.
            Failure cases:
            - No failure modes; pure counter increment.
            Side effects:
            - Mutates in-memory telemetry counter.
            """
            self.attempted_calls += 1

        def on_llm_end(self, response: Any, **kwargs: Any) -> None:  # noqa: ARG002
            """Business purpose: Record completed model call count and token usage from callback telemetry.
            Business rules:
            - Captures input, cached_input, and output tokens from usage_metadata.
            Execution flow:
            1. Increment completed_calls and accumulate token metadata.
            Failure cases:
            - Missing usage_metadata defaults to zero tokens.
            Side effects:
            - Mutates in-memory telemetry counters.
            """
            self.completed_calls += 1
            for gens in getattr(response, "generations", []):
                for gen in gens:
                    msg = getattr(gen, "message", None)
                    usage = getattr(msg, "usage_metadata", None) or {}
                    self.input_tokens += int(usage.get("input_tokens", 0))
                    details = usage.get("input_token_details") or {}
                    self.cached_input_tokens += int(details.get("cache_read", 0))
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
    client = _BenchmarkRuntimeClient(case, thread_id, assessment_id, locale=config.locale)
    repo_root = (DEEPAGENTS_ROOT / case.repo_pin.portable_fixture_dir).resolve()
    saver = InMemorySaver()
    outcomes: list[TrialOutcome] = []

    for stage_idx, expectation in enumerate(case.gold_rubric.stages):
        started = time.perf_counter()
        review_trace = _BenchmarkTelemetryCallback()
        is_resume = expectation.stage == "RESUME_FINAL" and stage_idx > 0
        hitl_mismatch_err: str | None = None

        if is_resume and client.open_requests:
            for open_id in list(client.open_requests):
                open_row = next((r for r in client.human_requests if r["requestId"] == open_id), {})
                matched = _match_hitl_answer(case, open_row)
                if matched is None:
                    hitl_mismatch_err = "HITL_FIXTURE_ANSWER_MISMATCH"
                    break
                client.resolve_human_request(open_id, matched)

        if case.is_fault_injection:
            client.inject_fault_once(ConnectionError("SERVICE_UNAVAILABLE_503"))

        run_result: dict[str, Any] = {}
        err_code: str | None = hitl_mismatch_err
        err_msg: str | None = "No matching HitlFixtureAnswer for open request" if hitl_mismatch_err else None
        recovery_observed = False
        is_simulated = False

        if err_code is None:
            try:
                files = sorted(p.relative_to(repo_root) for p in repo_root.rglob("*") if p.is_file())
                if not files:
                    raise FileNotFoundError(f"REPO_FIXTURE_EMPTY:{repo_root}")
                first_file = str(files[0])
                backend = FilesystemBackend(root_dir=repo_root, virtual_mode=True)
                model, is_simulated = _resolve_model_for_trial(
                    case=case,
                    config=config,
                    first_file=first_file,
                    is_resume=is_resume,
                    live_model_factory=live_model_factory,
                    confirmed_fact_ids=[f["factId"] for f in client.facts if "factId" in f],
                )
                # Real LIVE uses production governance (None -> default); SCRIPTED/simulated uses ()
                governance = None if (config.mode == "LIVE" and not is_simulated) else ()
                run_result = run_assessment_root(
                    client,  # type: ignore[arg-type]
                    assessment_id,
                    backend_factory=lambda _c, _ctx: (backend, None),
                    model=model,
                    checkpointer=saver,
                    governance=governance,
                    extra_callbacks=[review_trace],
                )
                if case.is_fault_injection and client.injected_fault_observed and run_result.get("state") == "FAILED":
                    retry_model, is_simulated_retry = _resolve_model_for_trial(
                        case=case,
                        config=config,
                        first_file=first_file,
                        is_resume=False,
                        live_model_factory=live_model_factory,
                    )
                    is_simulated = is_simulated or is_simulated_retry
                    retry_gov = None if (config.mode == "LIVE" and not is_simulated) else ()
                    run_result = run_assessment_root(
                        client,  # type: ignore[arg-type]
                        assessment_id,
                        backend_factory=lambda _c, _ctx: (backend, None),
                        model=retry_model,
                        checkpointer=saver,
                        governance=retry_gov,
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
            **{f["factId"]: f for f in client.facts if "factId" in f},
        }
        decision_ref_ids = [
            ref.get("evidenceId") or ref.get("factId") or ref.get("id")
            for d in client.decisions
            for ref in (d.get("decision", d).get("references") or [])
            if isinstance(ref, dict) and (ref.get("evidenceId") or ref.get("factId") or ref.get("id"))
        ]
        observed_hitl = "OPEN" if client.open_requests else ("RESOLVED" if client.resolved_requests else "NONE")
        observed_persisted = {
            "lifecycleState": client.lifecycle_state,
            "openHumanRequests": len(client.open_requests),
        }
        observed_verdict = _derive_observed_verdict(client, run_result)

        # Never equate callback attempted_calls to verified physical provider attempts
        unverified_live_calls = review_trace.attempted_calls if (config.mode == "LIVE" and not is_simulated) else 0
        simulated_calls = review_trace.attempted_calls if (config.mode == "LIVE" and is_simulated) else 0
        scripted_calls = review_trace.attempted_calls if config.mode == "SCRIPTED" else 0

        trace_path = trace_dir / f"{case.case_id}_t{trial_index}_{expectation.stage}.json"
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
            authority_violation=bool(client.authority_violations),
            authority_gate_tested=client.authority_gate_tested,
            completion_gate_tested=client.completion_gate_tested,
            tested_invariants=client.tested_invariants,
            rule_set_version_id=case.rule_set_pin.rule_set_version_id,
            observed_evidence_records=observed_evidence_records,
            decision_referenced_ids=decision_ref_ids,
            expected_repo_id=case.repo_pin.repo_id,
            expected_commit_sha=case.repo_pin.commit_sha,
            repo_fixture_root=repo_root,
            graph_executed=bool(run_result),
            checkpoint_id=run_result.get("checkpointId"),
            injected_fault_observed=client.injected_fault_observed,
            recovery_observed=recovery_observed,
            error_code=err_code,
            error_message=err_msg,
            latency_ms=latency_ms,
            usage=TrialUsage(
                physical_attempts=0,
                physical_attempts_verified=False,
                unverified_callback_calls=unverified_live_calls,
                failed_attempts=len(review_trace.model_errors),
                simulated_provider_calls=simulated_calls,
                scripted_invocations=scripted_calls,
                input_tokens=review_trace.input_tokens if (config.mode == "LIVE" and not is_simulated) else None,
                cached_input_tokens=review_trace.cached_input_tokens if (config.mode == "LIVE" and not is_simulated) else None,
                output_tokens=review_trace.output_tokens if (config.mode == "LIVE" and not is_simulated) else None,
            ),
            trace_path=f"traces/{trace_path.name}",
            trace_sha256=None,
        )
        observed_output = {
            "outputVersion": "P14-OBSERVED-ASSESSMENT-OUTPUT-V1",
            "runId": run_id,
            "caseId": case.case_id,
            "trialIndex": trial_index,
            "threadId": thread_id,
            "assessmentId": assessment_id,
            "evaluationStage": "ASSESSMENT_ROOT",
            "lifecycleStage": expectation.stage,
            "targetRuleIds": list(case.rule_set_pin.rule_ids),
            "ruleSetVersionId": case.rule_set_pin.rule_set_version_id,
            "ruleDefinitions": [rule.model_dump() for rule in case.rule_definitions],
            "legalProvisions": [provision.model_dump() for provision in case.legal_provisions],
            "repositorySnapshot": case.repo_pin.model_dump(),
            "corpusPin": case.corpus_pin.model_dump(),
            "assessmentDecisions": list(client.decisions),
            "actualAssessmentDecision": client.decisions[-1] if client.decisions else None,
            "actualVerdict": outcome.actual_verdict,
            "evidenceReferences": sorted(observed_refs),
            "evidenceRecords": observed_evidence_records,
            "facts": list(client.facts),
            "hitl": {
                "state": observed_hitl,
                "requests": list(client.human_requests),
                "openRequestIds": list(client.open_requests),
                "resolvedRequests": list(client.resolved_requests),
            },
            "finalReport": client.final_report,
            "lifecycleState": client.lifecycle_state,
            "runResult": run_result,
            "lifecycleHistory": [
                {
                    "stage": prior.stage,
                    "traceSha256": prior.trace_sha256,
                    "actualVerdict": prior.actual_verdict,
                    "lifecycleState": prior.lifecycle_state,
                }
                for prior in outcomes
            ],
            "authorityViolations": list(client.authority_violations),
            "outcomeBinding": {
                "passed": outcome.passed,
                "actualVerdict": outcome.actual_verdict,
                "lifecycleState": outcome.lifecycle_state,
                "stage": outcome.stage,
                "trialIndex": outcome.trial_index,
                "threadId": outcome.thread_id,
                "runId": outcome.run_id,
                "caseId": outcome.case_id,
            },
        }
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
            "authorityViolations": list(client.authority_violations),
            "toolCalls": review_trace.tools,
            "clientCalls": [c[0] for c in client.calls],
            "observedOutput": observed_output,
            "observedOutputSha256": stable_hash(observed_output),
            "outcomeBinding": {
                "passed": outcome.passed,
                "actualVerdict": outcome.actual_verdict,
                "lifecycleState": outcome.lifecycle_state,
            },
        })
        outcomes.append(outcome.model_copy(update={"trace_sha256": trace_sha}))
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
    case_by_id = {c.case_id: c for c in cases}
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

    trial_metadata_by_key = build_trial_metadata_map(manifest, outcomes)

    report = build_benchmark_report(
        run_id=resolved_run_id,
        manifest_sha256=manifest["manifestSha256"],
        mode=config.mode,
        outcomes=outcomes,
        k_values=config.k_values,
        manual_reviews=manual_reviews,
        trial_metadata_by_key=trial_metadata_by_key,
    )
    export_report_json(run_dir / "report.json", report)
    export_report_csv(run_dir / "report.csv", outcomes, config.k_values)
    return report
