from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal


AgenticToolExposure = Literal["LLM_CALLABLE", "ORCHESTRATOR_ONLY", "SYSTEM_ONLY"]


@dataclass(frozen=True)
class AgenticToolSpec:
    name: str
    description: str
    exposure: AgenticToolExposure
    mutation: bool
    max_items: int
    max_depth: int
    max_bytes: int
    max_duration_ms: int
    input_schema: dict[str, Any]
    required_artifacts: tuple[str, ...] = ()


def _closed_object(
    properties: dict[str, Any],
    *,
    required: tuple[str, ...] = (),
    min_properties: int | None = None,
    max_properties: int | None = None,
) -> dict[str, Any]:
    schema: dict[str, Any] = {
        "type": "object",
        "additionalProperties": False,
        "properties": properties,
    }
    if required:
        schema["required"] = list(required)
    if min_properties is not None:
        schema["minProperties"] = min_properties
    if max_properties is not None:
        schema["maxProperties"] = max_properties
    return schema


def _array(
    items: dict[str, Any],
    *,
    min_items: int | None = None,
    max_items: int | None = None,
    unique: bool = False,
) -> dict[str, Any]:
    schema: dict[str, Any] = {"type": "array", "items": items}
    if min_items is not None:
        schema["minItems"] = min_items
    if max_items is not None:
        schema["maxItems"] = max_items
    if unique:
        schema["uniqueItems"] = True
    return schema


_RELATIVE_PREFIX = {"type": "string", "pattern": r"^(?!/|.*\.\.)[A-Za-z0-9._/-]+/$"}
_START_REF = {"type": "string", "pattern": r"^(symbol|finding|node):[A-Za-z0-9_-]{8,120}$"}
_GAP_ROW_REF = {"type": "string", "pattern": r"^gap-row:[A-Za-z0-9_-]{6,80}$"}


AGENTIC_TOOL_SPECS: tuple[AgenticToolSpec, ...] = (
    AgenticToolSpec(
        name="resume_waiting_runs",
        description=(
            "Resume only durable workflow runs waiting for the exact newly activated "
            "compatible legal-corpus version. System-only; never model-callable."
        ),
        exposure="SYSTEM_ONLY",
        mutation=True,
        max_items=500,
        max_depth=1,
        max_bytes=131_072,
        max_duration_ms=30_000,
        input_schema=_closed_object(
            {
                "activationRecordRef": {
                    "type": "string",
                    "pattern": r"^corpus-approval:[A-Za-z0-9_-]{3,128}$",
                },
                "corpusVersionRef": {
                    "type": "string",
                    "pattern": r"^corpus-version:[A-Za-z0-9_-]{3,128}$",
                },
                "maxRuns": {"type": "integer", "minimum": 1, "maximum": 500},
                "idempotencyKey": {"type": "string", "format": "uuid"},
            },
            required=(
                "activationRecordRef",
                "corpusVersionRef",
                "maxRuns",
                "idempotencyKey",
            ),
        ),
    ),
    AgenticToolSpec(
        name="propose_gap_remediation",
        description=(
            "Create a bounded remediation proposal for one pinned gap row using only "
            "an approved template; never close or mutate the gap."
        ),
        exposure="LLM_CALLABLE",
        mutation=False,
        max_items=1,
        max_depth=1,
        max_bytes=131_072,
        max_duration_ms=4_000,
        input_schema=_closed_object(
            {
                "rowRef": _GAP_ROW_REF,
                "templateId": {
                    "type": "string",
                    "enum": [
                        "remediation:collect-evidence",
                        "remediation:resolve-conflict",
                        "remediation:expand-coverage",
                    ],
                },
            },
            required=("rowRef", "templateId"),
        ),
    ),
    AgenticToolSpec(
        name="get_gap_evidence_trace",
        description=(
            "Return bounded immutable provenance layers and the allowed resolver for one "
            "gap row without source bodies."
        ),
        exposure="LLM_CALLABLE",
        mutation=False,
        max_items=8,
        max_depth=8,
        max_bytes=131_072,
        max_duration_ms=2_000,
        input_schema=_closed_object(
            {"rowRef": _GAP_ROW_REF},
            required=("rowRef",),
        ),
    ),
    AgenticToolSpec(
        name="get_reconciliation_context",
        description=(
            "Return bounded conflict summaries and policy-permitted resolution paths for "
            "reconciliation; never resolve a material conflict."
        ),
        exposure="LLM_CALLABLE",
        mutation=False,
        max_items=50,
        max_depth=3,
        max_bytes=262_144,
        max_duration_ms=2_000,
        input_schema=_closed_object(
            {
                "flowRef": {
                    "type": "string",
                    "pattern": r"^flow:[A-Za-z0-9_-]{8,120}$",
                },
                "conflictIds": _array(
                    {
                        "type": "string",
                        "pattern": r"^conflict:[A-Za-z0-9_-]{8,120}$",
                    },
                    max_items=50,
                    unique=True,
                ),
                "statuses": _array(
                    {
                        "type": "string",
                        "enum": ["OPEN", "ESCALATED", "RESOLVED", "DISMISSED"],
                    },
                    max_items=4,
                    unique=True,
                ),
                "cursor": {"type": "string", "maxLength": 512},
                "maxResults": {"type": "integer", "minimum": 1, "maximum": 50},
            },
            required=("maxResults",),
            min_properties=1,
        ),
    ),
    AgenticToolSpec(
        name="request_targeted_reanalysis",
        description=(
            "Queue one allow-listed analyzer over bounded pinned evidence scope. "
            "Orchestrator-only; direct model access is prohibited."
        ),
        exposure="ORCHESTRATOR_ONLY",
        mutation=True,
        max_items=100,
        max_depth=3,
        max_bytes=131_072,
        max_duration_ms=10_000,
        required_artifacts=("technicalEvidenceReportId",),
        input_schema=_closed_object(
            {
                "inputArtifactVersion": {
                    "type": "string",
                    "pattern": r"^ter_[A-Za-z0-9_-]{8,120}$",
                },
                "analyzerId": {
                    "type": "string",
                    "enum": [
                        "RUN_SEMGREP_RULES",
                        "RUN_PYTHON_SEMANTIC_ANALYSIS",
                        "RUN_TS_JS_SEMANTIC_ANALYSIS",
                        "RUN_STRUCTURAL_AUGMENTATION",
                    ],
                },
                "scope": _closed_object(
                    {
                        "pathPrefixes": _array(
                            _RELATIVE_PREFIX,
                            min_items=1,
                            max_items=20,
                            unique=True,
                        ),
                        "subjectRefs": _array(
                            {
                                "type": "string",
                                "pattern": r"^(finding|symbol|node):[A-Za-z0-9_-]{8,120}$",
                            },
                            min_items=1,
                            max_items=50,
                            unique=True,
                        ),
                    },
                    min_properties=1,
                    max_properties=1,
                ),
                "reasonRequirementId": {
                    "type": "string",
                    "pattern": r"^requirement:[A-Za-z0-9_-]{8,120}$",
                },
                "idempotencyKey": {
                    "type": "string",
                    "pattern": r"^[A-Za-z0-9_-]{16,128}$",
                },
            },
            required=(
                "inputArtifactVersion",
                "analyzerId",
                "scope",
                "reasonRequirementId",
                "idempotencyKey",
            ),
        ),
    ),
    AgenticToolSpec(
        name="propose_missing_targets",
        description=(
            "Return bounded evidence-backed target candidates absent from submitted target "
            "IDs; candidates are proposals, not verified facts."
        ),
        exposure="LLM_CALLABLE",
        mutation=False,
        max_items=25,
        max_depth=3,
        max_bytes=262_144,
        max_duration_ms=3_000,
        required_artifacts=("technicalEvidenceReportId",),
        input_schema=_closed_object(
            {
                "candidateKinds": _array(
                    {
                        "type": "string",
                        "enum": [
                            "PROVIDER_USAGE",
                            "DATA_FLOW",
                            "DECISION_FLOW",
                            "HUMAN_REVIEW",
                            "DEPLOYMENT",
                        ],
                    },
                    min_items=1,
                    max_items=5,
                    unique=True,
                ),
                "seedRefs": _array(
                    {
                        "type": "string",
                        "pattern": r"^(finding|symbol|node|invocation):[A-Za-z0-9_-]{8,120}$",
                    },
                    max_items=20,
                    unique=True,
                ),
                "excludeTargetIds": _array(
                    {
                        "type": "string",
                        "pattern": r"^target:[A-Za-z0-9_-]{8,120}$",
                    },
                    max_items=100,
                    unique=True,
                ),
                "maxResults": {"type": "integer", "minimum": 1, "maximum": 25},
            },
            required=("candidateKinds", "maxResults"),
        ),
    ),
    AgenticToolSpec(
        name="inspect_deployment_context",
        description=(
            "Return sanitized deployment categories and evidence refs without manifest or "
            "configuration values."
        ),
        exposure="LLM_CALLABLE",
        mutation=False,
        max_items=100,
        max_depth=1,
        max_bytes=262_144,
        max_duration_ms=2_000,
        required_artifacts=("technicalEvidenceReportId",),
        input_schema=_closed_object(
            {
                "pathPrefixes": _array(_RELATIVE_PREFIX, max_items=20, unique=True),
                "manifestKinds": _array(
                    {
                        "type": "string",
                        "enum": [
                            "CONTAINER",
                            "KUBERNETES",
                            "CI_CD",
                            "INFRASTRUCTURE",
                            "RUNTIME_METADATA",
                        ],
                    },
                    max_items=5,
                    unique=True,
                ),
                "environments": _array(
                    {
                        "type": "string",
                        "enum": [
                            "DEVELOPMENT",
                            "TEST",
                            "STAGING",
                            "PRODUCTION",
                            "UNKNOWN",
                        ],
                    },
                    max_items=5,
                    unique=True,
                ),
                "cursor": {"type": "string", "maxLength": 512},
                "maxResults": {"type": "integer", "minimum": 1, "maximum": 100},
            },
            required=("maxResults",),
        ),
    ),
    AgenticToolSpec(
        name="inspect_decision_path",
        description=(
            "Return bounded structural score/rank/recommend/approve/reject/status facts "
            "without business or legal conclusions."
        ),
        exposure="LLM_CALLABLE",
        mutation=False,
        max_items=100,
        max_depth=20,
        max_bytes=262_144,
        max_duration_ms=3_000,
        required_artifacts=("technicalEvidenceReportId",),
        input_schema=_closed_object(
            {
                "startRef": _START_REF,
                "actionCategories": _array(
                    {
                        "type": "string",
                        "enum": [
                            "SCORE",
                            "RANK",
                            "RECOMMEND",
                            "APPROVE",
                            "REJECT",
                            "STATUS_CHANGE",
                        ],
                    },
                    max_items=6,
                    unique=True,
                ),
                "maxHops": {"type": "integer", "minimum": 1, "maximum": 20},
                "maxResults": {"type": "integer", "minimum": 1, "maximum": 100},
            },
            required=("startRef", "maxHops", "maxResults"),
        ),
    ),
    AgenticToolSpec(
        name="get_artifact_chain",
        description=(
            "Resolve immutable artifact lineage refs, versions, statuses and provenance only; "
            "never hydrate artifact payloads."
        ),
        exposure="LLM_CALLABLE",
        mutation=False,
        max_items=100,
        max_depth=10,
        max_bytes=262_144,
        max_duration_ms=1_000,
        input_schema=_closed_object(
            {
                "anchor": _closed_object(
                    {
                        "assessmentId": {
                            "type": "string",
                            "pattern": r"^assessment:[A-Za-z0-9_-]{8,120}$",
                        },
                        "artifactRef": {
                            "type": "string",
                            "pattern": r"^(ter|flow|conflict|verified):_[A-Za-z0-9_-]{8,120}$",
                        },
                    },
                    min_properties=1,
                    max_properties=1,
                ),
                "requiredStages": _array(
                    {
                        "type": "string",
                        "enum": [
                            "TECHNICAL_EVIDENCE",
                            "WIZARD_PROFILE",
                            "AI_USAGE_FLOW",
                            "CONFLICT",
                            "VERIFIED_PROFILE",
                        ],
                    },
                    max_items=5,
                    unique=True,
                ),
                "exactVersions": {"type": "boolean"},
            },
            required=("anchor",),
        ),
    ),
    AgenticToolSpec(
        name="find_similar_symbols",
        description=(
            "Return reproducible structural symbol candidates; similarity scores are not "
            "verification verdicts."
        ),
        exposure="LLM_CALLABLE",
        mutation=False,
        max_items=50,
        max_depth=3,
        max_bytes=262_144,
        max_duration_ms=2_000,
        required_artifacts=("technicalEvidenceReportId",),
        input_schema=_closed_object(
            {
                "seedSymbolRef": {
                    "type": "string",
                    "pattern": r"^symbol:[A-Za-z0-9_-]{8,120}$",
                },
                "dimensions": _array(
                    {
                        "type": "string",
                        "enum": [
                            "CALL_GRAPH",
                            "IMPORTS",
                            "DECORATORS",
                            "CATEGORIES",
                            "DATA_FLOW",
                        ],
                    },
                    min_items=1,
                    max_items=5,
                    unique=True,
                ),
                "pathPrefixes": _array(_RELATIVE_PREFIX, max_items=20, unique=True),
                "maxResults": {"type": "integer", "minimum": 1, "maximum": 50},
            },
            required=("seedSymbolRef", "dimensions", "maxResults"),
        ),
    ),
    AgenticToolSpec(
        name="inspect_human_review_path",
        description=(
            "Return bounded structural human-review evidence and PRESENT/ABSENT/UNKNOWN "
            "within the pinned static scope."
        ),
        exposure="LLM_CALLABLE",
        mutation=False,
        max_items=20,
        max_depth=20,
        max_bytes=262_144,
        max_duration_ms=3_000,
        required_artifacts=("technicalEvidenceReportId",),
        input_schema=_closed_object(
            {
                "startRef": _START_REF,
                "reviewKinds": _array(
                    {
                        "type": "string",
                        "enum": [
                            "QUEUE",
                            "ASSIGNMENT",
                            "APPROVAL",
                            "STATE_GATE",
                            "ESCALATION",
                        ],
                    },
                    max_items=5,
                    unique=True,
                ),
                "maxHops": {"type": "integer", "minimum": 1, "maximum": 20},
            },
            required=("startRef", "maxHops"),
        ),
    ),
    AgenticToolSpec(
        name="inspect_data_path",
        description=(
            "Return category-only ingress/schema/field-role paths without actual data values, "
            "schemas, defaults or prompts."
        ),
        exposure="LLM_CALLABLE",
        mutation=False,
        max_items=100,
        max_depth=20,
        max_bytes=262_144,
        max_duration_ms=3_000,
        required_artifacts=("technicalEvidenceReportId",),
        input_schema=_closed_object(
            {
                "startRef": _START_REF,
                "direction": {"type": "string", "enum": ["FORWARD", "BACKWARD"]},
                "dataCategories": _array(
                    {
                        "type": "string",
                        "enum": [
                            "IDENTIFIER",
                            "CONTACT",
                            "FINANCIAL",
                            "HEALTH",
                            "LEGAL",
                            "CONTENT",
                            "UNKNOWN",
                        ],
                    },
                    max_items=7,
                    unique=True,
                ),
                "maxHops": {"type": "integer", "minimum": 1, "maximum": 20},
                "maxResults": {"type": "integer", "minimum": 1, "maximum": 100},
            },
            required=("startRef", "direction", "maxHops", "maxResults"),
        ),
    ),
    AgenticToolSpec(
        name="find_provider_invocations",
        description=(
            "Return normalized provider invocation facts while keeping declared package or "
            "configuration signals separate from invocation proof."
        ),
        exposure="LLM_CALLABLE",
        mutation=False,
        max_items=100,
        max_depth=3,
        max_bytes=262_144,
        max_duration_ms=2_000,
        required_artifacts=("technicalEvidenceReportId",),
        input_schema=_closed_object(
            {
                "provider": {
                    "type": "string",
                    "enum": ["OPENAI", "GOOGLE", "ANTHROPIC", "AZURE_OPENAI", "OTHER"],
                },
                "framework": {
                    "type": "string",
                    "enum": ["LANGCHAIN", "LANGGRAPH", "GENAI_SDK", "OPENAI_SDK", "OTHER"],
                },
                "pathPrefixes": _array(_RELATIVE_PREFIX, max_items=20, unique=True),
                "maxResults": {"type": "integer", "minimum": 1, "maximum": 100},
            },
            required=("maxResults",),
        ),
    ),
    AgenticToolSpec(
        name="get_finding_detail",
        description=(
            "Resolve one normalized finding from the exact accepted report version and return "
            "only selected safe metadata fields."
        ),
        exposure="LLM_CALLABLE",
        mutation=False,
        max_items=1,
        max_depth=3,
        max_bytes=262_144,
        max_duration_ms=1_000,
        required_artifacts=("technicalEvidenceReportId",),
        input_schema=_closed_object(
            {
                "findingRef": {
                    "type": "string",
                    "pattern": r"^finding:[A-Za-z0-9_-]{8,120}$",
                },
                "include": _array(
                    {
                        "type": "string",
                        "enum": [
                            "LOCATION",
                            "CATEGORIES",
                            "CONFIDENCE",
                            "PROVENANCE",
                            "LIMITATIONS",
                            "RELATED_REFS",
                        ],
                    },
                    min_items=1,
                    max_items=6,
                    unique=True,
                ),
            },
            required=("findingRef", "include"),
        ),
    ),
    AgenticToolSpec(
        name="get_symbol_context",
        description=(
            "Return bounded symbol categories and one-hop sanitized adjacency without function "
            "bodies, AST or decorator arguments."
        ),
        exposure="LLM_CALLABLE",
        mutation=False,
        max_items=50,
        max_depth=1,
        max_bytes=262_144,
        max_duration_ms=2_000,
        required_artifacts=("technicalEvidenceReportId",),
        input_schema=_closed_object(
            {
                "symbolRef": {
                    "type": "string",
                    "pattern": r"^symbol:[A-Za-z0-9_-]{8,120}$",
                },
                "include": _array(
                    {
                        "type": "string",
                        "enum": [
                            "IMPORTS",
                            "DECORATORS",
                            "CATEGORIES",
                            "CALLERS",
                            "CALLEES",
                            "EVIDENCE_REFS",
                        ],
                    },
                    min_items=1,
                    max_items=6,
                    unique=True,
                ),
                "maxNeighbors": {"type": "integer", "minimum": 1, "maximum": 50},
            },
            required=("symbolRef", "include", "maxNeighbors"),
        ),
    ),
    AgenticToolSpec(
        name="get_scan_coverage",
        description=(
            "Return bounded file and tool coverage for one accepted TechnicalEvidenceReport; "
            "use before making a scoped evidence claim."
        ),
        exposure="LLM_CALLABLE",
        mutation=False,
        max_items=100,
        max_depth=1,
        max_bytes=262_144,
        max_duration_ms=2_000,
        required_artifacts=("technicalEvidenceReportId",),
        input_schema=_closed_object(
            {
                "pathPrefixes": _array(
                    _RELATIVE_PREFIX,
                    min_items=1,
                    max_items=20,
                    unique=True,
                ),
                "languages": _array(
                    {
                        "type": "string",
                        "enum": ["PYTHON", "TYPESCRIPT", "JAVASCRIPT", "OTHER"],
                    },
                    max_items=4,
                    unique=True,
                ),
                "dispositions": _array(
                    {
                        "type": "string",
                        "enum": ["ANALYZED", "SKIPPED", "LIMITED"],
                    },
                    max_items=3,
                    unique=True,
                ),
                "toolNames": _array(
                    {
                        "type": "string",
                        "enum": [
                            "materialize_snapshot",
                            "classify_workspace_languages",
                            "run_syft_inventory",
                            "run_semgrep_rules",
                            "run_knip_usage_analysis",
                            "run_deptry_usage_analysis",
                            "run_python_semantic_analysis",
                            "run_ts_js_semantic_analysis",
                            "run_structural_augmentation",
                            "build_evidence_graph",
                            "validate_evidence_report",
                        ],
                    },
                    max_items=11,
                    unique=True,
                ),
                "cursor": {"type": "string", "maxLength": 512},
                "maxResults": {"type": "integer", "minimum": 1, "maximum": 100},
            },
            required=("maxResults",),
        ),
    ),
    AgenticToolSpec(
        name="search_evidence",
        description=(
            "Search normalized findings in one accepted report with bounded typed filters; "
            "never perform raw-source or free-text repository search."
        ),
        exposure="LLM_CALLABLE",
        mutation=False,
        max_items=100,
        max_depth=3,
        max_bytes=262_144,
        max_duration_ms=2_000,
        required_artifacts=("technicalEvidenceReportId",),
        input_schema=_closed_object(
            {
                "findingKinds": _array(
                    {
                        "type": "string",
                        "enum": [
                            "AI_PROVIDER_INVOCATION",
                            "DATA_PATH",
                            "DECISION_PATH",
                            "HUMAN_REVIEW_PATH",
                            "DEPLOYMENT_CONTEXT",
                            "DEPENDENCY_SIGNAL",
                        ],
                    },
                    min_items=1,
                    max_items=10,
                    unique=True,
                ),
                "providers": _array(
                    {
                        "type": "string",
                        "enum": ["OPENAI", "GOOGLE", "ANTHROPIC", "AZURE_OPENAI", "OTHER"],
                    },
                    min_items=1,
                    max_items=10,
                    unique=True,
                ),
                "pathPrefixes": _array(
                    _RELATIVE_PREFIX,
                    min_items=1,
                    max_items=20,
                    unique=True,
                ),
                "minConfidence": {
                    "type": "string",
                    "enum": ["LOW", "MEDIUM", "HIGH"],
                },
                "cursor": {"type": "string", "maxLength": 512},
                "maxResults": {"type": "integer", "minimum": 1, "maximum": 100},
            },
            required=("maxResults",),
        ),
    ),
    AgenticToolSpec(
        name="get_evidence_subgraph",
        description=(
            "Traverse an explicitly seeded sanitized evidence graph with strict depth, node "
            "and edge caps; never hydrate node payloads."
        ),
        exposure="LLM_CALLABLE",
        mutation=False,
        max_items=100,
        max_depth=3,
        max_bytes=262_144,
        max_duration_ms=3_000,
        required_artifacts=("technicalEvidenceReportId",),
        input_schema=_closed_object(
            {
                "seedRef": {
                    "type": "string",
                    "pattern": r"^node:[A-Za-z0-9_-]{8,120}$",
                },
                "direction": {"type": "string", "enum": ["INBOUND", "OUTBOUND", "BOTH"]},
                "maxDepth": {"type": "integer", "minimum": 1, "maximum": 3},
                "maxNodes": {"type": "integer", "minimum": 1, "maximum": 100},
                "maxEdges": {"type": "integer", "minimum": 1, "maximum": 200},
                "nodeTypes": _array(
                    {
                        "type": "string",
                        "enum": ["FINDING", "SYMBOL", "FLOW_SEGMENT", "COVERAGE", "ARTIFACT"],
                    },
                    max_items=5,
                    unique=True,
                ),
                "edgeTypes": _array(
                    {
                        "type": "string",
                        "enum": ["EVIDENCES", "CALLS", "FLOWS_TO", "LIMITS", "DERIVED_FROM"],
                    },
                    max_items=5,
                    unique=True,
                ),
            },
            required=("seedRef", "direction", "maxDepth", "maxNodes", "maxEdges"),
        ),
    ),
    AgenticToolSpec(
        name="trace_static_flow",
        description=(
            "Trace a bounded normalized static path and stop explicitly at dynamic or "
            "unresolved boundaries; static traces are not runtime proof."
        ),
        exposure="LLM_CALLABLE",
        mutation=False,
        max_items=20,
        max_depth=20,
        max_bytes=262_144,
        max_duration_ms=3_000,
        required_artifacts=("technicalEvidenceReportId",),
        input_schema=_closed_object(
            {
                "startRef": _START_REF,
                "direction": {"type": "string", "enum": ["FORWARD", "BACKWARD"]},
                "desiredStages": _array(
                    {
                        "type": "string",
                        "enum": [
                            "INGRESS",
                            "TRANSFORM",
                            "PROVIDER_INVOCATION",
                            "OUTPUT",
                            "ACTION",
                            "REVIEW",
                        ],
                    },
                    min_items=1,
                    max_items=6,
                    unique=True,
                ),
                "maxHops": {"type": "integer", "minimum": 1, "maximum": 20},
            },
            required=("startRef", "direction", "maxHops"),
        ),
    ),
)


SPRINT6_AGENTIC_TOOL_SPEC_BY_NAME = {
    spec.name: spec for spec in AGENTIC_TOOL_SPECS
}

if len(SPRINT6_AGENTIC_TOOL_SPEC_BY_NAME) != len(AGENTIC_TOOL_SPECS):
    raise RuntimeError("Agentic tool names must be unique")


def llm_callable_tool_specs() -> tuple[AgenticToolSpec, ...]:
    return tuple(
        spec for spec in AGENTIC_TOOL_SPECS if spec.exposure == "LLM_CALLABLE"
    )
