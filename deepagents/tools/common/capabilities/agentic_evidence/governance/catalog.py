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
)


ENGINEERING_RULE_AGENTIC_TOOL_SPEC_BY_NAME = {
    spec.name: spec for spec in AGENTIC_TOOL_SPECS
}

if len(ENGINEERING_RULE_AGENTIC_TOOL_SPEC_BY_NAME) != len(AGENTIC_TOOL_SPECS):
    raise RuntimeError("Agentic tool names must be unique")


def llm_callable_tool_specs() -> tuple[AgenticToolSpec, ...]:
    return tuple(
        spec for spec in AGENTIC_TOOL_SPECS if spec.exposure == "LLM_CALLABLE"
    )
