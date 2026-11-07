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
from tools.common.capabilities.platform.repository_sandbox import (
    source_path_in_scope,
    validate_source_path_prefix,
)

# Native/search tool names whose executions authenticate a search-coverage record.
_SEARCH_TOOLS = {"ls", "glob", "grep", "search_code_graph", "trace_call_path", "search_code_text", "get_repository_architecture"}
_READ_TOOLS = {"read_file"}
_SCOPE_DIRECTORY = "SOURCE_DIRECTORY"
_SCOPE_FILE = "SOURCE_FILE"
_SCOPE_GRAPH = "GRAPH_INDEX"
_MAX_TRACE = 400
_COVERAGE_DEFAULT_PAGE_SIZE = 10
_COVERAGE_MAX_PAGE_SIZE = 25
_CONTEXT_DEFAULT_PAGE_SIZE = 5
_CONTEXT_MAX_PAGE_SIZE = 10
_CONTEXT_DETAIL_MAX_BYTES = 4096
_RULE_DETAIL_MAX_BYTES = 4096
_RULE_CATALOG_MAX_BYTES = 4096
_RULE_DETAIL_MAX_POINTER = 512


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
    audit_request: dict[str, Any] | None = None
    pins: dict[str, str] = field(default_factory=dict)
    source_path_prefix: str | None = None
    decision_revisions: dict[str, int] = field(default_factory=dict)
    rule_versions: dict[str, str] = field(default_factory=dict)
    rule_criteria: dict[str, list[str]] = field(default_factory=dict)
    # (legalRequirementId, kind, index) -> legal source text, per rule, for anchoring findings and questions.
    rule_elements: dict[str, dict[tuple[str, str, int], str]] = field(default_factory=dict)
    response_language: str = "en"
    human_answer_review_checkpoint_id: str | None = None
    human_answer_review_request_ids: set[str] = field(default_factory=set)

    def authorize_human_answer_review(self, claim: dict[str, Any], context: dict[str, Any]) -> bool:
        """Business purpose: Permit investigation of unknown human responses without accepting them as case facts.

        Business rules:
        - Only an explicit server claim authorizes review on its exact human-wait checkpoint.
        - Every open request must have a latest unknown answer bound to that checkpoint and no resolved fact.
        Execution flow:
        1. Clear prior local review authority and inspect the server claim.
        2. Validate every open dependency against the authoritative request and answer audit.
        3. Retain only those request identities and the bound checkpoint for this execution.
        Failure cases:
        - Missing authorization returns false; incomplete or mismatched review authority raises before graph resume.
        Side effects:
        - Updates execution-local review authority only; creates no fact, answer, decision or lifecycle transition.
        """
        self.human_answer_review_checkpoint_id = None
        self.human_answer_review_request_ids = set()
        if claim.get("humanAnswerReviewRequired") is not True:
            return False
        checkpoint = claim.get("resumeCheckpointId")
        request_ids = set(context["openHumanRequestIds"])
        rows = {row["requestId"]: row for row in context.get("humanRequests", [])}
        if not isinstance(checkpoint, str) or not checkpoint or not request_ids or context["lifecycleState"] != "WAITING_FOR_HUMAN":
            raise RuntimeError("human answer review lacks bound human-wait authority")
        for request_id in request_ids:
            row = rows.get(request_id)
            answers = row.get("answers", []) if row else []
            latest = answers[-1] if answers else {}
            if (not row or row.get("status") != "OPEN" or row.get("resolvedFactId") is not None
                    or latest.get("doesNotKnow") is not True or latest.get("answer") is not None
                    or latest.get("checkpointId") != checkpoint or row.get("checkpointId") != checkpoint
                    or latest.get("requestRevision") != row.get("requestRevision")):
                raise RuntimeError("human answer review does not match every latest unknown response")
        self.human_answer_review_checkpoint_id = checkpoint
        self.human_answer_review_request_ids = request_ids
        return True

    def adopt_context(self, context: dict[str, Any]) -> None:
        """Business purpose: Bind one leased Root to the latest server-owned scope and decision revision.

        Business rules:
        - Selected rule IDs and pins come only from API context; previous model memory grants no scope.
        - Only initially absent/null audit metadata retains legacy full-rule scope; malformed or disappearing bound authority fails closed.
        - Missing source prefix retains the full repository; an adopted prefix is immutable within this execution.
        Execution flow:
        1. Validate current request identity, explicit selection and optional source prefix, then save case revision and request.
        2. Bind pins and covered rule versions.
        3. Resolve response language.
        Failure cases:
        - Missing pins, malformed request metadata or revision, and a changed source prefix fail before further retrieval.
        Side effects:
        - Updates this run's in-memory caches only; no persisted audit record changes.
        """
        audit_request = context.get("auditRequest")
        if self.audit_request is not None and audit_request is None:
            raise RuntimeError("audit request scope disappeared within the Root execution")
        if audit_request is not None:
            if (not isinstance(audit_request, dict)
                    or not isinstance(audit_request.get("requestId"), str) or not audit_request["requestId"]
                    or audit_request.get("scopeMode") not in {"SELECTED_RULES", "FULL_RULE_SET"}
                    or not isinstance(audit_request.get("status"), str) or not audit_request["status"]
                    or not isinstance(audit_request.get("selectedRuleIds"), list) or not audit_request["selectedRuleIds"]
                    or any(not isinstance(rule_id, str) or not rule_id for rule_id in audit_request["selectedRuleIds"])):
                raise RuntimeError("audit request metadata does not define an authorized rule scope")
        source_path_prefix = validate_source_path_prefix(context.get("sourcePathPrefix"))
        if self.pins and self.source_path_prefix != source_path_prefix:
            raise RuntimeError("assessment source scope changed within the Root execution")
        self.source_path_prefix = source_path_prefix
        self.case_revision = int(context["caseRevision"])
        self.audit_request = audit_request
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


class GetPinnedRuleSetArgs(_Args):
    offset: int = Field(default=0, ge=0, description="Catalog offset; follow nextOffset until null to discover every rule.")
    limit: int = Field(default=10, ge=1, le=50, description="Maximum summaries requested; the response byte bound may return fewer. Follow actual nextOffset and use get_assessment_rule for full details.")


class GetAssessmentRuleDetailArgs(GetRuleArgs):
    detail_token: str = Field(pattern=r"^[0-9a-f]{64}$", description="detailToken returned by an oversized get_assessment_rule result.")
    pointer: str = Field(default="", max_length=_RULE_DETAIL_MAX_POINTER, description="Exact JSON pointer from a detail index; empty selects the complete rule payload.")
    offset: int = Field(default=0, ge=0, description="Follow nextOffset: entry index for indexes, Unicode code-point index for fragments.")
    max_items: int = Field(default=10, ge=1, le=20, description="Maximum direct entries/items; nested VALUE content remains subject to the response byte bound.")
    max_chars: int = Field(default=2000, ge=1, le=4000, description="Maximum Unicode code points for a direct string or JSON fragment; the response byte bound may shorten the page.")


class GetAssessmentCoverageArgs(_Args):
    snapshot_token: str = Field(
        pattern=r"^[0-9a-f]{64}$",
        description="coverageSummary.snapshotToken from get_assessment_context; a stale snapshot must be reloaded.",
    )
    offset: int = Field(default=0, ge=0, description="Start at zero, then follow nextOffset until null for complete coverage.")
    limit: int = Field(
        default=_COVERAGE_DEFAULT_PAGE_SIZE, ge=1, le=_COVERAGE_MAX_PAGE_SIZE,
        description="Maximum coverage rows in this page; partial pages never establish assessment completion.",
    )


class GetAssessmentContextPageArgs(_Args):
    snapshot_token: str = Field(
        pattern=r"^[0-9a-f]{64}$",
        description="contextCollections.snapshotToken from get_assessment_context; reload context when stale.",
    )
    collection: Literal["facts", "evidence", "humanRequests", "openHumanRequestIds"]
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=_CONTEXT_DEFAULT_PAGE_SIZE, ge=1, le=_CONTEXT_MAX_PAGE_SIZE)


class GetAssessmentContextDetailArgs(_Args):
    snapshot_token: str = Field(pattern=r"^[0-9a-f]{64}$")
    collection: Literal["facts", "evidence", "humanRequests"]
    index: int = Field(ge=0, description="detailIndex returned by get_assessment_context_page.")
    pointer: str = Field(default="", max_length=_RULE_DETAIL_MAX_POINTER)
    offset: int = Field(default=0, ge=0)
    max_items: int = Field(default=10, ge=1, le=20)
    max_chars: int = Field(default=2000, ge=1, le=4000)


class GetRuleDecisionArgs(GetRuleArgs):
    revision: int | None = Field(default=None, ge=0, description="Exact historical decision revision; omit for the newest packet.")


class DecisionReference(_Args):
    type: Literal["ASSESSMENT_EVIDENCE", "CONFIRMED_FACT"]
    id: str = Field(description="evidenceId or factId returned by the governed tools.")


class CriterionDecisionArgs(_Args):
    criterion_id: str
    outcome: Literal["MET", "NOT_MET"]
    rationale: str = Field(min_length=1)
    references: list[DecisionReference] = Field(min_length=1)


class ApplicabilityBasisArgs(_Args):
    legal_requirement_id: str = Field(description="LegalRequirement that states the element.")
    kind: Literal["OPERATIVE_SCOPE", "APPLICABILITY_CONDITION", "QUALIFIER", "EXCEPTION"]
    index: int = Field(ge=0, description="Position of the element in that list, as returned by get_assessment_rule.")
    finding: Literal["ESTABLISHED", "REFUTED", "NOT_ESTABLISHED"] = Field(
        description=(
            "ESTABLISHED requires affirmative support for the element. REFUTED requires an affirmative counterfact "
            "that makes the element false; absence of proof, unknown operations or an unverified deployment are "
            "NOT_ESTABLISHED, never REFUTED. A fact about the benchmark tester does not establish who operates "
            "the assessed software or that no operator exists."
        )
    )
    rationale: str = Field(min_length=1, description="Why the cited evidence/facts bear on THIS element of THIS rule.")
    references: list[DecisionReference] = Field(
        default_factory=list, description="Evidence/facts behind an ESTABLISHED or REFUTED finding."
    )


class ConditionRefArgs(_Args):
    legal_requirement_id: str
    kind: Literal["OPERATIVE_SCOPE", "APPLICABILITY_CONDITION", "QUALIFIER", "EXCEPTION"]
    index: int = Field(ge=0)


class ReadLegalSourceArgs(_Args):
    document_id: str = Field(description="documentId of a provision, as listed in the rule's legalSources.")
    locator: str = Field(description="locator of that provision.")


class SearchLegalSourceArgs(_Args):
    query: str = Field(min_length=2, max_length=200, description="Words that must all occur in the provision text.")


class SubmitDecisionArgs(_Args):
    assessment_rule_id: str
    applicability: Literal["APPLICABLE", "NOT_APPLICABLE"]
    rationale: str = Field(min_length=1)
    legal_context_ids: list[str] = Field(min_length=1, description="LegalRequirement IDs relied on.")
    references: list[DecisionReference] = Field(min_length=1)
    applicability_basis: list[ApplicabilityBasisArgs] = Field(
        default_factory=list,
        description=(
            "Findings for every OPERATIVE_SCOPE (actor, regulated activity and inherited legal scope), plus the conditions, qualifiers and exceptions the linked "
            "requirements state. NOT_APPLICABLE needs an ESTABLISHED exception or a REFUTED condition, with references; "
            "APPLICABLE needs every operative scope ESTABLISHED and no refuting element. UNCONDITIONAL never establishes an actor or deployment. "
            "Technical capability does not establish actual operations. Unknown operations do not establish their absence. "
            "NOT_ESTABLISHED never supports either verdict; keep the assessment unresolved instead."
        ),
    )
    criteria: list[CriterionDecisionArgs] = Field(
        default_factory=list, description="Every criterion, when APPLICABLE; empty when NOT_APPLICABLE."
    )
    compliance: Literal["COMPLIANT", "NON_COMPLIANT"] | None = None


class HumanRequestDependencyArgs(_Args):
    assessment_rule_id: str
    criterion_ids: list[str] = Field(default_factory=list)


class ReportExistingUnresolvableHumanFactArgs(_Args):
    request_id: str = Field(min_length=1, description="Existing requestId from governed humanRequests context.")
    unavailability_rationale: str = Field(min_length=1, description="Why accepted evidence proves permanent unavailability; UNKNOWN alone is insufficient.")
    evidence_ids: list[str] = Field(min_length=1, description="Accepted evidence supporting permanent unavailability.")


class OpenHumanRequestArgs(_Args):
    assessment_rule_id: str
    criterion_ids: list[str] = Field(default_factory=list)
    dependencies: list[HumanRequestDependencyArgs] = Field(default_factory=list, description="Other rule/criterion dependencies on this same material fact.")
    source_request_id: str | None = Field(default=None, description="Explicit existing request identity for server-validated sharing of the exact same fact.")
    question: str = Field(min_length=1, description="Customer-safe wording; no file paths, hashes or internal IDs.")
    unresolved_fact: str = Field(min_length=1)
    decision_impact: list[str] = Field(min_length=1)
    resolution_attempts: list[str] = Field(min_length=1, description="How you already tried to settle it from sources.")
    control_type: str = "FREE_TEXT"
    choices: list[dict[str, str]] = Field(default_factory=list, description="[{value, label}] when a fixed set applies.")
    condition_ref: ConditionRefArgs | None = Field(
        default=None,
        description=(
            "The source-stated element of this rule the fact bears on. A request needs this or criterion_ids: "
            "ask for a fact that settles that element, never for a legal verdict."
        ),
    )


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


# The three lists of a LegalRequirement that state, in the legal source's own words, when a duty reaches a system.
_ELEMENT_LISTS = (
    ("APPLICABILITY_CONDITION", "applicabilityConditions"),
    ("QUALIFIER", "qualifiers"),
    ("EXCEPTION", "exceptions"),
)


def _applicability_elements(requirements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Business purpose: Address every source-stated applicability element using the identifiers enforced by the decision API.

    Business rules:
    - Preserve each linked requirement, element kind and original zero-based position; do not infer applicability.
    - Operative scope exposes the pinned actor/action rather than treating UNCONDITIONAL as proof of an operator.
    Execution flow:
    1. Enumerate the configured source element lists and operative propositions for each linked requirement.
    2. Return their exact text together with requirement, kind and index.
    Failure cases:
    - Absent element lists produce no entries; malformed required identities propagate to the caller.
    Side effects:
    - Pure projection; no facts, applicability findings or decisions are persisted.
    """
    listed = [
        {"legalRequirementId": requirement["legalRequirementId"], "kind": kind, "index": index, "text": text}
        for requirement in requirements
        for kind, key in _ELEMENT_LISTS
        for index, text in enumerate(requirement.get(key) or [])
    ]
    return listed + [
        {"legalRequirementId": requirement["legalRequirementId"], "kind": "OPERATIVE_SCOPE", "index": index,
         "text": (f"Actor: {operative['actor']}\nOperative provision: {operative['action']}\n"
                  "Establish the addressee and regulated factual scope, not fulfillment of this duty; assess fulfillment in criteria."),
         "sourceRefs": operative.get("sourceRefs", [])}
        for requirement in requirements
        for index, operative in enumerate(requirement.get("operativePropositions") or [])
    ]


def _source_evidence_path(run: RootRun, value: Any) -> str | None:
    """Business purpose: Bind a source observation to the selected repository path without aliases.

    Business rules:
    - Scoped evidence permits the native virtual leading slash but no other path rewriting.
    - Legacy full-repository runs retain their existing path interpretation.

    Execution flow:
    1. Obtain the repository-relative path used by the evidence API.
    2. Verify scoped input is canonical and lies within the immutable selected prefix.

    Failure cases:
    - Out-of-scope or ambiguous scoped input returns none before source I/O or evidence creation.

    Side effects:
    - Pure validation; creates no source read, search trace or accepted evidence.
    """
    normalized = _repo_path(value)
    if run.source_path_prefix is None:
        return normalized
    literal = value[1:] if isinstance(value, str) and value.startswith("/") else value
    if literal != normalized or not source_path_in_scope(normalized, run.source_path_prefix):
        return None
    return normalized


def _repository_view(run: RootRun) -> dict[str, Any]:
    """Business purpose:
    Disclose the pinned sandbox's source limitations before the investigator reasons from absence.

    Business rules:
    - Only runtime metadata matching this assessment, snapshot, commit and source scope describes its source view.
    - A scoped run requires matching coverage metadata; unavailable metadata never authorizes a wider source view.
    - Missing coverage metadata leaves completeness unknown and never establishes missing implementation.

    Execution flow:
    1. Read the runtime-owned repository marker through the current filesystem backend.
    2. Verify its assessment and immutable source pins before exposing coverage metadata.
    3. Return an explicit unknown limitation when the marker or its coverage record is unavailable.

    Failure cases:
    - Malformed metadata or conflicting source pins reject the context rather than expose another source view.

    Side effects:
    - Read-only sandbox access; does not create assessment evidence or choose any compliance outcome.
    """
    unavailable = {"coverageLimited": None, "reason": "RUNTIME_VIEW_METADATA_UNAVAILABLE"}
    files = run.backend.download_files(["/.lcsp/repository.json"])
    if not files or files[0].error or files[0].content is None:
        if run.source_path_prefix is not None:
            raise RuntimeError("scoped repository view metadata is unavailable")
        return unavailable
    marker = json.loads(files[0].content)
    expected = {"assessmentId": run.assessment_id, "snapshotId": run.pins["repositorySnapshotId"],
                "commitSha": run.pins["repositoryCommit"], "sourcePathPrefix": run.source_path_prefix}
    if not isinstance(marker, dict) or any(marker.get(key) != value for key, value in expected.items()):
        raise RuntimeError("repository view pins do not match the assessment")
    coverage = marker.get("sourceCoverage")
    if isinstance(coverage, dict):
        if validate_source_path_prefix(coverage.get("sourcePathPrefix")) != run.source_path_prefix:
            raise RuntimeError("repository coverage scope does not match the assessment")
        if run.source_path_prefix is not None:
            # Intentional exclusions establish the boundary, not facts about sibling projects.
            return {key: value for key, value in coverage.items()
                    if key not in {"sourceScopeExcludedEntries", "sourceScopeExclusionsTruncated"}}
        return coverage
    if run.source_path_prefix is not None:
        raise RuntimeError("scoped repository coverage metadata is unavailable")
    return unavailable


def _legal_sources(rule: dict[str, Any], requirements: list[dict[str, Any]], relations: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Business purpose: Give the investigator the pinned provisions supporting a rule and its legal context.

    Business rules:
    - Deduplicate by document and locator while retaining the first origin; a relation citation is context, not a new duty.
    Execution flow:
    1. Collect rule citations, linked requirement citations and relation targets in order.
    2. Return the unique document/locator pairs and their source origin.
    Failure cases:
    - Missing optional citation lists are empty; malformed supplied source records are not fabricated.
    Side effects:
    - Read-only projection; does not fetch legal text or change Rule Set authority.
    """
    found: dict[tuple[str, str], str] = {}
    for origin, sources in (
        ("RULE", rule.get("sources") or []),
        *[("REQUIREMENT", requirement.get("sources") or []) for requirement in requirements],
        ("RELATION", [r["toSourceRef"] for r in relations if r.get("toSourceRef")]),
    ):
        for source in sources:
            found.setdefault((source["documentId"], source["locator"]), origin)
    return [{"documentId": doc, "locator": loc, "origin": origin} for (doc, loc), origin in found.items()]


def _guard(call):
    def run(*args: Any, **kwargs: Any) -> str:
        try:
            return json.dumps(call(*args, **kwargs), ensure_ascii=False, default=str)
        except AssessmentApiError as error:
            return json.dumps(_failure(error), ensure_ascii=False)

    return run


def _context_collections(context: dict[str, Any]) -> dict[str, list[Any]]:
    """Business purpose: Project model-readable context collections without changing API authority.
    Business rules:
    - Facts preserve authority; evidence payloads and human history remain exact but are not returned inline.
    Execution flow:
    1. Project the four context collections in API order.
    2. Return them for snapshot binding and bounded paging/detail retrieval.
    Failure cases:
    - Missing optional human-request history becomes an empty list; required facts/evidence remain required.
    Side effects:
    - Pure in-memory projection.
    """
    return {
        "facts": [
            {
                "factId": f["factId"], "caseRevision": f["caseRevision"], "kind": f["kind"],
                "state": f["state"], "authority": f["authority"], "statement": f["statement"],
                "evidenceIds": f["evidenceIds"],
            }
            for f in context["facts"]
        ],
        "evidence": [
            {"evidenceId": e["evidenceId"], "type": e["type"], "state": e["state"], "payload": e["payload"]}
            for e in context["evidence"]
        ],
        "humanRequests": list(context.get("humanRequests", [])),
        "openHumanRequestIds": list(context["openHumanRequestIds"]),
    }


def _context_snapshot(run: RootRun, context: dict[str, Any]) -> tuple[dict[str, list[Any]], str]:
    """Business purpose: Bind paged facts/evidence/HITL history to the same authoritative Root context.
    Business rules:
    - Any case, pin, audit, source-scope or collection change invalidates the token.
    Execution flow:
    1. Project context collections.
    2. Hash them with run identity and authoritative case bindings.
    Failure cases:
    - Non-serializable authoritative data fails rather than producing an unbound token.
    Side effects:
    - Pure digest computation.
    """
    collections = _context_collections(context)
    binding = {
        "assessmentId": run.assessment_id, "threadId": run.thread_id,
        "caseRevision": context["caseRevision"],
        "pins": {key: context[key] for key in ("ruleSetVersionId", "repositorySnapshotId", "repositoryCommit")},
        "sourcePathPrefix": validate_source_path_prefix(context.get("sourcePathPrefix")),
        "repositoryScanJobId": context.get("repositoryScanJobId"),
        "decisionScopeId": context.get("decisionScopeId"),
        "auditRequest": context.get("auditRequest"),
        "collections": collections,
    }
    token = hashlib.sha256(json.dumps(
        binding, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False, default=str,
    ).encode("utf-8")).hexdigest()
    return collections, token


def _context_item_summary(collection: str, item: Any, index: int) -> dict[str, Any]:
    """Business purpose:
    Build a minimal identity row when one context record is too large to return inline.

    Business rules:
    - Identity fields may be exposed; large statements, payloads and answer history require governed detail retrieval.

    Execution flow:
    1. Select stable identifying fields for the requested collection.
    2. Attach detailRequired/detailIndex so the exact record remains retrievable.

    Failure cases:
    - Unsupported collection names raise INVALID_CONTEXT_COLLECTION instead of fabricating identity metadata.

    Side effects:
    - Pure projection; no API or domain mutation.
    """
    if collection == "facts" and isinstance(item, dict):
        return {"factId": item.get("factId"), "kind": item.get("kind"), "state": item.get("state"),
                "authority": item.get("authority"), "detailRequired": True, "detailIndex": index}
    if collection == "evidence" and isinstance(item, dict):
        return {"evidenceId": item.get("evidenceId"), "type": item.get("type"), "state": item.get("state"),
                "detailRequired": True, "detailIndex": index}
    if collection == "humanRequests" and isinstance(item, dict):
        return {"requestId": item.get("requestId"), "assessmentRuleId": item.get("assessmentRuleId"),
                "status": item.get("status"), "detailRequired": True, "detailIndex": index}
    raise ValueError("INVALID_CONTEXT_COLLECTION")


def _context_page(
    collection: str, items: list[Any], snapshot_token: str, offset: int, limit: int,
) -> dict[str, Any]:
    """Business purpose:
    Return one model-facing context collection page within the fixed UTF-8 reply budget.

    Business rules:
    - Pages preserve collection order; an oversized record becomes identity-only and remains reachable by detailIndex.

    Execution flow:
    1. Validate offset and build the page envelope.
    2. Append complete small records or identity summaries until the byte/page limit is reached.
    3. Return nextOffset for lossless continuation.

    Failure cases:
    - Invalid offsets or metadata that cannot fit return typed bounded-retrieval failures.

    Side effects:
    - Pure formatting; no API or domain mutation.
    """
    if offset > len(items):
        return {"ok": False, "code": "INVALID_CONTEXT_OFFSET"}
    reply = {
        "ok": True, "collection": collection, "snapshotToken": snapshot_token,
        "total": len(items), "offset": offset, "items": [], "nextOffset": None,
        "detailTool": "get_assessment_context_detail" if collection != "openHumanRequestIds" else None,
    }
    for index in range(offset, min(offset + limit, len(items))):
        raw = items[index]
        row = raw
        if collection != "openHumanRequestIds":
            candidate = {**reply, "items": [*reply["items"], row],
                         "nextOffset": index + 1 if index + 1 < len(items) else None}
            if len(json.dumps(candidate, ensure_ascii=False, default=str).encode("utf-8")) > _CONTEXT_DETAIL_MAX_BYTES:
                row = _context_item_summary(collection, raw, index)
        candidate = {**reply, "items": [*reply["items"], row],
                     "nextOffset": index + 1 if index + 1 < len(items) else None}
        if len(json.dumps(candidate, ensure_ascii=False, default=str).encode("utf-8")) > _CONTEXT_DETAIL_MAX_BYTES:
            break
        reply = candidate
    if offset < len(items) and not reply["items"]:
        return {"ok": False, "code": "CONTEXT_PAGE_METADATA_TOO_LARGE"}
    return reply


def _coverage_snapshot(run: RootRun, context: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
    """Business purpose: Bind complete coverage navigation to one authoritative assessment snapshot.

    Business rules:
    - Preserve every rule's version, resolution state and current decision identity and revision.
    - Case revision alone is insufficient: investigation and decision changes also invalidate a page token.
    - Bind the token to this assessment, thread, immutable pins, selected source scope and current audit request.

    Execution flow:
    1. Project every API coverage row and order it by the pinned rule identity.
    2. Hash those rows together with the authoritative revisions and run identity.

    Failure cases:
    - Malformed required API fields fail retrieval instead of fabricating an incomplete coverage inventory.

    Side effects:
    - Pure in-memory projection and digest; no domain writes, provider calls or coverage filtering.
    """
    rows = sorted(
        [{key: row[key] for key in (
            "assessmentRuleId", "assessmentRuleVersion", "resolutionState",
            "currentDecisionId", "decisionRevision",
        )} for row in context["coverage"]],
        key=lambda row: row["assessmentRuleId"],
    )
    binding = {
        "assessmentId": run.assessment_id,
        "threadId": run.thread_id,
        "caseRevision": context["caseRevision"],
        "pins": {key: context[key] for key in (
            "ruleSetVersionId", "repositorySnapshotId", "repositoryCommit",
        )},
        "sourcePathPrefix": validate_source_path_prefix(context.get("sourcePathPrefix")),
        "repositoryScanJobId": context.get("repositoryScanJobId"),
        "decisionScopeId": context.get("decisionScopeId"),
        "auditRequest": context.get("auditRequest"),
        "coverage": rows,
    }
    token = hashlib.sha256(json.dumps(
        binding, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")).hexdigest()
    return rows, token


def _rule_detail_pointer(payload: Any, pointer: str) -> Any:
    """Business purpose: Retrieve exactly the legal-detail node selected from a governed rule index.

    Business rules:
    - JSON pointers address the immutable projected payload, never paths in a repository or filesystem.
    - Object keys are literal; arrays accept only canonical non-negative decimal indexes.
    Execution flow:
    1. Validate and decode each JSON Pointer segment without accepting ambiguous escapes.
    2. Descend through existing objects and arrays to return the selected node.
    Failure cases:
    - Missing members, malformed escapes and invalid array indexes raise INVALID_RULE_DETAIL_POINTER.
    Side effects:
    - Pure read of the supplied in-memory projection; no legal data, cache or case state changes.
    """
    if not pointer:
        return payload
    if not pointer.startswith("/") or len(pointer) > _RULE_DETAIL_MAX_POINTER:
        raise ValueError("INVALID_RULE_DETAIL_POINTER")
    current = payload
    for encoded in pointer[1:].split("/"):
        if re.search(r"~(?:[^01]|$)", encoded):
            raise ValueError("INVALID_RULE_DETAIL_POINTER")
        key = encoded.replace("~1", "/").replace("~0", "~")
        if isinstance(current, dict) and key in current:
            current = current[key]
        elif isinstance(current, list) and re.fullmatch(r"0|[1-9][0-9]*", key):
            index = int(key)
            if index >= len(current):
                raise ValueError("INVALID_RULE_DETAIL_POINTER")
            current = current[index]
        else:
            raise ValueError("INVALID_RULE_DETAIL_POINTER")
    return current


def _rule_detail_fragment(text: str, pointer: str, offset: int, max_chars: int, byte_limit: int, kind: str) -> dict[str, Any]:
    """Business purpose: Expose every character of a large legal value without silently truncating it.

    Business rules:
    - Offsets and continuation count Unicode code points; concatenated pages preserve the exact original string.
    - The whole-string digest identifies the value; a fragment is never a complete legal provision.
    - JSON fragments must be fully concatenated and parsed before using the reconstructed value.
    Execution flow:
    1. Reject an offset beyond the string and bind its total length and digest.
    2. Find the longest requested prefix whose complete serialized view fits the remaining reply budget.
    3. Return the exact fragment and a continuation until every character is available.
    Failure cases:
    - Invalid offsets or metadata that cannot fit with one character return a bounded retrieval failure.
    Side effects:
    - Pure projection; no text rewriting, provider request or domain mutation.
    """
    if offset > len(text):
        raise ValueError("INVALID_RULE_DETAIL_OFFSET")
    base = {
        "kind": kind, "pointer": pointer, "offsetUnit": "UNICODE_CODE_POINTS",
        "offset": offset, "totalCharacters": len(text),
        "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
    }
    low, high, best = 0, min(max_chars, len(text) - offset), None
    while low <= high:
        length = (low + high) // 2
        end = offset + length
        candidate = {**base, "text": text[offset:end], "nextOffset": end if end < len(text) else None}
        if len(json.dumps(candidate, ensure_ascii=False, default=str).encode("utf-8")) <= byte_limit:
            best = candidate
            low = length + 1
        else:
            high = length - 1
    if best is None or (offset < len(text) and not best["text"]):
        raise ValueError("RULE_DETAIL_METADATA_TOO_LARGE")
    return best


def _rule_detail_view(
    value: Any, pointer: str, offset: int, max_items: int, max_chars: int, byte_limit: int,
) -> dict[str, Any]:
    """Business purpose: Keep complete rule data navigable through bounded values, indexes and exact text pages.

    Business rules:
    - A VALUE contains the complete selected node; indexes and fragments explicitly require further retrieval.
    - Direct item and character maxima apply even when the value would fit the byte budget.
    - Every child stays reachable; oversized pointer metadata falls back to a complete JSON stream at the parent.
    Execution flow:
    1. Return a complete small node when its direct limits and serialized reply budget permit.
    2. Index a larger object or array with exact child pointers and bounded continuation.
    3. Stream large text or an unindexable node as lossless Unicode fragments.
    Failure cases:
    - Offsets outside the selected view or unrepresentable metadata return typed retrieval feedback.
    Side effects:
    - Pure formatting of the authoritative projection; does not omit, reinterpret or persist any rule content.
    """
    direct_limit = (len(value) <= max_items if isinstance(value, (dict, list))
                    else len(value) <= max_chars if isinstance(value, str) else True)
    whole = {"kind": "VALUE", "pointer": pointer, "value": value}
    if direct_limit and len(json.dumps(whole, ensure_ascii=False, default=str).encode("utf-8")) <= byte_limit:
        if offset != 0:
            raise ValueError("INVALID_RULE_DETAIL_OFFSET")
        return whole
    if isinstance(value, str):
        return _rule_detail_fragment(value, pointer, offset, max_chars, byte_limit, "TEXT_FRAGMENT")
    if isinstance(value, (dict, list)):
        entries = []
        pairs = value.items() if isinstance(value, dict) else enumerate(value)
        kinds = {dict: "OBJECT", list: "ARRAY", str: "STRING", bool: "BOOLEAN",
                 int: "NUMBER", float: "NUMBER", type(None): "NULL"}
        for key, child in pairs:
            child_pointer = pointer + "/" + str(key).replace("~", "~0").replace("/", "~1")
            entries.append({
                "key" if isinstance(value, dict) else "index": key,
                "pointer": child_pointer, "kind": kinds[type(child)],
                "serializedBytes": len(json.dumps(child, ensure_ascii=False, default=str).encode("utf-8")),
            })
        base = {
            "kind": "OBJECT_INDEX" if isinstance(value, dict) else "ARRAY_INDEX",
            "pointer": pointer, "offsetUnit": "ENTRIES", "offset": offset, "totalEntries": len(entries),
        }
        unindexable = any(
            len(entry["pointer"]) > _RULE_DETAIL_MAX_POINTER or
            len(json.dumps({**base, "offset": len(entries), "entries": [entry], "nextOffset": len(entries)}, ensure_ascii=False).encode("utf-8")) > byte_limit
            for entry in entries
        )
        if not unindexable:
            if offset > len(entries):
                raise ValueError("INVALID_RULE_DETAIL_OFFSET")
            page = {**base, "entries": [], "nextOffset": offset if offset < len(entries) else None}
            for index in range(offset, min(offset + max_items, len(entries))):
                candidate = {**page, "entries": [*page["entries"], entries[index]],
                             "nextOffset": index + 1 if index + 1 < len(entries) else None}
                if len(json.dumps(candidate, ensure_ascii=False).encode("utf-8")) > byte_limit:
                    break
                page = candidate
            if offset < len(entries) and not page["entries"]:
                raise ValueError("RULE_DETAIL_METADATA_TOO_LARGE")
            if len(json.dumps(page, ensure_ascii=False).encode("utf-8")) > byte_limit:
                raise ValueError("RULE_DETAIL_METADATA_TOO_LARGE")
            return page
    serialized = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return _rule_detail_fragment(serialized, pointer, offset, max_chars, byte_limit, "JSON_FRAGMENT")


def _rule_detail_response(
    run: RootRun, payload: dict[str, Any], *, detail_token: str | None = None,
    pointer: str = "", offset: int = 0, max_items: int = 10, max_chars: int = 2000,
) -> dict[str, Any]:
    """Business purpose: Bind bounded legal-detail reads to the full pinned payload and preserve its authority.

    Business rules:
    - A consistency token binds this case, thread, pins, source scope, authorized audit request and every field of the rule projection.
    - Foreign or changed content is rejected before returning a selected value or fragment.
    - The complete serialized success reply, including identity metadata, must fit 4,096 UTF-8 bytes.
    Execution flow:
    1. Hash the authoritative full projection and compare any supplied token.
    2. Resolve the exact selected node and reserve reply bytes for its identity envelope.
    3. Return a bounded complete value, navigation index or lossless fragment.
    Failure cases:
    - Stale tokens, invalid pointers, invalid offsets and excessive metadata return structured feedback without content.
    Side effects:
    - Pure projection and hashing; no fact, evidence, decision, lifecycle or filesystem writes.
    """
    binding = {
        "assessmentId": run.assessment_id, "threadId": run.thread_id,
        "pins": run.pins, "sourcePathPrefix": run.source_path_prefix,
        "auditRequest": run.audit_request, "payload": payload,
    }
    token = hashlib.sha256(json.dumps(
        binding, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")).hexdigest()
    if detail_token is not None and detail_token != token:
        return {"ok": False, "code": "RULE_DETAIL_SNAPSHOT_STALE",
                "hint": "Reload get_assessment_rule and use its current detailToken."}
    rule = payload["assessmentRule"]
    reply = {
        "ok": True, "assessmentRuleId": rule["assessmentRuleId"],
        "assessmentRuleVersion": rule["assessmentRuleVersion"],
        "ruleSetVersionId": run.pins["ruleSetVersionId"], "detailRequired": True,
        "detailToken": token, "detailTool": "get_assessment_rule_detail",
    }
    try:
        value = _rule_detail_pointer(payload, pointer)
        byte_limit = _RULE_DETAIL_MAX_BYTES - len(json.dumps(
            {**reply, "detail": None}, ensure_ascii=False, default=str,
        ).encode("utf-8")) + len("null")
        reply["detail"] = _rule_detail_view(value, pointer, offset, max_items, max_chars, byte_limit)
    except ValueError as error:
        code = str(error)
        if code not in {"INVALID_RULE_DETAIL_POINTER", "INVALID_RULE_DETAIL_OFFSET", "RULE_DETAIL_METADATA_TOO_LARGE"}:
            raise
        return {"ok": False, "code": code,
                "hint": "Use an indexed pointer and its nextOffset; read a parent JSON fragment for oversized keys."}
    if len(json.dumps(reply, ensure_ascii=False, default=str).encode("utf-8")) > _RULE_DETAIL_MAX_BYTES:
        raise RuntimeError("rule detail reply exceeded its measured byte bound")
    return reply
def build_root_tools(run: RootRun) -> list[StructuredTool]:
    """Business purpose: Expose the governed investigation and reporting operations of one customer Assessment Root.

    Business rules:
    - All tools share this Root run and its authoritative case pins; the model owns semantic conclusions.
    - Schema validation and API failure feedback must not fabricate accepted evidence or positive verdicts.
    Execution flow:
    1. Bind context, legal-source, repository-evidence, decision, human-resolution and report functions to this run.
    2. Wrap the named functions with concise model instructions, typed schemas and API problem feedback.
    3. Return only the Root tool surface, leaving repository researchers without decision authority.
    Failure cases:
    - Malformed arguments receive validation feedback; rejected API operations remain rejected.
    Side effects:
    - Constructs tool objects; invocation performs the documented API writes or native interrupts.
    """
    client = run.client

    def get_assessment_context() -> dict[str, Any]:
        """Business purpose:
        Reload the accepted assessment state and source-view limits before continuing an investigation.

        Business rules:
        - Case pins, coverage, facts and evidence come from the API, not the model's memory.
        - Preserve each fact's authority so evidence-derived claims remain distinguishable from human-provided context.
        - Runtime source metadata must match those pins; incomplete visibility cannot establish absence.
        - Coverage counts describe the authorized audit request, never a completion verdict; every visible row remains available through snapshot-bound pages.

        Execution flow:
        1. Load and adopt the API's complete case context, including every coverage row for revision caches.
        2. Verify the runtime source view and retain the authorized audit request, accepted evidence, fact authority and human audit feedback.
        3. Return coverage counts and a content-bound page token without repeating the full inventory in model history.

        Failure cases:
        - API failures remain rejection feedback; conflicting sandbox pins fail context retrieval.

        Side effects:
        - Updates in-memory Root pins and revision caches; does not persist decisions or facts.
        """
        context = client.context()
        run.adopt_context(context)
        coverage, snapshot_token = _coverage_snapshot(run, context)
        context_collections, context_snapshot_token = _context_snapshot(run, context)
        resolution_counts: dict[str, int] = {}
        for row in coverage:
            state = row["resolutionState"]
            resolution_counts[state] = resolution_counts.get(state, 0) + 1
        return {
            "ok": True,
            "caseRevision": context["caseRevision"],
            "pins": run.pins,
            "sourcePathPrefix": run.source_path_prefix,
            "repositoryView": _repository_view(run),
            "decisionScopeId": context["decisionScopeId"],
            "auditRequest": context.get("auditRequest"),
            "coverageSummary": {
                "totalRuleCount": len(coverage),
                "resolutionCounts": resolution_counts,
                "snapshotToken": snapshot_token,
                "pageTool": "get_assessment_coverage",
                "defaultPageSize": _COVERAGE_DEFAULT_PAGE_SIZE,
                "maxPageSize": _COVERAGE_MAX_PAGE_SIZE,
            },
            "contextCollections": {
                "snapshotToken": context_snapshot_token,
                "pageTool": "get_assessment_context_page",
                "detailTool": "get_assessment_context_detail",
                "defaultPageSize": _CONTEXT_DEFAULT_PAGE_SIZE,
                "maxPageSize": _CONTEXT_MAX_PAGE_SIZE,
                "counts": {name: len(items) for name, items in context_collections.items()},
            },
        }

    def get_assessment_context_page(
        snapshot_token: str, collection: str, offset: int = 0, limit: int = _CONTEXT_DEFAULT_PAGE_SIZE,
    ) -> dict[str, Any]:
        """Business purpose: Page facts, evidence and HITL history without copying unbounded context into model history.
        Business rules:
        - The token binds the complete current context; large records are represented by identity-only rows.
        Execution flow:
        1. Reload and bind the current context.
        2. Reject stale tokens, then return a byte-bounded page.
        Failure cases:
        - Stale tokens and invalid offsets return typed feedback.
        Side effects:
        - Read-only API access and in-memory context refresh.
        """
        context = client.context()
        collections, current_token = _context_snapshot(run, context)
        if snapshot_token != current_token:
            return {"ok": False, "code": "CONTEXT_SNAPSHOT_STALE",
                    "hint": "Reload get_assessment_context and restart context paging."}
        if collection not in collections:
            return {"ok": False, "code": "INVALID_CONTEXT_COLLECTION"}
        run.adopt_context(context)
        return _context_page(collection, collections[collection], current_token, offset, limit)

    def get_assessment_context_detail(
        snapshot_token: str, collection: str, index: int, pointer: str = "", offset: int = 0,
        max_items: int = 10, max_chars: int = 2000,
    ) -> dict[str, Any]:
        """Business purpose: Retrieve one exact large fact/evidence/HITL record through bounded detail pages.
        Business rules:
        - Detail reads require the same current context token and never change fact/evidence authority.
        Execution flow:
        1. Reload context and reject stale/foreign tokens.
        2. Select the exact indexed record and return a bounded value/index/lossless fragment.
        Failure cases:
        - Invalid indexes/pointers/offsets return typed feedback.
        Side effects:
        - Read-only API access.
        """
        context = client.context()
        collections, current_token = _context_snapshot(run, context)
        if snapshot_token != current_token:
            return {"ok": False, "code": "CONTEXT_SNAPSHOT_STALE",
                    "hint": "Reload get_assessment_context before reading details."}
        if collection not in {"facts", "evidence", "humanRequests"}:
            return {"ok": False, "code": "INVALID_CONTEXT_COLLECTION"}
        items = collections[collection]
        if index >= len(items):
            return {"ok": False, "code": "INVALID_CONTEXT_INDEX"}
        run.adopt_context(context)
        reply = {
            "ok": True, "collection": collection, "index": index,
            "snapshotToken": current_token, "detailRequired": True,
        }
        try:
            value = _rule_detail_pointer(items[index], pointer)
            byte_limit = _CONTEXT_DETAIL_MAX_BYTES - len(json.dumps(
                {**reply, "detail": None}, ensure_ascii=False, default=str,
            ).encode("utf-8")) + len("null")
            reply["detail"] = _rule_detail_view(value, pointer, offset, max_items, max_chars, byte_limit)
        except ValueError as error:
            code = str(error)
            mapped = {
                "INVALID_RULE_DETAIL_POINTER": "INVALID_CONTEXT_DETAIL_POINTER",
                "INVALID_RULE_DETAIL_OFFSET": "INVALID_CONTEXT_DETAIL_OFFSET",
                "RULE_DETAIL_METADATA_TOO_LARGE": "CONTEXT_DETAIL_METADATA_TOO_LARGE",
            }.get(code)
            if mapped is None:
                raise
            return {"ok": False, "code": mapped}
        if len(json.dumps(reply, ensure_ascii=False, default=str).encode("utf-8")) > _CONTEXT_DETAIL_MAX_BYTES:
            raise RuntimeError("context detail reply exceeded its measured byte bound")
        return reply

    def get_assessment_coverage(
        snapshot_token: str, offset: int = 0, limit: int = _COVERAGE_DEFAULT_PAGE_SIZE,
    ) -> dict[str, Any]:
        """Business purpose: Retrieve complete per-rule coverage incrementally without mixing assessment snapshots.

        Business rules:
        - The supplied token must match the current leased API context for this assessment and thread.
        - Any audit-request, coverage, case revision, pin or source-scope change requires a fresh context summary.
        - Pages retain every row field and expose the total and continuation; a page is never proof of completion.

        Execution flow:
        1. Reload complete authoritative context and recompute its ordered coverage snapshot.
        2. Reject a stale token or an offset past the inventory before returning any coverage rows.
        3. Adopt the full context for revision caches and return the requested bounded page.

        Failure cases:
        - A changed or foreign token returns COVERAGE_SNAPSHOT_STALE; an excessive offset returns INVALID_COVERAGE_OFFSET.
        - Schema validation rejects malformed tokens and page limits outside the supported range.

        Side effects:
        - Read-only API access and in-memory revision-cache refresh; no evidence, fact, decision or lifecycle writes.
        """
        context = client.context()
        coverage, current_token = _coverage_snapshot(run, context)
        if snapshot_token != current_token:
            return {
                "ok": False, "code": "COVERAGE_SNAPSHOT_STALE",
                "hint": "Reload get_assessment_context and restart coverage paging with its snapshotToken.",
            }
        if offset > len(coverage):
            return {
                "ok": False, "code": "INVALID_COVERAGE_OFFSET",
                "hint": "Start at offset zero or use the nextOffset returned by the previous page.",
            }
        run.adopt_context(context)
        return {
            "ok": True, "caseRevision": context["caseRevision"], "snapshotToken": current_token,
            "totalRuleCount": len(coverage), "offset": offset, "limit": limit,
            "nextOffset": offset + limit if offset + limit < len(coverage) else None,
            "coverage": coverage[offset:offset + limit],
        }

    def get_rule_decision(assessment_rule_id: str, revision: int | None = None) -> dict[str, Any]:
        """Business purpose: Recover a prior model decision's reasoning and references before re-investigating one rule.

        Business rules:
        - Retrieve only the requested rule's newest or exact historical revision through the leased API.
        - Structural acceptance is not proof of semantic correctness; the Root evaluates support using current sources and facts.
        - Reading an older packet must not roll back the current revision used for a later submission.

        Execution flow:
        1. Ask the API for the bounded rule decision record, preserving its identity, state, packet and revision.
        2. Return that immutable record without accepting or revising a decision.

        Failure cases:
        - Missing records return an empty collection; API authorization or query failures remain structured rejection feedback.

        Side effects:
        - Read-only API access; no domain mutations or local revision-cache changes.
        """
        return {"ok": True, **client.rule_decisions(assessment_rule_id, revision)}

    def get_pinned_rule_set(offset: int = 0, limit: int = 10) -> dict[str, Any]:
        """Business purpose: Discover every authorized AssessmentRule through complete, bounded catalog pages.

        Business rules:
        - The API owns the immutable Rule Set and current audit request; pagination never expands the authorized rule selection.
        - Follow nextOffset until null for all selected rules; totalPinnedRuleCount is informational, not additional audit authority.
        - The requested row limit is an upper bound; the complete serialized reply must also fit 4,096 UTF-8 bytes.
        - A summary too large for one page retains its rule identity and an explicit link to complete governed details.

        Execution flow:
        1. Refresh the leased request context, select its authorized rules and cache their server-provided versions and criteria.
        2. Add complete summaries while both the row and reply-byte limits permit.
        3. Return the actual continuation, or a detail link when a single summary needs bounded retrieval.

        Failure cases:
        - API failures remain structured feedback; an offset past the catalog returns an empty final page.
        - An identity envelope that cannot fit returns RULE_CATALOG_METADATA_TOO_LARGE without skipping the rule.

        Side effects:
        - Read-only API access and in-memory identity caches; no domain state or legal judgments are changed.
        """
        run.adopt_context(client.context())
        rule_set = client.rule_set()
        selected = set(run.audit_request["selectedRuleIds"]) if run.audit_request is not None else None
        visible_rules = [rule for rule in rule_set["assessmentRules"]
                         if selected is None or rule["assessmentRuleId"] in selected]
        for rule in visible_rules:
            run.rule_versions[rule["assessmentRuleId"]] = rule["assessmentRuleVersion"]
            run.rule_criteria[rule["assessmentRuleId"]] = [
                c["criterionId"] for c in rule.get("criteria", [])
            ]
        total = len(visible_rules)
        result = {
            "ok": True, "ruleSetVersionId": rule_set["ruleSetVersionId"],
            "legalRequirementCount": len(rule_set["legalRequirements"]),
            "assessmentRuleCount": total, "totalPinnedRuleCount": len(rule_set["assessmentRules"]),
            "nextOffset": None, "assessmentRules": [],
        }
        for rule in visible_rules[offset:offset + limit]:
            row = {
                "assessmentRuleId": rule["assessmentRuleId"],
                "assessmentRuleVersion": rule["assessmentRuleVersion"],
                "concept": rule["concept"],
                "legalRequirementIds": rule["legalRequirementIds"],
                "criterionIds": [c["criterionId"] for c in rule.get("criteria", [])],
            }
            end = offset + len(result["assessmentRules"]) + 1
            candidate = {**result, "assessmentRules": [*result["assessmentRules"], row],
                         "nextOffset": end if end < total else None}
            if len(json.dumps(candidate, ensure_ascii=False, default=str).encode("utf-8")) > _RULE_CATALOG_MAX_BYTES:
                if result["assessmentRules"]:
                    break
                row = {
                    "assessmentRuleId": rule["assessmentRuleId"],
                    "assessmentRuleVersion": rule["assessmentRuleVersion"],
                    "detailRequired": True, "detailTool": "get_assessment_rule",
                }
                candidate = {**result, "assessmentRules": [row],
                             "nextOffset": end if end < total else None}
                if len(json.dumps(candidate, ensure_ascii=False, default=str).encode("utf-8")) > _RULE_CATALOG_MAX_BYTES:
                    return {"ok": False, "code": "RULE_CATALOG_METADATA_TOO_LARGE",
                            "hint": "The pinned rule identity cannot fit a catalog reply; the inventory remains unresolved."}
            result = candidate
        if len(json.dumps(result, ensure_ascii=False, default=str).encode("utf-8")) > _RULE_CATALOG_MAX_BYTES:
            return {"ok": False, "code": "RULE_CATALOG_METADATA_TOO_LARGE",
                    "hint": "The pinned catalog identity cannot fit a reply; the inventory remains unresolved."}
        return result

    def _read_assessment_rule(assessment_rule_id: str) -> dict[str, Any]:
        """Business purpose: Load one pinned rule together with the legal requirements and source-defined context needed to assess it.

        Business rules:
        - Current leased audit-request membership is checked before any pinned rule content is retrieved.
        - Rules must belong to the pinned Rule Set; applicability addresses come from linked requirements, not guessed conditions.
        Execution flow:
        1. Refresh server-owned request scope and reject a rule outside its explicit selection.
        2. Find the requested rule and collect its outgoing context relations and related requirements.
        3. Cache the linked applicability addresses for anchored human questions.
        4. Return the full rule, requirements, context, applicability elements and provisions worth reading.

        Failure cases:
        - A rule outside the current request returns RULE_NOT_IN_AUDIT_REQUEST before legal-content access.
        - An unknown identifier returns RULE_NOT_IN_RULE_SET without creating a replacement rule.
        Side effects:
        - Reads leased context and the Rule Set API; updates only execution-local scope, revision and applicability caches.
        """
        run.adopt_context(client.context())
        if run.audit_request is not None and assessment_rule_id not in run.audit_request["selectedRuleIds"]:
            return {"ok": False, "code": "RULE_NOT_IN_AUDIT_REQUEST"}
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
        requirements = [lr for lr in rule_set["legalRequirements"] if lr["legalRequirementId"] in linked | related]
        elements = _applicability_elements([lr for lr in requirements if lr["legalRequirementId"] in linked])
        run.rule_elements[assessment_rule_id] = {
            (item["legalRequirementId"], item["kind"], item["index"]): item["text"] for item in elements
        }
        return {
            "ok": True,
            "assessmentRule": rule,
            "legalRequirements": requirements,
            "contextRelations": relations,
            # What the legal source says decides whether this duty reaches a system. Address each element by
            # (legalRequirementId, kind, index) in applicability_basis and in human questions.
            "applicabilityElements": elements,
            # Read these with read_legal_source before concluding what an element means; use
            # search_legal_source to find the provisions that define or limit a term.
            "legalSources": _legal_sources(rule, requirements, relations),
        }

    def get_assessment_rule(assessment_rule_id: str) -> dict[str, Any]:
        """Business purpose: Load a pinned rule without forcing its complete legal contract into one model turn.

        Business rules:
        - Small results retain the complete prior projection; large results expose every field through governed detail reads.
        - The full authoritative payload still populates applicability anchors; an index cannot support a legal verdict.

        Execution flow:
        1. Load the rule and all linked legal context through the existing governed API.
        2. Return its full payload when it fits, otherwise return a content-bound navigation index.

        Failure cases:
        - Missing rules retain RULE_NOT_IN_RULE_SET; invalid legal metadata fails without inventing a substitute rule.

        Side effects:
        - Read-only API access and in-memory applicability caches; no domain or filesystem writes.
        """
        payload = _read_assessment_rule(assessment_rule_id)
        if not payload["ok"] or len(json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")) <= _RULE_DETAIL_MAX_BYTES:
            return payload
        return _rule_detail_response(run, payload)

    def get_assessment_rule_detail(
        assessment_rule_id: str, detail_token: str, pointer: str = "", offset: int = 0,
        max_items: int = 10, max_chars: int = 2000,
    ) -> dict[str, Any]:
        """Business purpose: Read complete selected legal fields incrementally from the pinned rule authority.

        Business rules:
        - Each read reloads and validates the current audit-request scope before returning any legal content.
        - The token must match the same case, thread, audit request, pins and exact complete rule projection.
        - Indexes and fragments are incomplete; reconstruct the selected normative value before interpreting it.
        - All fields remain available, including criteria, inherited requirements, applicability elements and source references.

        Execution flow:
        1. Revalidate current audit membership, then reload the full pinned projection and its applicability anchors from the API.
        2. Reject a changed token or return the requested bounded node, index or exact text fragment.

        Failure cases:
        - Unauthorized or missing rules, stale tokens and invalid pointers or offsets produce feedback without partial legal content.

        Side effects:
        - Read-only API access and in-memory applicability caches; never writes customer facts, verdicts or scratch files.
        """
        payload = _read_assessment_rule(assessment_rule_id)
        if not payload["ok"]:
            return payload
        return _rule_detail_response(
            run, payload, detail_token=detail_token, pointer=pointer, offset=offset,
            max_items=max_items, max_chars=max_chars,
        )

    def read_legal_source(document_id: str, locator: str) -> dict[str, Any]:
        """Business purpose: Read one original provision from the legal source pinned by this assessment’s Rule Set.

        Business rules:
        - The requested document and locator must be available through the assessment’s pinned legal authority.
        Execution flow:
        1. Request the provision from the governed legal-source API.
        2. Return its source text and provenance to the investigator.
        Failure cases:
        - Unavailable or invalid provision references return the API’s failure feedback.
        Side effects:
        - Read-only legal-source retrieval; no source text, pins or decisions are changed.
        """
        return {"ok": True, **client.legal_source_text(document_id, locator)}

    def search_legal_source(query: str) -> dict[str, Any]:
        """Business purpose: Find pinned provisions that can define or limit the legal terms relevant to an investigation.

        Business rules:
        - Search results remain legal-source evidence; a textual match does not decide applicability or compliance.
        Execution flow:
        1. Send the requested words to the assessment-scoped legal-source search API.
        2. Return its matches and truncation metadata.
        Failure cases:
        - Invalid queries or unavailable pinned sources retain the API’s problem feedback.
        Side effects:
        - Read-only search; creates no legal requirements, evidence acceptance or customer facts.
        """
        return {"ok": True, **client.legal_source_search(query)}

    def start_rule_investigation(assessment_rule_id: str) -> dict[str, Any]:
        """Mark that you are now investigating this AssessmentRule."""
        return {"ok": True, **client.start_investigation(assessment_rule_id)}

    def cite_repository_source(path: str, start_line: int, end_line: int) -> dict[str, Any]:
        """Business purpose: Accept an exact source excerpt from the assessment's selected repository view.

        Business rules:
        - Scoped paths must be canonical and remain under the API-owned immutable prefix.
        - The runtime reads and hashes the actual line range; the model cannot supply its evidence hash.

        Execution flow:
        1. Bind context, reject paths outside the selection and verify scoped runtime metadata.
        2. Read the source range, compute its digest and submit the pinned evidence to the API.

        Failure cases:
        - Invalid scope, missing source and invalid ranges never create evidence.
        - Conflicting runtime scope metadata stops investigation before reading source.

        Side effects:
        - Reads permitted source, records the read trace and asks the API to accept source evidence.
        """
        if not run.pins:
            run.adopt_context(client.context())
        normalized = _source_evidence_path(run, path)
        if normalized is None:
            return {"ok": False, "code": "SOURCE_PATH_OUTSIDE_SCOPE", "sourcePathPrefix": run.source_path_prefix,
                    "hint": f"Use a canonical source path under {run.source_path_prefix!r}; repeat native searches with that explicit path."}
        if normalized == "." or end_line < start_line:
            return {"ok": False, "code": "INVALID_RANGE"}
        if run.source_path_prefix is not None:
            _repository_view(run)
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
        """Business purpose: Record only searches and reads attributable to the selected source view.

        Business rules:
        - Paths come from runtime tool traces; Root-authored caveats do not prove a search occurred.
        - Scoped native searches must explicitly target the selected prefix or a descendant.
        - Graph coverage uses the same verified, scope-stamped hydrated view and retains original source paths.

        Execution flow:
        1. Bind the source scope and reject explicit caveat paths outside it.
        2. Verify scoped runtime metadata and convert executed reads/searches into bounded source observations.
        3. Reject an out-of-scope trace before submitting the authenticated coverage record.

        Failure cases:
        - Missing activity or out-of-scope paths produce feedback without accepting coverage.
        - Runtime scope conflicts stop the operation; truncated traces remain explicit limitations.

        Side effects:
        - Consumes the execution-local trace and submits a coverage record only after all scope guards pass.
        """
        if not run.pins:
            run.adopt_context(client.context())
        if run.source_path_prefix is not None:
            supplied_paths = [*(inspected_entry_points or []),
                              *(item.get("path") for item in (direct_source_fallbacks or []))]
            if any(_source_evidence_path(run, path) is None for path in supplied_paths):
                return {"ok": False, "code": "SOURCE_PATH_OUTSIDE_SCOPE", "sourcePathPrefix": run.source_path_prefix,
                    "hint": f"Use a canonical source path under {run.source_path_prefix!r}; repeat native searches with that explicit path."}
            _repository_view(run)
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
                path = _source_evidence_path(run, args.get("file_path") or args.get("path"))
                if path is None:
                    return {"ok": False, "code": "SOURCE_PATH_OUTSIDE_SCOPE", "sourcePathPrefix": run.source_path_prefix,
                    "hint": f"Use a canonical source path under {run.source_path_prefix!r}; repeat native searches with that explicit path."}
                read_paths.add(path)
                scopes[(_SCOPE_FILE, path)] = None
                continue
            if tool in {"ls", "glob", "grep"}:
                path = _source_evidence_path(run, args.get("path") or args.get("directory") or ".")
                if path is None:
                    return {"ok": False, "code": "SOURCE_PATH_OUTSIDE_SCOPE", "sourcePathPrefix": run.source_path_prefix,
                    "hint": f"Use a canonical source path under {run.source_path_prefix!r}; repeat native searches with that explicit path."}
                scopes[(_SCOPE_DIRECTORY, path)] = None
            else:
                scopes[(_SCOPE_GRAPH, run.source_path_prefix or ".")] = None
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
        """Business purpose: Preserve the Root's evidence-backed observation or use-case description in the assessment case.

        Business rules:
        - Cite accepted source evidence and state only what it supports, including any uncertainty or scope limitation.
        - A documentation claim, implementation capability or hypothesis does not establish actual operator practice.
        - The API checks authority, source references and the current case revision; acceptance does not certify semantic truth.

        Execution flow:
        1. Submit the Root-authored statement and evidence links at the current case revision.
        2. Adopt the new case revision returned by the server.

        Failure cases:
        - Stale revisions or invalid evidence remain API rejections; no local revision is advanced on failure.

        Side effects:
        - Appends the fact and advances the case revision; the API invalidates decisions made against an older case revision.
        """
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
        assessment_rule_id: str,
        applicability: str,
        rationale: str,
        legal_context_ids: list[str],
        references: list[dict[str, str]],
        criteria: list[dict[str, Any]] | None = None,
        compliance: str | None = None,
        applicability_basis: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Business purpose: Submit the investigator’s actual applicability and criterion findings for one pinned assessment rule.

        Business rules:
        - The API validates legal context, evidence, criteria and applicability basis; semantic choices remain the investigator’s.
        - Use current pins, case revision and expected decision revision; an exact retry keeps a stable payload digest.
        Execution flow:
        1. Refresh run authority when the rule version is not known and validate the supplied decision arguments.
        2. Bind the decision to the pinned Rule Set, repository snapshot, commit and case revision.
        3. Submit with the expected decision revision and update the cache only from the accepted API response.
        Failure cases:
        - Invalid arguments or rejected evidence, applicability and revision checks do not become accepted decisions.
        Side effects:
        - A successful API call persists the decision and coverage revision; the run caches that accepted revision.
        """
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
                "applicability_basis": applicability_basis or [],
            }
        )
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
            **(
                {
                    "applicabilityBasis": [
                        {
                            "legalRequirementId": entry.legal_requirement_id,
                            "kind": entry.kind,
                            "index": entry.index,
                            "finding": entry.finding,
                            "rationale": entry.rationale,
                            "references": [_reference(r) for r in entry.references],
                        }
                        for entry in args.applicability_basis
                    ]
                }
                if args.applicability_basis
                else {}
            ),
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

    def anchored_impact(
        assessment_rule_id: str,
        criterion_ids: list[str] | None,
        condition_ref: ConditionRefArgs | dict[str, Any] | None,
        decision_impact: list[str],
    ) -> list[str] | dict[str, Any]:
        """Business purpose: Keep a customer question attached to the source-defined condition or criterion that the missing fact affects.

        Business rules:
        - A question must name criterion IDs or a valid legal applicability address; never ask the customer to supply a legal verdict.
        Execution flow:
        1. Reject questions without a criterion or condition anchor.
        2. Load the rule’s applicability elements when a condition address needs verification.
        3. Return the requested impact together with the exact source-stated condition wording.
        Failure cases:
        - Missing anchors return HUMAN_REQUEST_NOT_ANCHORED; unknown condition addresses return UNKNOWN_APPLICABILITY_ELEMENT.
        Side effects:
        - Read-only validation apart from populating this execution’s legal-element cache.
        """
        if not criterion_ids and not condition_ref:
            return {
                "ok": False,
                "code": "HUMAN_REQUEST_NOT_ANCHORED",
                "hint": (
                    "Name the criterion_ids or the condition_ref (legal_requirement_id, kind, index from "
                    "get_assessment_rule.applicabilityElements) that the missing fact bears on, and ask for the "
                    "fact that settles it, not for a legal classification."
                ),
            }
        if not condition_ref:
            return decision_impact
        if assessment_rule_id not in run.rule_elements:
            get_assessment_rule(assessment_rule_id)
        ref = ConditionRefArgs.model_validate(condition_ref)  # a model from the tool schema, or a plain dict
        key = (ref.legal_requirement_id, ref.kind, ref.index)
        text = run.rule_elements.get(assessment_rule_id, {}).get(key)
        if text is None:
            return {
                "ok": False,
                "code": "UNKNOWN_APPLICABILITY_ELEMENT",
                "hint": "condition_ref must be one of get_assessment_rule.applicabilityElements for this rule.",
            }
        return [*decision_impact, f"Bears on this condition stated in the legal text: {text}"]

    def persist_human_request(
        assessment_rule_id: str,
        question: str,
        unresolved_fact: str,
        decision_impact: list[str],
        resolution_attempts: list[str],
        criterion_ids: list[str] | None = None,
        control_type: str = "FREE_TEXT",
        choices: list[dict[str, str]] | None = None,
        dependencies: list[dict[str, Any]] | None = None,
        source_request_id: str | None = None,
    ) -> dict[str, Any]:
        """Business purpose: Persist one idempotent material question and its shared rule dependencies.

        Business rules:
        - Server validation owns source-request equivalence, accepted facts and dependency eligibility.
        - Exact semantic content and explicit source identity determine replay identity on this Root thread.
        Execution flow:
        1. Serialize the question and optional dependency/source references.
        2. Bind current case revision and a stable thread/content idempotency key.
        3. Return only the authoritative server result.
        Failure cases:
        - Rejected sharing, stale revisions or invalid dependencies propagate as governed tool feedback.
        Side effects:
        - May persist a new request or attach validated dependencies to an existing request.
        """
        content = {
            "assessmentRuleId": assessment_rule_id,
            "criterionIds": criterion_ids or [],
            "question": question,
            "unresolvedFact": unresolved_fact,
            "decisionImpact": list(decision_impact),
            "resolutionAttempts": list(resolution_attempts),
            "controlType": control_type,
            "choices": choices or [],
            **({"dependencies": [
                {"assessmentRuleId": dependency.assessment_rule_id, "criterionIds": dependency.criterion_ids}
                for dependency in (HumanRequestDependencyArgs.model_validate(row) for row in dependencies)
            ]} if dependencies else {}),
            **({"sourceRequestId": source_request_id} if source_request_id else {}),
        }
        # Native interrupt replays this tool. Stable server-thread/content identity makes the
        # pre-interrupt request write idempotent across new processes and execution attempts.
        digest = hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()[:32]
        return client.post_human_request({
            **content,
            "expectedCaseRevision": run.case_revision,
            "idempotencyKey": f"human:{run.thread_id}:{digest}",
        })

    def _human_request_resume_payload(
        context: dict[str, Any], result: dict[str, Any],
    ) -> dict[str, Any]:
        """Business purpose:
        Return bounded HITL continuation metadata without embedding facts or answer history.

        Business rules:
        - Resume payloads expose only request identity/status/revisions plus a token for governed context paging.
        - UNKNOWN remains non-factual and requires exact checkpoint-bound review authority.
        - Facts, evidence and complete human-request history are retrieved only through bounded context page/detail tools.

        Execution flow:
        1. Bind the current context collections to a snapshot token.
        2. Locate the exact request identity in the authoritative human-request ledger.
        3. Validate UNKNOWN review authority or report the request as resolved.
        4. Return compact continuation metadata and the context snapshot token.

        Failure cases:
        - Missing request identity or unauthorized UNKNOWN review raises instead of fabricating a resolution.
        - Oversized facts/history never enter this response; callers must use bounded context retrieval.

        Side effects:
        - Pure projection of an already-loaded authoritative context.
        """
        _, context_snapshot_token = _context_snapshot(run, context)
        request_id = result["requestId"]
        row = next(
            (
                row
                for row in context.get("humanRequests", [])
                if row["requestId"] == request_id
            ),
            None,
        )
        if request_id in context["openHumanRequestIds"] and row is None:
            raise RuntimeError("human request resumed without authoritative request identity")
        request = {
            "requestId": request_id,
            "requestRevision": (
                row.get("requestRevision")
                if row is not None
                else result.get("requestRevision")
            ),
            "status": row.get("status") if row is not None else "RESOLVED",
            "assessmentRuleId": (
                row.get("assessmentRuleId")
                if row is not None
                else result.get("assessmentRuleId")
            ),
            "resolvedFactId": (
                row.get("resolvedFactId")
                if row is not None
                else result.get("resolvedFactId")
            ),
        }
        if request_id in context["openHumanRequestIds"]:
            answers = row.get("answers", [])
            latest = answers[-1] if answers else {}
            if (
                request_id not in run.human_answer_review_request_ids
                or row.get("status") != "OPEN"
                or row.get("resolvedFactId") is not None
                or latest.get("doesNotKnow") is not True
                or latest.get("answer") is not None
                or latest.get("checkpointId")
                != run.human_answer_review_checkpoint_id
                or row.get("checkpointId") != run.human_answer_review_checkpoint_id
                or latest.get("requestRevision") != row.get("requestRevision")
            ):
                raise RuntimeError(
                    "human request resumed without an authoritative resolution or answer review"
                )
            return {
                "ok": True,
                "requestId": request_id,
                "caseRevision": run.case_revision,
                "resolved": False,
                "responseKind": "UNKNOWN",
                "request": request,
                "contextSnapshotToken": context_snapshot_token,
                "contextPageTool": "get_assessment_context_page",
                "contextDetailTool": "get_assessment_context_detail",
                "instruction": "This UNKNOWN response is not a fact or verdict. Read accepted facts/evidence through the bounded context tools; report permanent unavailability only if supported, otherwise call wait_for_human_requests.",
            }
        return {
            "ok": True,
            "requestId": request_id,
            "caseRevision": run.case_revision,
            "resolved": True,
            "request": request,
            "contextSnapshotToken": context_snapshot_token,
            "contextPageTool": "get_assessment_context_page",
            "contextDetailTool": "get_assessment_context_detail",
            "instruction": "Continue investigation using accepted facts from bounded context reads; re-evaluate stale decisions.",
        }

    def resolved_human_request(result: dict[str, Any]) -> dict[str, Any]:
        """Business purpose:
        Reload a human dependency as compact accepted resolution or authorized UNKNOWN review metadata.

        Business rules:
        - Resume values never establish facts; the authenticated API ledger is authoritative.
        - Model-facing continuation never embeds complete facts, evidence or answer history.

        Execution flow:
        1. Reload current context and adopt server case pins.
        2. Project the exact request through the bounded HITL continuation envelope.

        Failure cases:
        - Missing request identity or unauthorized UNKNOWN review fails closed.

        Side effects:
        - Read-only API retrieval and execution-local cache refresh; no fact or lifecycle writes.
        """
        context = client.context()
        run.adopt_context(context)
        return _human_request_resume_payload(context, result)

    def wait_for_human_requests() -> dict[str, Any]:
        """Business purpose: Retain unresolved human dependencies after reviewing an unknown response.

        Business rules:
        - Unknown responses do not close requests or authorize compliance decisions.
        - The next wait uses the complete authoritative open-request set and a native checkpoint.
        Execution flow:
        1. Reload the authoritative open dependencies.
        2. Interrupt when any remain, preserving their identities without creating another question.
        3. On authorized resume, return the server-owned resolution or unknown feedback.
        Failure cases:
        - An unauthorized resume of an open dependency fails rather than accepting a fabricated fact.
        Side effects:
        - Persists a native interrupt checkpoint; no question, fact, answer or lifecycle writes.
        """
        context = client.context()
        run.adopt_context(context)
        request_ids = sorted(set(context["openHumanRequestIds"]))
        if request_ids:
            interrupt({"requestIds": request_ids})
            resumed_context = client.context()
            run.adopt_context(resumed_context)
            return {
                "ok": True,
                "requests": [
                    _human_request_resume_payload(
                        resumed_context, {"requestId": request_id}
                    )
                    for request_id in request_ids
                ],
                "caseRevision": run.case_revision,
            }
        _, context_snapshot_token = _context_snapshot(run, context)
        return {
            "ok": True,
            "requests": [],
            "caseRevision": run.case_revision,
            "contextSnapshotToken": context_snapshot_token,
            "contextPageTool": "get_assessment_context_page",
            "contextDetailTool": "get_assessment_context_detail",
        }

    def report_existing_human_fact_unresolvable(
        request_id: str, unavailability_rationale: str, evidence_ids: list[str],
    ) -> dict[str, Any]:
        """Business purpose: Report proven permanent unavailability for an existing question without creating a duplicate.

        Business rules:
        - Only a current server-owned OPEN request may be classified; unknown alone is insufficient.
        - Accepted evidence and the API validate permanent unavailability and retain the unresolved dependency.
        Execution flow:
        1. Reload the exact request and its current revision from governed context.
        2. Submit evidence and rationale against that request at the current case revision.
        3. Preserve all open dependencies in a native wait even when the claim is rejected.
        Failure cases:
        - A missing request returns HUMAN_REQUEST_NOT_FOUND; rejected unavailability evidence remains checkpoint feedback and never creates a fact.
        Side effects:
        - May persist the API's unavailable-fact classification and a native checkpoint; creates no duplicate question.
        """
        context = client.context()
        run.adopt_context(context)
        row = next((row for row in context.get("humanRequests", []) if row["requestId"] == request_id), None)
        if row is None:
            return {"ok": False, "code": "HUMAN_REQUEST_NOT_FOUND", "hint": "Reload governed humanRequests context."}
        if request_id not in context["openHumanRequestIds"]:
            return resolved_human_request({"requestId": request_id})
        pending: dict[str, Any] = {"requestIds": sorted(set(context["openHumanRequestIds"]))}
        try:
            client.report_unresolvable_human_fact({
                "humanResolutionRequestId": request_id, "expectedCaseRevision": run.case_revision,
                "expectedRequestRevision": row["requestRevision"], "rationale": unavailability_rationale,
                "evidenceIds": sorted(set(evidence_ids)),
            })
        except Exception as error:
            pending["claimRejected"] = {"code": error.code if isinstance(error, AssessmentApiError) else type(error).__name__}
        interrupt(pending)
        return resolved_human_request({"requestId": request_id})

    def open_human_request(
        assessment_rule_id: str,
        question: str,
        unresolved_fact: str,
        decision_impact: list[str],
        resolution_attempts: list[str],
        criterion_ids: list[str] | None = None,
        control_type: str = "FREE_TEXT",
        choices: list[dict[str, str]] | None = None,
        condition_ref: dict[str, Any] | None = None,
        dependencies: list[dict[str, Any]] | None = None,
        source_request_id: str | None = None,
    ) -> dict[str, Any]:
        """Business purpose: Ask the customer for a material missing fact after investigating the repository and pinned legal sources.

        Business rules:
        - The fact must settle a named criterion or source-stated condition; an unanswered question cannot become a compliance verdict.
        - Explicit source sharing and extra dependencies require server validation; an accepted resolved source needs no new wait.
        Execution flow:
        1. Verify the question’s criterion or condition anchor.
        2. Persist or explicitly share the governed question; return a resolved source or interrupt with the open request identity.
        3. On an authorized resume, return the server-owned resolution of that same request.
        Failure cases:
        - Invalid anchors return feedback; an open request keeps the assessment waiting instead of forcing completion.
        Side effects:
        - Persists a human-resolution request and a native checkpoint dependency; creates no assumed customer fact.
        """
        impact = anchored_impact(assessment_rule_id, criterion_ids, condition_ref, decision_impact)
        if isinstance(impact, dict):
            return impact
        result = persist_human_request(assessment_rule_id, question, unresolved_fact,
            impact, resolution_attempts, criterion_ids, control_type, choices, dependencies, source_request_id)
        context = client.context()
        if source_request_id and result["requestId"] not in context["openHumanRequestIds"]:
            return resolved_human_request(result)
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
        condition_ref: dict[str, Any] | None = None,
        dependencies: list[dict[str, Any]] | None = None,
        source_request_id: str | None = None,
    ) -> dict[str, Any]:
        """Business purpose: Record evidence that a material customer fact is permanently unavailable without inventing an unknown verdict.

        Business rules:
        - The question remains attached to a valid criterion or condition; only the API can accept permanent-unavailability evidence.
        - A later valid answer clears the prior dependency instead of replaying the old unavailability claim.
        Execution flow:
        1. Validate the legal anchor and persist the unresolved customer question.
        2. Reload its authoritative state and submit the unavailability rationale and evidence while still open.
        3. Interrupt with the durable request identity even if the unavailability claim is rejected.
        Failure cases:
        - Rejected unavailability claims are retained as checkpoint feedback; they never silently close the human dependency.
        Side effects:
        - May persist the API’s unavailable-fact classification and always preserves the native human-resolution lifecycle.
        """
        impact = anchored_impact(assessment_rule_id, criterion_ids, condition_ref, decision_impact)
        if isinstance(impact, dict):
            return impact
        result = persist_human_request(assessment_rule_id, question, unresolved_fact,
            impact, [*resolution_attempts, unavailability_rationale],
            criterion_ids, control_type, choices, dependencies, source_request_id)
        # A later valid answer replays this native tool. Resolution is server-owned and must
        # clear the old dependency instead of reapplying the historical blocker claim.
        context = client.context()
        run.adopt_context(context)
        if result["requestId"] in context["openHumanRequestIds"]:
            pending: dict[str, Any] = {"requestIds": [result["requestId"]]}
            try:
                client.report_unresolvable_human_fact({
                    "humanResolutionRequestId": result["requestId"],
                    "expectedCaseRevision": run.case_revision,
                    "expectedRequestRevision": result["requestRevision"],
                    "rationale": unavailability_rationale,
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
        """Business purpose: Submit the Root's authored findings without inventing verified controls.

        Business rules:
        - The API binds accepted decisions, pins and provenance; omitted findings must remain omissions.
        - Narrative is authored by the Root and must not substitute for accepted compliance evidence.
        Execution flow:
        1. Validate the narrative arguments and serialize the supplied per-rule findings.
        2. Submit those findings unchanged to the authoritative report validation endpoint.
        Failure cases:
        - Invalid arguments or incomplete report coverage return repair feedback; no positive fallback is added.
        Side effects:
        - A valid API submission persists the final report and completes its supported lifecycle.
        """
        args = SubmitFinalReportArgs.model_validate(
            {"summary": summary, "findings": findings}
        )
        findings_map = {
            finding.assessment_rule_id: {
                "assessmentRuleId": finding.assessment_rule_id,
                "summary": finding.summary,
                "recommendations": finding.recommendations,
            }
            for finding in args.findings
        }
        result = client.post_final_report(
            {
                "kind": "FINAL_REPORT",
                "summary": args.summary,
                "findings": list(findings_map.values()),
            }
        )
        return {"ok": True, **result}

    def tool(func, schema: type[BaseModel] | None, name: str, description: str) -> StructuredTool:
        """Business purpose: Expose clear model instructions without repeatedly sending developer documentation.

        Business rules:
        - Explicit descriptions guide invocation; the full business documentation remains on each implementation.
        - Typed argument validation, governed implementations and API failure feedback retain their existing authority.

        Execution flow:
        1. Bind the named implementation and its reviewed model-facing description.
        2. Attach the existing argument schema and structured rejection handlers.

        Failure cases:
        - Invalid tool configuration fails construction; argument and API errors retain their existing feedback.

        Side effects:
        - Constructs a tool object only; no domain state or provider request is changed during construction.
        """
        return StructuredTool.from_function(
            func=_guard(func),
            name=name,
            description=description,
            args_schema=schema,
            infer_schema=schema is None,
            handle_validation_error=_validation_feedback,
        )

    class _NoArgs(_Args):
        pass

    return [
        retrieve_shared_heuristics,
        tool(get_assessment_context, _NoArgs, "get_assessment_context",
             "Reload API-owned audit request, pins and source-view limits with bounded summaries. Call first. Facts, evidence and HITL history are paged through contextCollections; coverage is paged separately. Counts never authorize completion."),
        tool(get_assessment_context_page, GetAssessmentContextPageArgs, "get_assessment_context_page",
             "Read a byte-bounded page of facts, evidence, humanRequests or openHumanRequestIds using contextCollections.snapshotToken. Large records return detailRequired/detailIndex; use get_assessment_context_detail. A stale token requires reloading context."),
        tool(get_assessment_context_detail, GetAssessmentContextDetailArgs, "get_assessment_context_detail",
             "Read one exact large fact/evidence/HITL record by detailIndex. VALUE is complete; INDEX or TEXT/JSON fragments require continuation until nextOffset=null. This read never changes accepted authority."),
        tool(get_assessment_coverage, GetAssessmentCoverageArgs, "get_assessment_coverage",
             "Read a bounded page of the current audit request\'s per-rule coverage using coverageSummary.snapshotToken. Follow nextOffset until null for the complete inventory. A stale token requires reloading context; this read cannot decide or finalize a rule."),
        tool(get_pinned_rule_set, GetPinnedRuleSetArgs, "get_pinned_rule_set",
             "Discover only the audit request\'s authorized rules in pages capped at 4096 UTF-8 bytes. The requested limit is a maximum; follow the actual nextOffset until null. Rows with detailRequired retain identity only: use get_assessment_rule. Preserve progress; a page never defines the whole scope."),
        tool(get_assessment_rule, GetRuleArgs, "get_assessment_rule",
             "Load one authorized rule and its pinned legal context. Large results return detailRequired with a token and index; use get_assessment_rule_detail to read complete relevant criteria, requirements, applicabilityElements and legalSources. An index is not legal evidence."),
        tool(get_assessment_rule_detail, GetAssessmentRuleDetailArgs, "get_assessment_rule_detail",
             "Read an exact node from a pinned rule detail index. VALUE is complete; INDEX requires child reads. Concatenate TEXT_FRAGMENT/JSON_FRAGMENT pages in Unicode-code-point order until nextOffset=null; parse complete JSON fragments afterward. Never decide from partial legal text; stale tokens require reloading the rule."),
        tool(get_rule_decision, GetRuleDecisionArgs, "get_rule_decision",
             "Read a rule's newest or exact historical decision packet and references. Reconcile support against current sources and facts; structural acceptance never proves semantic correctness. This read does not roll back current revision authority."),
        tool(read_legal_source, ReadLegalSourceArgs, "read_legal_source",
             "Read one original provision and its provenance from this assessment's pinned legal source. Use its legalEffectStatus and source-defined scope; unavailable text cannot establish a legal duty."),
        tool(search_legal_source, SearchLegalSourceArgs, "search_legal_source",
             "Search pinned provision text for all query words. Inspect truncation and read relevant provisions; a text match alone determines neither applicability nor compliance."),
        tool(start_rule_investigation, StartInvestigationArgs, "start_rule_investigation",
             "Mark a pinned rule as being investigated through the governed API; no applicability or compliance verdict is created."),
        tool(cite_repository_source, CiteRepositorySourceArgs, "cite_repository_source",
             "Accept an exact source excerpt read and hashed from the pinned repository. Use canonical paths within sourcePathPrefix and the smallest supporting line range. Missing, out-of-scope or unavailable source cannot become evidence."),
        tool(record_search_coverage, RecordSearchCoverageArgs, "record_search_coverage",
             "Accept coverage from searches and reads actually recorded by the runtime. Use explicit source-scope paths; retain truncation and gaps. Your caveats do not prove a search ran, and a coverage record alone never proves absence."),
        tool(accept_case_fact, AcceptFactArgs, "accept_case_fact",
             "Record only what accepted source evidence supports, preserving scope and uncertainty. Code capability or a README claim does not establish real operator practice. Success advances caseRevision and invalidates older decisions; acceptance is not semantic certification."),
        tool(submit_rule_decision, SubmitDecisionArgs, "submit_rule_decision",
             "Submit supported findings for one pinned rule at current revisions. Address every material applicability element; NOT_ESTABLISHED supports neither verdict. APPLICABLE needs every criterion and consistent compliance. The API validates pins, references and revisions without choosing the conclusion."),
        tool(open_human_request, OpenHumanRequestArgs, "open_human_request",
             "Ask for a material missing fact after investigating sources and accepted facts. Anchor it to a criterion or legal element, using customer-safe wording and no requested legal verdict. The governed request pauses natively; explicit source sharing needs server validation."),
        tool(report_human_fact_unresolvable, ReportUnresolvableHumanFactArgs, "report_human_fact_unresolvable",
             "Report accepted evidence proving a material anchored fact permanently unobtainable. An unknown answer is insufficient. Retain the native human dependency even if the API rejects the claim; never manufacture a fact or verdict."),
        tool(report_existing_human_fact_unresolvable, ReportExistingUnresolvableHumanFactArgs, "report_existing_human_fact_unresolvable",
             "Report evidence proving permanent unavailability for the exact existing OPEN request from humanRequests. Do not duplicate the question; unknown alone is insufficient. Preserve all open dependencies in a native wait, including when the claim is rejected."),
        tool(wait_for_human_requests, _NoArgs, "wait_for_human_requests",
             "After authorized review of unknown answers, preserve all authoritative open requests at a native checkpoint. Create no repeated questions or assumed facts; unresolved feedback never authorizes a decision."),
        tool(request_finalization, _NoArgs, "request_finalization",
             "Ask the API gate to check the current authorized rules and dependencies. A completed SELECTED_RULES request ends a partial audit; FULL_RULE_SET may enter FINALIZING. The gate never chooses or repairs legal conclusions."),
        tool(submit_final_report, SubmitFinalReportArgs, "submit_final_report",
             "Submit authored findings for every decided rule only for FULL_RULE_SET after the Completion Gate permits it. Ground narrative in accepted evidence and decisions; omitted findings receive no invented positive text. The API validates and persists the final report."),
    ]


ROOT_TOOL_NAMES = (
    "retrieve_shared_heuristics",
    "get_assessment_context",
    "get_assessment_context_page",
    "get_assessment_context_detail",
    "get_assessment_coverage",
    "get_pinned_rule_set",
    "get_assessment_rule",
    "get_assessment_rule_detail",
    "get_rule_decision",
    "read_legal_source",
    "search_legal_source",
    "start_rule_investigation",
    "cite_repository_source",
    "record_search_coverage",
    "accept_case_fact",
    "submit_rule_decision",
    "open_human_request",
    "report_human_fact_unresolvable",
    "report_existing_human_fact_unresolvable",
    "wait_for_human_requests",
    "request_finalization",
    "submit_final_report",
)


def new_child_execution_id() -> str:
    return str(uuid.uuid4())
