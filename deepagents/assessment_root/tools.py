"""Governed tools of the Assessment Root.

The model supplies only semantic content (what it found, what it decided, what it asks). Identity,
thread, execution, lease, pins, versions, hashes and idempotency keys are bound here from server
state and never appear in a tool schema. The API validates every packet; a rejection is returned
to the model as structured, scalar feedback so it can correct itself, never raised as a crash.
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
import uuid
from dataclasses import dataclass, field, fields
from typing import Any, Literal

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, ConfigDict, Field

from assessment_root.client import AssessmentApiError, AssessmentRuntimeClient

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


class SearchTrace(BaseCallbackHandler):
    """Records what the Root and its task descendants actually executed.

    Search-coverage evidence is built from this runtime-authenticated trace, never from text the
    model typed, so an agent cannot claim to have searched somewhere it did not.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._open: dict[str, dict[str, Any]] = {}
        self.entries: list[dict[str, Any]] = []

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
            if entry is None or len(self.entries) >= _MAX_TRACE:
                return
            text = str(getattr(output, "content", output) or "")
            entry["resultCount"] = len([line for line in text.splitlines() if line.strip()])
            entry["truncated"] = "truncat" in text.lower()
            self.entries.append(entry)

    def snapshot_and_reset(self) -> list[dict[str, Any]]:
        with self._lock:
            taken, self.entries = self.entries, []
            return taken


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

    def adopt_context(self, context: dict[str, Any]) -> None:
        self.case_revision = int(context["caseRevision"])
        self.pins = {
            "legalPortfolioVersionId": context["legalPortfolioVersionId"],
            "repositorySnapshotId": context["repositorySnapshotId"],
            "repositoryCommit": context["repositoryCommit"],
        }
        for row in context.get("coverage", []):
            self.decision_revisions[row["engineeringRuleId"]] = int(row["decisionRevision"])
            self.rule_versions[row["engineeringRuleId"]] = row["engineeringRuleVersion"]


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
        default_factory=list, description="What this search could NOT cover or could not rule out."
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
    engineering_rule_id: str


class GetRuleArgs(_Args):
    engineering_rule_id: str


class DecisionReference(_Args):
    type: Literal["ASSESSMENT_EVIDENCE", "CONFIRMED_FACT"]
    id: str = Field(description="evidenceId or factId returned by the governed tools.")


class CriterionDecisionArgs(_Args):
    criterion_id: str
    outcome: Literal["MET", "NOT_MET"]
    rationale: str = Field(min_length=1)
    references: list[DecisionReference] = Field(min_length=1)


class SubmitDecisionArgs(_Args):
    engineering_rule_id: str
    applicability: Literal["APPLICABLE", "NOT_APPLICABLE"]
    rationale: str = Field(min_length=1)
    legal_context_ids: list[str] = Field(min_length=1, description="LegalRule IDs relied on.")
    references: list[DecisionReference] = Field(min_length=1)
    criteria: list[CriterionDecisionArgs] = Field(
        default_factory=list, description="Every criterion, when APPLICABLE; empty when NOT_APPLICABLE."
    )
    compliance: Literal["COMPLIANT", "NON_COMPLIANT"] | None = None


class OpenHumanRequestArgs(_Args):
    engineering_rule_id: str
    criterion_ids: list[str] = Field(default_factory=list)
    question: str = Field(min_length=1, description="Customer-safe wording; no file paths, hashes or internal IDs.")
    unresolved_fact: str = Field(min_length=1)
    decision_impact: list[str] = Field(min_length=1)
    resolution_attempts: list[str] = Field(min_length=1, description="How you already tried to settle it from sources.")
    control_type: str = "FREE_TEXT"
    choices: list[dict[str, str]] = Field(default_factory=list, description="[{value, label}] when a fixed set applies.")


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
                    "engineeringRuleId": row["engineeringRuleId"],
                    "engineeringRuleVersion": row["engineeringRuleVersion"],
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

    def get_pinned_portfolio() -> dict[str, Any]:
        """List every EngineeringRule of the immutable portfolio pinned to this assessment."""
        portfolio = client.portfolio()
        for rule in portfolio["engineeringRules"]:
            run.rule_versions[rule["engineeringRuleId"]] = rule["engineeringRuleVersion"]
            run.rule_criteria[rule["engineeringRuleId"]] = [
                c["criterionId"] for c in rule.get("criteria", [])
            ]
        return {
            "ok": True,
            "portfolioVersionId": portfolio["portfolioVersionId"],
            "legalRuleCount": len(portfolio["legalRules"]),
            "engineeringRules": [
                {
                    "engineeringRuleId": rule["engineeringRuleId"],
                    "engineeringRuleVersion": rule["engineeringRuleVersion"],
                    "concept": rule["concept"],
                    "legalRuleIds": rule["legalRuleIds"],
                    "criterionIds": [c["criterionId"] for c in rule.get("criteria", [])],
                }
                for rule in portfolio["engineeringRules"]
            ],
        }

    def get_engineering_rule(engineering_rule_id: str) -> dict[str, Any]:
        """Full text of one EngineeringRule, its linked LegalRules and their context relations."""
        portfolio = client.portfolio()
        rule = next(
            (r for r in portfolio["engineeringRules"] if r["engineeringRuleId"] == engineering_rule_id),
            None,
        )
        if rule is None:
            return {"ok": False, "code": "RULE_NOT_IN_PORTFOLIO"}
        linked = set(rule["legalRuleIds"])
        relations = [r for r in portfolio["contextRelations"] if r["fromLegalRuleId"] in linked]
        related = {r["toLegalRuleId"] for r in relations if r.get("toLegalRuleId")}
        return {
            "ok": True,
            "engineeringRule": rule,
            "legalRules": [
                lr for lr in portfolio["legalRules"] if lr["legalRuleId"] in linked | related
            ],
            "contextRelations": relations,
        }

    def start_rule_investigation(engineering_rule_id: str) -> dict[str, Any]:
        """Mark that you are now investigating this EngineeringRule."""
        return {"ok": True, **client.start_investigation(engineering_rule_id)}

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
        run.trace.entries.append(
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
        """Record what the searches you ran since the last record actually covered (runtime-authenticated)."""
        if not run.pins:
            run.adopt_context(client.context())
        entries = run.trace.snapshot_and_reset()
        scopes: dict[tuple[str, str], None] = {}
        queries: list[dict[str, Any]] = []
        read_paths: set[str] = set()
        for entry in entries:
            args = entry.get("args") or {}
            tool = entry["tool"]
            if tool in _READ_TOOLS:
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
        entry_points = [_repo_path(p) for p in (inspected_entry_points or []) if _repo_path(p) in read_paths]
        fallbacks = [
            {"path": _repo_path(item.get("path")), "reason": str(item.get("reason") or "direct read")[:500]}
            for item in (direct_source_fallbacks or [])
            if _repo_path(item.get("path")) in read_paths
        ]
        if not scopes:
            return {"ok": False, "code": "NO_SEARCH_ACTIVITY", "hint": "Run searches before recording coverage."}
        body = {
            "type": "SEARCH_COVERAGE",
            "repositoryCommit": run.pins["repositoryCommit"],
            "scopes": [{"kind": kind, "path": path} for (kind, path) in scopes],
            "queries": queries[:200],
            "inspectedEntryPoints": entry_points,
            "knownGaps": [str(g)[:2000] for g in (known_gaps or [])],
            "directSourceFallbacks": fallbacks,
        }
        return {"ok": True, **client.post_evidence(body)}

    def accept_case_fact(kind: str, statement: str, evidence_ids: list[str]) -> dict[str, Any]:
        """Record an evidence-backed fact or the system's use-case description in the assessment case."""
        result = client.post_fact(
            {
                "expectedCaseRevision": run.case_revision,
                "kind": kind,
                "statement": statement,
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
        engineering_rule_id: str,
        applicability: str,
        rationale: str,
        legal_context_ids: list[str],
        references: list[dict[str, str]],
        criteria: list[dict[str, Any]] | None = None,
        compliance: str | None = None,
    ) -> dict[str, Any]:
        """Submit your decision for one EngineeringRule. Every semantic choice is yours."""
        if engineering_rule_id not in run.rule_versions:
            run.adopt_context(client.context())
        args = SubmitDecisionArgs.model_validate(
            {
                "engineering_rule_id": engineering_rule_id,
                "applicability": applicability,
                "rationale": rationale,
                "legal_context_ids": legal_context_ids,
                "references": references,
                "criteria": criteria or [],
                "compliance": compliance,
            }
        )
        decision = {
            "engineeringRuleId": args.engineering_rule_id,
            "engineeringRuleVersion": run.rule_versions.get(args.engineering_rule_id, ""),
            "scopeId": "ASSESSMENT",
            "legalPortfolioVersionId": run.pins["legalPortfolioVersionId"],
            "repositorySnapshotId": run.pins["repositorySnapshotId"],
            "repositoryCommit": run.pins["repositoryCommit"],
            "caseRevision": run.case_revision,
            "legalContextRefs": [{"legalContextId": c} for c in args.legal_context_ids],
            "applicability": args.applicability,
            "rationale": args.rationale,
            "references": [_reference(r) for r in args.references],
            "criteria": [
                {
                    "criterionId": c.criterion_id,
                    "outcome": c.outcome,
                    "rationale": c.rationale,
                    "references": [_reference(r) for r in c.references],
                }
                for c in args.criteria
            ],
            "compliance": args.compliance,
        }
        digest = hashlib.sha256(
            json.dumps(decision, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()[:24]
        request = {
            "expectedDecisionRevision": run.decision_revisions.get(args.engineering_rule_id, 0),
            "idempotencyKey": f"{run.execution_id}:{args.engineering_rule_id}:{digest}",
            "decision": decision,
        }
        result = client.post_decision(request)
        run.decision_revisions[args.engineering_rule_id] = int(result["decisionRevision"])
        return {"ok": True, **result}

    def open_human_request(
        engineering_rule_id: str,
        question: str,
        unresolved_fact: str,
        decision_impact: list[str],
        resolution_attempts: list[str],
        criterion_ids: list[str] | None = None,
        control_type: str = "FREE_TEXT",
        choices: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        """Ask the customer a material fact only they can supply, after investigating the sources."""
        result = client.post_human_request(
            {
                "engineeringRuleId": engineering_rule_id,
                "criterionIds": criterion_ids or [],
                "question": question,
                "unresolvedFact": unresolved_fact,
                "decisionImpact": decision_impact,
                "resolutionAttempts": resolution_attempts,
                "controlType": control_type,
                "choices": choices or [],
                "expectedCaseRevision": run.case_revision,
            }
        )
        return {
            "ok": True,
            "waiting": True,
            "instruction": "The assessment is now waiting for the customer. Stop and end your turn.",
            **result,
        }

    def tool(func, schema: type[BaseModel] | None, name: str) -> StructuredTool:
        return StructuredTool.from_function(
            func=_guard(func),
            name=name,
            description=(func.__doc__ or name).strip(),
            args_schema=schema,
            infer_schema=schema is None,
        )

    class _NoArgs(_Args):
        pass

    return [
        tool(get_assessment_context, _NoArgs, "get_assessment_context"),
        tool(get_pinned_portfolio, _NoArgs, "get_pinned_portfolio"),
        tool(get_engineering_rule, GetRuleArgs, "get_engineering_rule"),
        tool(start_rule_investigation, StartInvestigationArgs, "start_rule_investigation"),
        tool(cite_repository_source, CiteRepositorySourceArgs, "cite_repository_source"),
        tool(record_search_coverage, RecordSearchCoverageArgs, "record_search_coverage"),
        tool(accept_case_fact, AcceptFactArgs, "accept_case_fact"),
        tool(submit_rule_decision, SubmitDecisionArgs, "submit_rule_decision"),
        tool(open_human_request, OpenHumanRequestArgs, "open_human_request"),
    ]


ROOT_TOOL_NAMES = (
    "get_assessment_context",
    "get_pinned_portfolio",
    "get_engineering_rule",
    "start_rule_investigation",
    "cite_repository_source",
    "record_search_coverage",
    "accept_case_fact",
    "submit_rule_decision",
    "open_human_request",
)


def new_child_execution_id() -> str:
    return str(uuid.uuid4())
