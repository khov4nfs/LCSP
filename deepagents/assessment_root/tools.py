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
    # (legalRequirementId, kind, index) -> legal source text, per rule, for anchoring findings and questions.
    rule_elements: dict[str, dict[tuple[str, str, int], str]] = field(default_factory=dict)
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


class ApplicabilityBasisArgs(_Args):
    legal_requirement_id: str = Field(description="LegalRequirement that states the element.")
    kind: Literal["APPLICABILITY_CONDITION", "QUALIFIER", "EXCEPTION"]
    index: int = Field(ge=0, description="Position of the element in that list, as returned by get_assessment_rule.")
    finding: Literal["ESTABLISHED", "REFUTED", "NOT_ESTABLISHED"] = Field(
        description="What the accepted evidence/facts show about this element. NOT_ESTABLISHED when they do not settle it."
    )
    rationale: str = Field(min_length=1, description="Why the cited evidence/facts bear on THIS element of THIS rule.")
    references: list[DecisionReference] = Field(
        default_factory=list, description="Evidence/facts behind an ESTABLISHED or REFUTED finding."
    )


class ConditionRefArgs(_Args):
    legal_requirement_id: str
    kind: Literal["APPLICABILITY_CONDITION", "QUALIFIER", "EXCEPTION"]
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
            "Element-by-element findings for the applicability conditions, qualifiers and exceptions the linked "
            "requirements state. NOT_APPLICABLE needs an ESTABLISHED exception or a REFUTED condition, with references; "
            "APPLICABLE needs an ESTABLISHED condition and no refuting element. NOT_ESTABLISHED never supports either."
        ),
    )
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
    Execution flow:
    1. Enumerate the configured source element lists for every linked legal requirement.
    2. Return their exact text together with requirement, kind and index.
    Failure cases:
    - Absent element lists produce no entries; malformed required identities propagate to the caller.
    Side effects:
    - Pure projection; no facts, applicability findings or decisions are persisted.
    """
    return [
        {"legalRequirementId": requirement["legalRequirementId"], "kind": kind, "index": index, "text": text}
        for requirement in requirements
        for kind, key in _ELEMENT_LISTS
        for index, text in enumerate(requirement.get(key) or [])
    ]


def _repository_view(run: RootRun) -> dict[str, Any]:
    """Business purpose:
    Disclose the pinned sandbox's source limitations before the investigator reasons from absence.

    Business rules:
    - Only runtime metadata matching this assessment, snapshot and commit describes its source view.
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
        return unavailable
    marker = json.loads(files[0].content)
    expected = {"assessmentId": run.assessment_id, "snapshotId": run.pins["repositorySnapshotId"],
                "commitSha": run.pins["repositoryCommit"]}
    if not isinstance(marker, dict) or any(marker.get(key) != value for key, value in expected.items()):
        raise RuntimeError("repository view pins do not match the assessment")
    coverage = marker.get("sourceCoverage")
    return coverage if isinstance(coverage, dict) else unavailable


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


def build_root_tools(run: RootRun) -> list[StructuredTool]:
    """Business purpose: Expose the governed investigation and reporting operations of one customer Assessment Root.

    Business rules:
    - All tools share this Root run and its authoritative case pins; the model owns semantic conclusions.
    - Schema validation and API failure feedback must not fabricate accepted evidence or positive verdicts.
    Execution flow:
    1. Bind context, legal-source, repository-evidence, decision, human-resolution and report functions to this run.
    2. Wrap the named functions with their typed schemas and API problem feedback.
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
        - Runtime source metadata must match those pins; incomplete visibility cannot establish absence.

        Execution flow:
        1. Load and adopt the API's current case revision and immutable pins.
        2. Verify the runtime source view and project accepted evidence, facts and per-rule coverage.

        Failure cases:
        - API failures remain rejection feedback; conflicting sandbox pins fail context retrieval.

        Side effects:
        - Updates in-memory Root pins and revision caches; does not persist decisions or facts.
        """
        context = client.context()
        run.adopt_context(context)
        return {
            "ok": True,
            "caseRevision": context["caseRevision"],
            "pins": run.pins,
            "repositoryView": _repository_view(run),
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
        """Business purpose: Load one pinned rule together with the legal requirements and source-defined context needed to assess it.

        Business rules:
        - Rules must belong to the pinned Rule Set; applicability addresses come from linked requirements, not guessed conditions.
        Execution flow:
        1. Find the requested rule and collect its outgoing context relations and related requirements.
        2. Cache the linked applicability addresses for anchored human questions.
        3. Return the full rule, requirements, context, applicability elements and provisions worth reading.
        Failure cases:
        - An unknown identifier returns RULE_NOT_IN_RULE_SET without creating a replacement rule.
        Side effects:
        - Reads the Rule Set API and updates only this execution’s applicability-element cache.
        """
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
    ) -> dict[str, Any]:
        content = {
            "assessmentRuleId": assessment_rule_id,
            "criterionIds": criterion_ids or [],
            "question": question,
            "unresolvedFact": unresolved_fact,
            "decisionImpact": list(decision_impact),
            "resolutionAttempts": list(resolution_attempts),
            "controlType": control_type,
            "choices": choices or [],
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
        condition_ref: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Business purpose: Ask the customer for a material missing fact after investigating the repository and pinned legal sources.

        Business rules:
        - The fact must settle a named criterion or source-stated condition; an unanswered question cannot become a compliance verdict.
        Execution flow:
        1. Verify the question’s criterion or condition anchor.
        2. Persist the governed human request and interrupt the native graph with its request identity.
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
            impact, resolution_attempts, criterion_ids, control_type, choices)
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
            criterion_ids, control_type, choices)
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
        tool(read_legal_source, ReadLegalSourceArgs, "read_legal_source"),
        tool(search_legal_source, SearchLegalSourceArgs, "search_legal_source"),
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
    "read_legal_source",
    "search_legal_source",
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
