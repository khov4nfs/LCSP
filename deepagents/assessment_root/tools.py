"""Governed tools of the Assessment Root.

The model supplies only semantic content (what it found, what it decided, what it asks). Identity,
thread, execution, lease, pins, versions, hashes and idempotency keys are bound here from server
state and never appear in a tool schema. The API validates every packet; a rejection is returned
to the model as structured, scalar feedback so it can correct itself, never raised as a crash.
"""

from __future__ import annotations

import ast
import hashlib
import json
import re
import threading
import uuid
from dataclasses import dataclass, field, fields
from typing import Any, Literal

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.tools import StructuredTool
from langgraph.types import interrupt
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from assessment_root.client import AssessmentApiError, AssessmentRuntimeClient
from assessment_root.learning import retrieve_shared_heuristics

# Native/search tool names whose executions authenticate a search-coverage record.
_SEARCH_TOOLS = {"ls", "glob", "grep", "search_code_graph", "trace_call_path", "search_code_text", "get_repository_architecture"}
_READ_TOOLS = {"read_file"}
_SCOPE_DIRECTORY = "SOURCE_DIRECTORY"
_SCOPE_FILE = "SOURCE_FILE"
_SCOPE_GRAPH = "GRAPH_INDEX"
_MAX_TRACE = 400


def _repo_path(value: Any) -> str:
    text = str(value or "").strip().replace("\\", "/")
    text = re.sub(r"/+", "/", text).lstrip("/")
    parts = [part for part in text.split("/") if part not in ("", ".")]
    if any(part == ".." for part in parts):
        return "."
    return "/".join(parts) or "."


def _result_count(output: Any) -> int:
    content = getattr(output, "content", output)
    if isinstance(content, list):
        text = "\n".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and isinstance(block.get("text"), str)
        )
    else:
        text = str(content or "")
    text = text.strip()
    if text.startswith("Codebase Memory ") and (
        " is unavailable:" in text or " failed:" in text
    ):
        return 0
    if text in {"(no results)", "No matches found", "No files found"}:
        return 0
    try:
        payload = json.loads(text)
    except (TypeError, ValueError):
        payload = None
        if text.startswith("["):
            try:
                payload = ast.literal_eval(text)
            except (ValueError, SyntaxError):
                pass
    if isinstance(payload, list):
        return len(payload)
    if isinstance(payload, dict) and isinstance(payload.get("results"), list):
        return len(payload["results"])
    return len([line for line in text.splitlines() if line.strip()])


def _is_truncated(text: str) -> bool:
    try:
        payload = json.loads(text)
    except (TypeError, ValueError):
        payload = None
    if isinstance(payload, dict) and any(
        payload.get(key) is True for key in ("truncated", "has_more", "hasMore")
    ):
        return True
    lowered = text.lower()
    if re.search(r"\b(?:truncated|has[_ ]?more)\s*[:=]\s*(?:true|1|yes)\b", lowered):
        return True
    return any(
        marker in lowered
        for marker in (
            "[truncated",
            "output truncated",
            "results truncated",
            "truncated results",
            "result limit reached",
            "has more results",
        )
    )


class SearchTrace(BaseCallbackHandler):
    """Records search/read operations actually executed by the Root and its task descendants.

    Query/scope/read facts come from this trace. Gap notes are descriptive Root-authored caveats,
    not proof of which searches ran or whether their results were sufficient.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._open: dict[str, dict[str, Any]] = {}
        self.entries: list[dict[str, Any]] = []
        self.dropped_entries = 0

    def record(self, entry: dict[str, Any]) -> None:
        with self._lock:
            if len(self.entries) >= _MAX_TRACE:
                self.dropped_entries += 1
                return
            self.entries.append(entry)

    def on_tool_start(self, serialized, input_str, *, run_id, inputs=None, **kwargs):  # noqa: ANN001
        name = (serialized or {}).get("name") or kwargs.get("name")
        if name not in _SEARCH_TOOLS and name not in _READ_TOOLS:
            return
        args = inputs if isinstance(inputs, dict) else {}
        with self._lock:
            self._open[str(run_id)] = {"tool": name, "args": args, "input": str(input_str)[:300]}

    def on_tool_end(self, output, *, run_id, **kwargs):  # noqa: ANN001
        with self._lock:
            entry = self._open.pop(str(run_id), None)
        if entry is None:
            return
        content = getattr(output, "content", output)
        if isinstance(content, list):
            text = "\n".join(
                block.get("text", "")
                for block in content
                if isinstance(block, dict) and isinstance(block.get("text"), str)
            )
        else:
            text = str(content or "")
        entry["resultCount"] = _result_count(output)
        entry["truncated"] = _is_truncated(text)
        entry["failed"] = "Codebase Memory " in text and (
            " is unavailable:" in text or " failed:" in text
        )
        self.record(entry)

        if not entry["failed"]:
            from orchestration.agent_stream import publish_agent_stream_event

            publish_agent_stream_event(
                "TOOL_RESULT", tool_name=entry["tool"],
                tool_call_id=str(run_id), status="COMPLETED",
            )

    def on_tool_error(self, error, *, run_id, **kwargs):  # noqa: ANN001
        with self._lock:
            entry = self._open.pop(str(run_id), None)
        if entry is None:
            return
        entry.update(resultCount=0, truncated=False, failed=True)
        self.record(entry)

    def snapshot_and_reset(self) -> tuple[list[dict[str, Any]], int]:
        with self._lock:
            taken, self.entries = self.entries, []
            dropped, self.dropped_entries = self.dropped_entries, 0
            return taken, dropped


@dataclass
class RootRun:
    """Everything one Root execution binds: client/lease, repository backend, caches."""

    client: AssessmentRuntimeClient
    assessment_id: str
    thread_id: str
    execution_id: str
    backend: Any
    trace: SearchTrace = field(default_factory=SearchTrace)
    case_revision: int = 0
    pins: dict[str, str] = field(default_factory=dict)
    decision_revisions: dict[str, int] = field(default_factory=dict)
    rule_versions: dict[str, str] = field(default_factory=dict)
    rule_criteria: dict[str, list[str]] = field(default_factory=dict)
    response_language: str = "en"

    def adopt_context(self, context: dict[str, Any]) -> None:
        self.case_revision = int(context["caseRevision"])
        self.pins = {
            "ruleSetVersionId": context["ruleSetVersionId"],
            "repositorySnapshotId": context["repositorySnapshotId"],
            "repositoryCommit": context["repositoryCommit"],
        }
        for row in context.get("coverage", []):
            self.decision_revisions[row["assessmentRuleId"]] = int(row["decisionRevision"])
            self.rule_versions[row["assessmentRuleId"]] = row["assessmentRuleVersion"]
        if context.get("responseLanguage") or context.get("locale"):
            from orchestration.context import resolve_response_language
            self.response_language = resolve_response_language(
                context.get("responseLanguage") or context.get("locale") or self.response_language
            )


# ---- argument schemas (semantic content only) ---------------------------------------------------


class _Args(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CiteRepositorySourceArgs(_Args):
    path: str = Field(description="Repository-relative file path.")
    start_line: int = Field(ge=1, description="First line of the cited range (1-based).")
    end_line: int = Field(ge=1, description="Last line of the cited range (inclusive).")


class RecordSearchCoverageArgs(_Args):
    inspected_entry_points: list[str] = Field(
        default_factory=list,
        description="Entry-point files you read, a subset of files you actually read.",
    )
    known_gaps: list[str] = Field(
        default_factory=list,
        description="Root-authored caveats about what searches could not cover; not proof a search ran.",
    )
    direct_source_fallbacks: list[dict[str, str]] = Field(
        default_factory=list,
        description="Files read directly because an index/graph query was insufficient: {path, reason}.",
    )


class AcceptFactArgs(_Args):
    kind: Literal["FACT", "USE_CASE"]
    statement: str = Field(min_length=1)
    evidence_ids: list[str] = Field(min_length=1, description="Accepted evidence IDs from cite_repository_source.")


class StartInvestigationArgs(_Args):
    assessment_rule_id: str


class GetRuleArgs(_Args):
    assessment_rule_id: str


class DecisionReference(_Args):
    type: Literal["ASSESSMENT_EVIDENCE", "CONFIRMED_FACT"]
    id: str = Field(description="evidenceId or factId returned by the governed tools.")


class CriterionDecisionArgs(_Args):
    criterion_id: str
    outcome: Literal["MET", "NOT_MET"]
    rationale: str = Field(min_length=1)
    references: list[DecisionReference] = Field(min_length=1)


class SubmitDecisionArgs(_Args):
    assessment_rule_id: str
    applicability: Literal["APPLICABLE", "NOT_APPLICABLE"]
    rationale: str = Field(min_length=1)
    legal_context_ids: list[str] = Field(min_length=1, description="LegalRequirement IDs relied on.")
    references: list[DecisionReference] = Field(min_length=1)
    criteria: list[CriterionDecisionArgs] = Field(
        default_factory=list, description="Every criterion, when APPLICABLE; empty when NOT_APPLICABLE."
    )
    compliance: Literal["COMPLIANT", "NON_COMPLIANT"] | None = None


class OpenHumanRequestArgs(_Args):
    assessment_rule_id: str
    criterion_ids: list[str] = Field(default_factory=list)
    question: str = Field(min_length=1, description="Customer-safe wording; no file paths, hashes or internal IDs.")
    unresolved_fact: str = Field(min_length=1)
    decision_impact: list[str] = Field(min_length=1)
    resolution_attempts: list[str] = Field(min_length=1, description="How you already tried to settle it from sources.")
    control_type: str = "FREE_TEXT"
    choices: list[dict[str, str]] = Field(default_factory=list, description="[{value, label}] when a fixed set applies.")


class ReportUnresolvableHumanFactArgs(OpenHumanRequestArgs):
    unavailability_rationale: str = Field(min_length=1, description="Why accepted evidence establishes that this material fact is permanently unobtainable under the contract; an unknown answer alone is insufficient.")
    evidence_ids: list[str] = Field(min_length=1, description="Accepted evidence IDs supporting the unavailability claim.")


class FinalReportFindingArgs(_Args):
    assessment_rule_id: str
    summary: str = Field(min_length=1)
    recommendations: list[str] = Field(default_factory=list)


class SubmitFinalReportArgs(_Args):
    summary: str = Field(min_length=1)
    findings: list[FinalReportFindingArgs] = Field(min_length=1)


# ---- tool construction ----------------------------------------------------------------------------


def _failure(error: AssessmentApiError) -> dict[str, Any]:
    failures = [
        item for item in str(error.meta.get("failures", "")).split(",") if item
    ]
    return {
        "ok": False,
        "code": error.code,
        "retryable": error.retryable,
        **({"failures": failures} if failures else {}),
        **{k: v for k, v in error.meta.items() if k != "failures"},
        "hint": "Call get_assessment_context to reload server state, then correct and resubmit."
        if not error.retryable
        else "Transient server error; retry the same call.",
    }


def _validation_feedback(error: ValidationError) -> str:
    """Rejected arguments are correction feedback, like a DecisionValidator rejection, not a failed run.

    Field paths and messages only, never the model's argument values.
    """
    problems = [f"{'.'.join(str(part) for part in item['loc'])}: {item['msg']}" for item in error.errors()[:8]]
    return json.dumps(
        {
            "ok": False,
            "code": "INVALID_TOOL_ARGUMENTS",
            "retryable": False,
            "problems": problems,
            "hint": "Correct the listed arguments (cite evidence or reload context first when one is missing) and call the tool again.",
        },
        ensure_ascii=False,
    )


def _guard(call):
    def run(*args: Any, **kwargs: Any) -> str:
        try:
            return json.dumps(call(*args, **kwargs), ensure_ascii=False, default=str)
        except AssessmentApiError as error:
            return json.dumps(_failure(error), ensure_ascii=False)

    return run


def build_root_tools(run: RootRun) -> list[StructuredTool]:
    client = run.client

    def get_assessment_context() -> dict[str, Any]:
        """Reload this assessment's server state: pins, case revision, per-rule coverage, facts, evidence."""
        context = client.context()
        run.adopt_context(context)
        return {
            "ok": True,
            "caseRevision": context["caseRevision"],
            "pins": run.pins,
            "decisionScopeId": context["decisionScopeId"],
            "coverage": [
                {
                    "assessmentRuleId": row["assessmentRuleId"],
                    "assessmentRuleVersion": row["assessmentRuleVersion"],
                    "resolutionState": row["resolutionState"],
                    "decisionRevision": row["decisionRevision"],
                }
                for row in context["coverage"]
            ],
            "facts": [
                {
                    "factId": f["factId"],
                    "caseRevision": f["caseRevision"],
                    "kind": f["kind"],
                    "state": f["state"],
                    "statement": f["statement"],
                    "evidenceIds": f["evidenceIds"],
                }
                for f in context["facts"]
            ],
            "evidence": [
                {
                    "evidenceId": e["evidenceId"],
                    "type": e["type"],
                    "state": e["state"],
                    "payload": e["payload"],
                }
                for e in context["evidence"]
            ],
            "openHumanRequestIds": context["openHumanRequestIds"],
        }

    def get_pinned_rule_set() -> dict[str, Any]:
        """List every AssessmentRule of the immutable rule set pinned to this assessment."""
        rule_set = client.rule_set()
        for rule in rule_set["assessmentRules"]:
            run.rule_versions[rule["assessmentRuleId"]] = rule["assessmentRuleVersion"]
            run.rule_criteria[rule["assessmentRuleId"]] = [
                c["criterionId"] for c in rule.get("criteria", [])
            ]
        return {
            "ok": True,
            "ruleSetVersionId": rule_set["ruleSetVersionId"],
            "legalRequirementCount": len(rule_set["legalRequirements"]),
            "assessmentRules": [
                {
                    "assessmentRuleId": rule["assessmentRuleId"],
                    "assessmentRuleVersion": rule["assessmentRuleVersion"],
                    "concept": rule["concept"],
                    "legalRequirementIds": rule["legalRequirementIds"],
                    "criterionIds": [c["criterionId"] for c in rule.get("criteria", [])],
                }
                for rule in rule_set["assessmentRules"]
            ],
        }

    def get_assessment_rule(assessment_rule_id: str) -> dict[str, Any]:
        """Full text of one AssessmentRule, its linked LegalRequirements and their context relations."""
        rule_set = client.rule_set()
        rule = next(
            (r for r in rule_set["assessmentRules"] if r["assessmentRuleId"] == assessment_rule_id),
            None,
        )
        if rule is None:
            return {"ok": False, "code": "RULE_NOT_IN_RULE_SET"}
        linked = set(rule["legalRequirementIds"])
        relations = [r for r in rule_set["contextRelations"] if r["fromLegalRequirementId"] in linked]
        related = {r["toLegalRequirementId"] for r in relations if r.get("toLegalRequirementId")}
        return {
            "ok": True,
            "assessmentRule": rule,
            "legalRequirements": [
                lr for lr in rule_set["legalRequirements"] if lr["legalRequirementId"] in linked | related
            ],
            "contextRelations": relations,
        }

    def start_rule_investigation(assessment_rule_id: str) -> dict[str, Any]:
        """Mark that you are now investigating this AssessmentRule."""
        return {"ok": True, **client.start_investigation(assessment_rule_id)}

    def cite_repository_source(path: str, start_line: int, end_line: int) -> dict[str, Any]:
        """Verify a line range in the pinned repository and mint its accepted evidence ID."""
        if not run.pins:
            run.adopt_context(client.context())
        normalized = _repo_path(path)
        if normalized == "." or end_line < start_line:
            return {"ok": False, "code": "INVALID_RANGE"}
        downloaded = run.backend.download_files([f"/{normalized}"])
        item = downloaded[0] if downloaded else None
        content = getattr(item, "content", None)
        if content is None or getattr(item, "error", None):
            return {"ok": False, "code": "FILE_NOT_FOUND", "path": normalized}
        lines = content.decode("utf-8", errors="replace").splitlines()
        if end_line > len(lines):
            return {"ok": False, "code": "RANGE_OUT_OF_BOUNDS", "path": normalized, "lineCount": len(lines)}
        excerpt = "\n".join(lines[start_line - 1 : end_line]).encode("utf-8")
        run.trace.record(
            {"tool": "read_file", "args": {"file_path": normalized}, "resultCount": end_line - start_line + 1, "truncated": False}
        )
        result = client.post_evidence(
            {
                "type": "REPOSITORY_SOURCE",
                "repositoryCommit": run.pins["repositoryCommit"],
                "path": normalized,
                "startLine": start_line,
                "endLine": end_line,
                "excerptSha256": "sha256:" + hashlib.sha256(excerpt).hexdigest(),
            }
        )
        return {"ok": True, "path": normalized, "startLine": start_line, "endLine": end_line, **result}

    def record_search_coverage(
        inspected_entry_points: list[str] | None = None,
        known_gaps: list[str] | None = None,
        direct_source_fallbacks: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        """Record trace-authenticated searches plus Root-authored descriptive coverage caveats."""
        if not run.pins:
            run.adopt_context(client.context())
        entries, dropped_count = run.trace.snapshot_and_reset()
        scopes: dict[tuple[str, str], None] = {}
        queries: list[dict[str, Any]] = []
        read_paths: set[str] = set()
        trace_gaps = list(known_gaps or [])
        if dropped_count:
            trace_gaps.append(
                f"Search trace omitted {dropped_count} tool result(s) after its runtime limit."
            )
        for entry in entries:
            args = entry.get("args") or {}
            tool = entry["tool"]
            if tool in _READ_TOOLS:
                if entry.get("failed"):
                    trace_gaps.append(f"The {tool} read did not return a usable result.")
                    continue
                path = _repo_path(args.get("file_path") or args.get("path"))
                read_paths.add(path)
                scopes[(_SCOPE_FILE, path)] = None
                continue
            if tool in {"ls", "glob", "grep"}:
                scopes[(_SCOPE_DIRECTORY, _repo_path(args.get("path") or args.get("directory") or "."))] = None
            else:
                scopes[(_SCOPE_GRAPH, ".")] = None
            queries.append(
                {
                    "tool": tool,
                    "query": str(args.get("pattern") or args.get("query") or args.get("name_pattern") or entry.get("input") or tool)[:500],
                    "resultCount": int(entry.get("resultCount", 0)),
                    "truncated": bool(entry.get("truncated", False)),
                }
            )
            if entry.get("failed"):
                trace_gaps.append(f"The {tool} search did not return a usable result.")
        entry_points = [_repo_path(p) for p in (inspected_entry_points or []) if _repo_path(p) in read_paths]
        fallbacks = [
            {"path": _repo_path(item.get("path")), "reason": str(item.get("reason") or "direct read")[:500]}
            for item in (direct_source_fallbacks or [])
            if _repo_path(item.get("path")) in read_paths
        ]
        limits = 200
        for label, values in (("scope", list(scopes)), ("query", queries), ("entry point", entry_points), ("direct-source fallback", fallbacks)):
            if len(values) > limits:
                trace_gaps.append(
                    f"Coverage {label} list was capped at {limits} of {len(values)} records."
                )
        if not scopes:
            return {"ok": False, "code": "NO_SEARCH_ACTIVITY", "hint": "Run searches before recording coverage."}
        body = {
            "type": "SEARCH_COVERAGE",
            "repositoryCommit": run.pins["repositoryCommit"],
            "scopes": [{"kind": kind, "path": path} for (kind, path) in list(scopes)[:limits]],
            "queries": queries[:limits],
            "inspectedEntryPoints": entry_points[:limits],
            "knownGaps": [str(g)[:2000] for g in trace_gaps[:limits]],
            "directSourceFallbacks": fallbacks[:limits],
        }
        return {"ok": True, **client.post_evidence(body)}

    def accept_case_fact(kind: str, statement: str, evidence_ids: list[str]) -> dict[str, Any]:
        """Record an evidence-backed fact or the system's use-case description in the assessment case."""
        active_lang = getattr(run, "response_language", "en")
        active_statement = statement
        if active_lang == "vi" and kind in ("USE_CASE", "FACT") and not statement.startswith("```"):
            from orchestration.localization import transform_response_text

            localized_statement, t = transform_response_text(statement, "vi")
            if t.get("status") == "APPLIED":
                active_statement = localized_statement
        result = client.post_fact(
            {
                "expectedCaseRevision": run.case_revision,
                "kind": kind,
                "statement": active_statement,
                "evidenceIds": evidence_ids,
            }
        )
        run.case_revision = int(result["caseRevision"])
        return {"ok": True, **result}

    def _reference(ref: DecisionReference) -> dict[str, Any]:
        if ref.type == "ASSESSMENT_EVIDENCE":
            return {"type": ref.type, "evidenceId": ref.id}
        return {"type": ref.type, "factId": ref.id, "caseRevision": run.case_revision}

    def submit_rule_decision(
        assessment_rule_id: str,
        applicability: str,
        rationale: str,
        legal_context_ids: list[str],
        references: list[dict[str, str]],
        criteria: list[dict[str, Any]] | None = None,
        compliance: str | None = None,
    ) -> dict[str, Any]:
        """Submit your decision for one AssessmentRule. Every semantic choice is yours."""
        if assessment_rule_id not in run.rule_versions:
            run.adopt_context(client.context())
        args = SubmitDecisionArgs.model_validate(
            {
                "assessment_rule_id": assessment_rule_id,
                "applicability": applicability,
                "rationale": rationale,
                "legal_context_ids": legal_context_ids,
                "references": references,
                "criteria": criteria or [],
                "compliance": compliance,
            }
        )
        from orchestration.localization import transform_structured_response

        active_lang = getattr(run, "response_language", "en")
        canonical_narrative = {
            "rationale": args.rationale,
            "criteria": [
                {"criterion_id": c.criterion_id, "rationale": c.rationale}
                for c in args.criteria
            ],
        }
        display_locales: dict[str, Any] = {
            "en": {
                "rationale": args.rationale,
                "criteria": [
                    {"criterionId": c.criterion_id, "rationale": c.rationale}
                    for c in args.criteria
                ],
            }
        }
        localized_narrative, telemetry = transform_structured_response(canonical_narrative, "vi")
        if telemetry.get("status") == "APPLIED":
            display_locales["vi"] = {
                "rationale": localized_narrative["rationale"],
                "criteria": [
                    {"criterionId": item["criterion_id"], "rationale": item["rationale"]}
                    for item in localized_narrative.get("criteria", [])
                ],
            }
        else:
            display_locales["vi"] = display_locales["en"]

        active_rationale = display_locales["vi"]["rationale"] if active_lang == "vi" else args.rationale
        crit_map = {
            item["criterionId"]: item["rationale"]
            for item in (display_locales["vi"]["criteria"] if active_lang == "vi" else display_locales["en"]["criteria"])
        }

        decision = {
            "assessmentRuleId": args.assessment_rule_id,
            "assessmentRuleVersion": run.rule_versions.get(args.assessment_rule_id, ""),
            "scopeId": "ASSESSMENT",
            "ruleSetVersionId": run.pins["ruleSetVersionId"],
            "repositorySnapshotId": run.pins["repositorySnapshotId"],
            "repositoryCommit": run.pins["repositoryCommit"],
            "caseRevision": run.case_revision,
            "legalContextRefs": [{"legalContextId": c} for c in args.legal_context_ids],
            "applicability": args.applicability,
            "rationale": active_rationale,
            "references": [_reference(r) for r in args.references],
            "criteria": [
                {
                    "criterionId": c.criterion_id,
                    "outcome": c.outcome,
                    "rationale": crit_map.get(c.criterion_id, c.rationale),
                    "references": [_reference(r) for r in c.references],
                }
                for c in args.criteria
            ],
            "compliance": args.compliance,
            "sourceLocale": "en",
            "displayLocales": display_locales,
        }
        digest = hashlib.sha256(
            json.dumps(decision, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()[:24]
        request = {
            "expectedDecisionRevision": run.decision_revisions.get(args.assessment_rule_id, 0),
            "idempotencyKey": f"decision:{run.thread_id}:{digest}",
            "decision": decision,
        }
        result = client.post_decision(request)
        run.decision_revisions[args.assessment_rule_id] = int(result["decisionRevision"])
        return {"ok": True, **result}

    def persist_human_request(
        assessment_rule_id: str,
        question: str,
        unresolved_fact: str,
        decision_impact: list[str],
        resolution_attempts: list[str],
        criterion_ids: list[str] | None = None,
        control_type: str = "FREE_TEXT",
        choices: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        from orchestration.localization import transform_structured_response

        active_lang = getattr(run, "response_language", "en")
        canonical_narrative = {
            "question": question,
            "unresolved_fact": unresolved_fact,
            "decision_impact": list(decision_impact),
            "resolution_attempts": list(resolution_attempts),
            "choices": [{"value": c["value"], "label": c.get("label", "")} for c in (choices or [])],
        }
        display_locales: dict[str, Any] = {
            "en": {
                "question": question,
                "unresolvedFact": unresolved_fact,
                "decisionImpact": list(decision_impact),
                "resolutionAttempts": list(resolution_attempts),
                "choices": [{"value": c["value"], "label": c.get("label", "")} for c in (choices or [])],
            }
        }
        localized_narrative, telemetry = transform_structured_response(canonical_narrative, "vi")
        if telemetry.get("status") == "APPLIED":
            display_locales["vi"] = {
                "question": localized_narrative["question"],
                "unresolvedFact": localized_narrative["unresolved_fact"],
                "decisionImpact": localized_narrative["decision_impact"],
                "resolutionAttempts": localized_narrative["resolution_attempts"],
                "choices": localized_narrative["choices"],
            }
        else:
            display_locales["vi"] = display_locales["en"]

        primary = display_locales["vi"] if active_lang == "vi" else display_locales["en"]

        content = {
            "assessmentRuleId": assessment_rule_id,
            "criterionIds": criterion_ids or [],
            "question": primary["question"],
            "unresolvedFact": primary["unresolvedFact"],
            "decisionImpact": primary["decisionImpact"],
            "resolutionAttempts": primary["resolutionAttempts"],
            "controlType": control_type,
            "choices": primary["choices"],
            "sourceLocale": "en",
            "displayLocales": display_locales,
        }
        # Native interrupt replays this tool. Stable server-thread/content identity makes the
        # pre-interrupt request write idempotent across new processes and execution attempts.
        digest = hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()[:32]
        return client.post_human_request({
            **content,
            "expectedCaseRevision": run.case_revision,
            "idempotencyKey": f"human:{run.thread_id}:{digest}",
        })

    def resolved_human_request(result: dict[str, Any]) -> dict[str, Any]:
        # Resume values are not facts: only the authenticated API ledger is authoritative.
        context = client.context()
        run.adopt_context(context)
        if result["requestId"] in context["openHumanRequestIds"]:
            raise RuntimeError("human request resumed without an authoritative resolution")
        return {"ok": True, "requestId": result["requestId"], "caseRevision": run.case_revision,
                "facts": context["facts"], "instruction": "Continue investigation using the accepted facts; re-evaluate stale decisions."}

    def open_human_request(
        assessment_rule_id: str,
        question: str,
        unresolved_fact: str,
        decision_impact: list[str],
        resolution_attempts: list[str],
        criterion_ids: list[str] | None = None,
        control_type: str = "FREE_TEXT",
        choices: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        """Ask the customer a material fact only they can supply, after investigating the sources."""
        result = persist_human_request(assessment_rule_id, question, unresolved_fact,
            decision_impact, resolution_attempts, criterion_ids, control_type, choices)
        interrupt({"requestIds": [result["requestId"]]})
        return resolved_human_request(result)

    def report_human_fact_unresolvable(
        assessment_rule_id: str,
        question: str,
        unresolved_fact: str,
        decision_impact: list[str],
        resolution_attempts: list[str],
        unavailability_rationale: str,
        evidence_ids: list[str],
        criterion_ids: list[str] | None = None,
        control_type: str = "FREE_TEXT",
        choices: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        """Report a material human fact proven permanently unobtainable under the contract; do not submit an unknown verdict."""
        result = persist_human_request(assessment_rule_id, question, unresolved_fact,
            decision_impact, [*resolution_attempts, unavailability_rationale],
            criterion_ids, control_type, choices)
        # A later valid answer replays this native tool. Resolution is server-owned and must
        # clear the old dependency instead of reapplying the historical blocker claim.
        context = client.context()
        run.adopt_context(context)
        if result["requestId"] in context["openHumanRequestIds"]:
            pending: dict[str, Any] = {"requestIds": [result["requestId"]]}
            active_lang = getattr(run, "response_language", "en")
            active_rationale = unavailability_rationale
            if active_lang == "vi":
                from orchestration.localization import transform_response_text

                localized, t = transform_response_text(unavailability_rationale, "vi")
                if t.get("status") == "APPLIED":
                    active_rationale = localized
            try:
                client.report_unresolvable_human_fact({
                    "humanResolutionRequestId": result["requestId"],
                    "expectedCaseRevision": run.case_revision,
                    "expectedRequestRevision": result["requestRevision"],
                    "rationale": active_rationale,
                    "evidenceIds": sorted(set(evidence_ids)),
                })
            except Exception as error:  # The durable question still requires a native checkpoint.
                pending["claimRejected"] = {"code": error.code if isinstance(error, AssessmentApiError) else type(error).__name__}
            interrupt(pending)
        return resolved_human_request(result)

    def request_finalization() -> dict[str, Any]:
        """Ask the mechanical Completion Gate to inventory blockers and enter FINALIZING when none remain."""
        return {"ok": True, **client.request_finalization()}

    def submit_final_report(summary: str, findings: list[dict[str, Any]]) -> dict[str, Any]:
        """Submit Root-authored report narrative; the API binds accepted decisions, pins and provenance."""
        args = SubmitFinalReportArgs.model_validate(
            {"summary": summary, "findings": findings}
        )
        from orchestration.localization import transform_structured_response

        active_lang = getattr(run, "response_language", "en")
        canonical_narrative = {
            "summary": args.summary,
            "findings": [
                {
                    "assessment_rule_id": f.assessment_rule_id,
                    "summary": f.summary,
                    "recommendations": list(f.recommendations),
                }
                for f in args.findings
            ],
        }
        display_locales: dict[str, Any] = {
            "en": {
                "summary": args.summary,
                "findings": [
                    {
                        "assessmentRuleId": f.assessment_rule_id,
                        "summary": f.summary,
                        "recommendations": list(f.recommendations),
                    }
                    for f in args.findings
                ],
            }
        }
        localized_narrative, telemetry = transform_structured_response(canonical_narrative, "vi")
        if telemetry.get("status") == "APPLIED":
            display_locales["vi"] = {
                "summary": localized_narrative["summary"],
                "findings": [
                    {
                        "assessmentRuleId": f.get("assessment_rule_id", ""),
                        "summary": f.get("summary", ""),
                        "recommendations": list(f.get("recommendations", [])),
                    }
                    for f in localized_narrative.get("findings", [])
                ],
            }
        else:
            display_locales["vi"] = display_locales["en"]

        active_summary = display_locales["vi"]["summary"] if active_lang == "vi" else args.summary
        finding_map = {
            f["assessmentRuleId"]: f
            for f in (display_locales["vi"]["findings"] if active_lang == "vi" else display_locales["en"]["findings"])
        }

        result = client.post_final_report(
            {
                "kind": "FINAL_REPORT",
                "summary": active_summary,
                "sourceLocale": "en",
                "displayLocales": display_locales,
                "findings": [
                    {
                        "assessmentRuleId": finding.assessment_rule_id,
                        "summary": finding_map.get(finding.assessment_rule_id, {}).get("summary", finding.summary),
                        "recommendations": finding_map.get(finding.assessment_rule_id, {}).get("recommendations", finding.recommendations),
                    }
                    for finding in args.findings
                ],
            }
        )
        return {"ok": True, **result}

    def tool(func, schema: type[BaseModel] | None, name: str) -> StructuredTool:
        return StructuredTool.from_function(
            func=_guard(func),
            name=name,
            description=(func.__doc__ or name).strip(),
            args_schema=schema,
            infer_schema=schema is None,
            handle_validation_error=_validation_feedback,
        )

    class _NoArgs(_Args):
        pass

    return [
        retrieve_shared_heuristics,
        tool(get_assessment_context, _NoArgs, "get_assessment_context"),
        tool(get_pinned_rule_set, _NoArgs, "get_pinned_rule_set"),
        tool(get_assessment_rule, GetRuleArgs, "get_assessment_rule"),
        tool(start_rule_investigation, StartInvestigationArgs, "start_rule_investigation"),
        tool(cite_repository_source, CiteRepositorySourceArgs, "cite_repository_source"),
        tool(record_search_coverage, RecordSearchCoverageArgs, "record_search_coverage"),
        tool(accept_case_fact, AcceptFactArgs, "accept_case_fact"),
        tool(submit_rule_decision, SubmitDecisionArgs, "submit_rule_decision"),
        tool(open_human_request, OpenHumanRequestArgs, "open_human_request"),
        tool(report_human_fact_unresolvable, ReportUnresolvableHumanFactArgs, "report_human_fact_unresolvable"),
        tool(request_finalization, _NoArgs, "request_finalization"),
        tool(submit_final_report, SubmitFinalReportArgs, "submit_final_report"),
    ]


ROOT_TOOL_NAMES = (
    "retrieve_shared_heuristics",
    "get_assessment_context",
    "get_pinned_rule_set",
    "get_assessment_rule",
    "start_rule_investigation",
    "cite_repository_source",
    "record_search_coverage",
    "accept_case_fact",
    "submit_rule_decision",
    "open_human_request",
    "report_human_fact_unresolvable",
    "request_finalization",
    "submit_final_report",
)


def new_child_execution_id() -> str:
    return str(uuid.uuid4())
