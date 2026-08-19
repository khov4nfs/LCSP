"""LLM-guided, evidence-bounded investigation over the Program Evidence Graph."""
from __future__ import annotations

import hashlib
import json
from typing import Any, Callable

from lcsp_workers.llm import LLMToolDefinition
from lcsp_workers.llm.fallback_client import LLMClientProtocol
from lcsp_workers.platform.logging import get_logger
from lcsp_workers.platform.tracing import traceable
from lcsp_workers.scanner.program_graph.query_engine import ProgramGraphQueryEngine
from lcsp_workers.scanner.program_graph.vocabulary import EDGE_TYPES, NODE_TYPES

from .evidence_claim_validator import EvidenceClaimValidationError, EvidenceClaimValidator
from .evidence_ledger import EvidenceLedger
from .models import (
    ENGINEERING_EVIDENCE_CLAIM_TYPES,
    ENGINEERING_LIMITATION_CODES,
    MODEL_SELECTABLE_LIMITATION_CODES,
    EvidenceClaim,
    InvestigationPacket,
)


logger = get_logger(__name__)
MAX_INVESTIGATION_STEPS = 8
MAX_GRAPH_TOOL_STEPS = 4
MAX_WORKING_RESULTS = 4
MAX_WORKING_RESULT_CHARS = 24_000
MAX_PROMPT_CHARS = 110_000
FINISH_TOOL_NAME = "finish"
GRAPH_TOOL_NAMES = (
    "search_nodes",
    "trace_static_flow",
    "inspect_data_path",
    "inspect_decision_path",
    "inspect_human_review_path",
    "symbol_context",
    "provider_invocations",
)
STATE_TOOL_NAMES = (
    "list_observations",
    "inspect_observation",
)
CANONICAL_CLAIM_TYPES = frozenset(ENGINEERING_EVIDENCE_CLAIM_TYPES.values())
CLAIM_VALUE_BY_TYPE: dict[str, bool | None] = {
    ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"]: True,
    ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_not_met"]: False,
    ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"]: None,
}


class LawGuidedInvestigator:
    """Let the LLM investigate graph evidence through orchestrator-owned state.

    Full seed/tool results live in a lossless ``EvidenceLedger`` for the duration
    of the EngineeringRule run. The model sees only a pageable working view and can
    explicitly reload any observation by ID. The prompt is therefore not the source
    of truth and no observation is silently dropped to satisfy provider context limits.
    """

    def __init__(self, llm_client: LLMClientProtocol) -> None:
        self.llm = llm_client
        self.validator = EvidenceClaimValidator()

    @traceable(run_type="chain", name="LawGuidedInvestigator.investigate")
    def investigate(
        self,
        *,
        packet: InvestigationPacket,
        graph,
        workflow_run_id: str,
        correlation_id: str | None = None,
    ) -> list[EvidenceClaim]:
        engine = ProgramGraphQueryEngine(graph)
        ledger = EvidenceLedger()
        for item in packet.initial_results:
            ledger.add(source="engineering_rule_seed_query", result=item)
        if packet.wizard_context:
            ledger.add(source="wizard_context", result=dict(packet.wizard_context))

        tools = self._tool_definitions()
        graph_tool_calls_used = 0
        working_results: list[dict[str, Any]] = []

        for step in range(MAX_INVESTIGATION_STEPS):
            response = self.llm.complete_with_tools(
                prompt=self._prompt(packet, ledger, working_results, step),
                tools=tools,
                workflow_run_id=workflow_run_id,
                node_name="investigate_engineering_rule",
                max_tokens=3500,
                correlationId=correlation_id,
            )

            if not response.tool_calls:
                logger.warning(
                    "ENGINEERING_INVESTIGATION_NO_NATIVE_TOOL_CALL",
                    engineering_rule_id=packet.engineering_rule_id,
                    step=step + 1,
                    workflow_run_id=workflow_run_id,
                    correlationId=correlation_id,
                )
                continue

            for call in response.tool_calls:
                arguments = self._bounded_debug(call.arguments)
                logger.info(
                    "ENGINEERING_INVESTIGATION_TOOL_CALL",
                    engineering_rule_id=packet.engineering_rule_id,
                    step=step + 1,
                    tool=call.name,
                    call_id=call.call_id,
                    arguments=arguments,
                    graph_tool_calls_used=graph_tool_calls_used,
                    ledger_observation_count=ledger.total,
                    workflow_run_id=workflow_run_id,
                    correlationId=correlation_id,
                )

                if call.name == FINISH_TOOL_NAME:
                    claims = self._claims_from_finish_arguments(
                        call.arguments,
                        packet,
                        graph,
                        ledger,
                    )
                    self._log_finish(
                        packet=packet,
                        claims=claims,
                        workflow_run_id=workflow_run_id,
                        correlation_id=correlation_id,
                        forced=False,
                        ledger=ledger,
                    )
                    return claims

                if call.name in GRAPH_TOOL_NAMES:
                    if graph_tool_calls_used >= MAX_GRAPH_TOOL_STEPS:
                        tool_result = {
                            "error": "GRAPH_TOOL_BUDGET_EXHAUSTED",
                            "graphToolCallsUsed": graph_tool_calls_used,
                        }
                    else:
                        graph_tool_calls_used += 1
                        raw_result = self._execute_graph_tool(
                            engine,
                            call.name,
                            call.arguments,
                        )
                        observation = ledger.add(
                            source="graph_tool",
                            tool=call.name,
                            call_id=call.call_id,
                            arguments=dict(call.arguments),
                            result=raw_result,
                        )
                        tool_result = {
                            "observationId": observation.observation_id,
                            "summary": ledger.summary(observation),
                            "preview": ledger.preview(observation.observation_id, limit=6),
                            "instruction": (
                                "Full result is retained by LCSP. Use the availableSections in "
                                "the observation summary when more detail is required."
                            ),
                        }
                elif call.name == "list_observations":
                    tool_result = ledger.index(
                        offset=int(call.arguments.get("offset") or 0),
                        limit=int(call.arguments.get("limit") or 20),
                    )
                elif call.name == "inspect_observation":
                    try:
                        tool_result = ledger.inspect(
                            str(call.arguments.get("observation_id") or ""),
                            section=(
                                str(call.arguments.get("section"))
                                if call.arguments.get("section")
                                else None
                            ),
                            offset=int(call.arguments.get("offset") or 0),
                            limit=int(call.arguments.get("limit") or 12),
                        )
                    except KeyError as error:
                        tool_result = {
                            "error": "UNKNOWN_OBSERVATION_REF",
                            "detail": str(error),
                        }
                else:
                    tool_result = {
                        "error": "UNKNOWN_INVESTIGATION_TOOL",
                        "allowedTools": sorted(
                            {*GRAPH_TOOL_NAMES, *STATE_TOOL_NAMES, FINISH_TOOL_NAME}
                        ),
                    }

                working_result = self._fit_working_result(tool_result)
                logger.info(
                    "ENGINEERING_INVESTIGATION_TOOL_RESULT",
                    engineering_rule_id=packet.engineering_rule_id,
                    step=step + 1,
                    tool=call.name,
                    call_id=call.call_id,
                    result=working_result,
                    graph_tool_calls_used=graph_tool_calls_used,
                    ledger_observation_count=ledger.total,
                    workflow_run_id=workflow_run_id,
                    correlationId=correlation_id,
                )
                working_results.append(
                    {
                        "step": step + 1,
                        "tool": call.name,
                        "callId": call.call_id,
                        "result": working_result,
                    }
                )
                working_results = working_results[-MAX_WORKING_RESULTS:]

        response = self.llm.complete_with_tools(
            prompt=self._finish_prompt(packet, ledger, working_results),
            tools=[self._finish_tool_definition()],
            workflow_run_id=workflow_run_id,
            node_name="investigate_engineering_rule_finish",
            max_tokens=3000,
            correlationId=correlation_id,
        )
        for call in response.tool_calls:
            if call.name == FINISH_TOOL_NAME:
                claims = self._claims_from_finish_arguments(
                    call.arguments,
                    packet,
                    graph,
                    ledger,
                )
                self._log_finish(
                    packet=packet,
                    claims=claims,
                    workflow_run_id=workflow_run_id,
                    correlation_id=correlation_id,
                    forced=True,
                    ledger=ledger,
                )
                return claims

        logger.warning(
            "ENGINEERING_INVESTIGATION_FINISH_MISSING",
            engineering_rule_id=packet.engineering_rule_id,
            ledger_observation_count=ledger.total,
            workflow_run_id=workflow_run_id,
            correlationId=correlation_id,
        )
        return self._claims_from_payload({}, packet, graph, ledger)

    def _execute_graph_tool(
        self,
        engine: ProgramGraphQueryEngine,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any] | list[dict[str, Any]]:
        tools: dict[str, Callable[..., Any]] = {
            "search_nodes": engine.search_nodes,
            "trace_static_flow": engine.trace_static_flow,
            "inspect_data_path": engine.inspect_data_path,
            "inspect_decision_path": engine.inspect_decision_path,
            "inspect_human_review_path": engine.inspect_human_review_path,
            "symbol_context": engine.symbol_context,
            "provider_invocations": engine.provider_invocations,
        }
        tool = tools.get(tool_name)
        if tool is None:
            return {"error": "UNKNOWN_GRAPH_TOOL", "allowedTools": sorted(tools)}
        try:
            result = tool(**self._normalize_tool_arguments(tool_name, arguments))
        except (TypeError, ValueError) as error:
            return {
                "error": "INVALID_GRAPH_TOOL_ARGUMENTS",
                "tool": tool_name,
                "errorType": type(error).__name__,
                "detail": str(error)[:500],
            }
        return result.to_dict() if hasattr(result, "to_dict") else result

    @staticmethod
    def _normalize_tool_arguments(
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        aliases = {
            "nodeTypes": "node_types",
            "pathPrefixes": "path_prefixes",
            "semanticTypes": "semantic_types",
            "maxResults": "max_results",
            "startRef": "start_ref",
            "maxHops": "max_hops",
            "edgeTypes": "edge_types",
            "stopNodeTypes": "stop_node_types",
            "actionCategories": "action_categories",
            "symbolRef": "symbol_ref",
            "maxNeighbors": "max_neighbors",
        }
        normalized = {aliases.get(key, key): value for key, value in arguments.items()}
        LawGuidedInvestigator._validate_graph_vocabulary(
            "node_types", normalized.get("node_types"), NODE_TYPES
        )
        LawGuidedInvestigator._validate_graph_vocabulary(
            "stop_node_types", normalized.get("stop_node_types"), NODE_TYPES
        )
        LawGuidedInvestigator._validate_graph_vocabulary(
            "edge_types", normalized.get("edge_types"), EDGE_TYPES
        )
        if tool_name == "search_nodes":
            normalized.setdefault("max_results", 25)
        elif tool_name in {
            "trace_static_flow",
            "inspect_data_path",
            "inspect_decision_path",
            "inspect_human_review_path",
        }:
            normalized.setdefault("max_results", 80)
        return normalized

    @staticmethod
    def _validate_graph_vocabulary(
        field_name: str,
        value: Any,
        allowed: frozenset[str],
    ) -> None:
        if value is None:
            return
        if not isinstance(value, (list, tuple)):
            raise ValueError(f"{field_name} must be an array")
        invalid = sorted({str(item) for item in value if str(item) not in allowed})
        if invalid:
            raise ValueError(
                f"{field_name} contains non-canonical Program Evidence Graph values: {invalid}"
            )

    @classmethod
    def _tool_definitions(cls) -> list[LLMToolDefinition]:
        string_array = {"type": "array", "items": {"type": "string"}}
        node_type_array = {
            "type": "array",
            "items": {"type": "string", "enum": sorted(NODE_TYPES)},
        }
        edge_type_array = {
            "type": "array",
            "items": {"type": "string", "enum": sorted(EDGE_TYPES)},
        }
        graph_tools = [
            LLMToolDefinition(
                name="search_nodes",
                description=(
                    "Search bounded Program Evidence Graph nodes by canonical structural node type, "
                    "source path, semantic type, or text. requiredEvidence/supportingEvidence labels "
                    "are not node types. Results expose a canonical truncated flag."
                ),
                input_schema=cls._closed_schema(
                    {
                        "node_types": node_type_array,
                        "text": {"type": "string"},
                        "path_prefixes": string_array,
                        "semantic_types": string_array,
                        "max_results": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 25,
                        },
                    }
                ),
            ),
            LLMToolDefinition(
                name="trace_static_flow",
                description=(
                    "Trace bounded static control/data/event flow from a graph node ref using only "
                    "canonical edge/node vocabulary. Use result.truncated rather than resource limits."
                ),
                input_schema=cls._closed_schema(
                    {
                        "start_ref": {"type": "string"},
                        "direction": {
                            "type": "string",
                            "enum": ["FORWARD", "BACKWARD", "BOTH"],
                        },
                        "max_hops": {"type": "integer", "minimum": 1, "maximum": 12},
                        "edge_types": edge_type_array,
                        "stop_node_types": node_type_array,
                        "max_results": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 80,
                        },
                    },
                    required=("start_ref",),
                ),
            ),
            LLMToolDefinition(
                name="inspect_data_path",
                description=(
                    "Inspect bounded data-flow evidence from a graph node ref. "
                    "Use result.truncated as the only search-completeness signal."
                ),
                input_schema=cls._closed_schema(
                    {
                        "start_ref": {"type": "string"},
                        "direction": {
                            "type": "string",
                            "enum": ["FORWARD", "BACKWARD", "BOTH"],
                        },
                        "max_hops": {"type": "integer", "minimum": 1, "maximum": 10},
                        "max_results": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 80,
                        },
                    },
                    required=("start_ref",),
                ),
            ),
            LLMToolDefinition(
                name="inspect_decision_path",
                description=(
                    "Inspect bounded decision/action flow evidence from a graph node ref. "
                    "Use result.truncated as the only search-completeness signal."
                ),
                input_schema=cls._closed_schema(
                    {
                        "start_ref": {"type": "string"},
                        "max_hops": {"type": "integer", "minimum": 1, "maximum": 12},
                        "action_categories": string_array,
                        "max_results": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 80,
                        },
                    },
                    required=("start_ref",),
                ),
            ),
            LLMToolDefinition(
                name="inspect_human_review_path",
                description=(
                    "Inspect bounded human-review/override evidence from a graph node ref. "
                    "Use result.truncated as the only search-completeness signal."
                ),
                input_schema=cls._closed_schema(
                    {
                        "start_ref": {"type": "string"},
                        "max_hops": {"type": "integer", "minimum": 1, "maximum": 12},
                        "max_results": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 80,
                        },
                    },
                    required=("start_ref",),
                ),
            ),
            LLMToolDefinition(
                name="symbol_context",
                description=(
                    "Resolve one symbol/node ref and return bounded neighboring context with "
                    "the same truncated search contract."
                ),
                input_schema=cls._closed_schema(
                    {
                        "symbol_ref": {"type": "string"},
                        "max_neighbors": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 50,
                        },
                    },
                    required=("symbol_ref",),
                ),
            ),
            LLMToolDefinition(
                name="provider_invocations",
                description=(
                    "Return bounded AI model invocation nodes, optionally by provider, with "
                    "the same truncated search contract."
                ),
                input_schema=cls._closed_schema(
                    {
                        "provider": {"type": "string"},
                        "max_results": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 80,
                        },
                    }
                ),
            ),
        ]
        state_tools = [
            LLMToolDefinition(
                name="list_observations",
                description=(
                    "Page the LCSP EvidenceLedger index. Every summary advertises exact "
                    "availableSections; use those names rather than guessing a section shape."
                ),
                input_schema=cls._closed_schema(
                    {
                        "offset": {"type": "integer", "minimum": 0},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 40},
                    }
                ),
            ),
            LLMToolDefinition(
                name="inspect_observation",
                description=(
                    "Page one EvidenceLedger observation. If section is supplied it must be one of "
                    "that observation summary's availableSections; pages are automatically char-bounded."
                ),
                input_schema=cls._closed_schema(
                    {
                        "observation_id": {"type": "string"},
                        "section": {"type": "string"},
                        "offset": {"type": "integer", "minimum": 0},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 40},
                    },
                    required=("observation_id",),
                ),
            ),
        ]
        return [*graph_tools, *state_tools, cls._finish_tool_definition()]

    @classmethod
    def _finish_tool_definition(cls) -> LLMToolDefinition:
        claim_schema = cls._closed_schema(
            {
                "criterion": {
                    "type": "string",
                    "description": (
                        "Exact requiredEvidence criterion label this claim resolves. "
                        "Use one of the labels provided in the EngineeringRule prompt."
                    ),
                },
                "claimType": {
                    "type": "string",
                    "enum": sorted(CANONICAL_CLAIM_TYPES),
                },
                "observationRefs": {
                    "type": "array",
                    "items": {"type": "string"},
                    "maxItems": 12,
                },
                "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                "limitations": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": sorted(MODEL_SELECTABLE_LIMITATION_CODES),
                    },
                },
            },
            required=(
                "criterion",
                "claimType",
                "observationRefs",
                "confidence",
                "limitations",
            ),
        )
        return LLMToolDefinition(
            name=FINISH_TOOL_NAME,
            description=(
                "Finish with one technical claim per requiredEvidence criterion. Reference LCSP "
                "observation IDs only; LCSP derives immutable graph/source provenance."
            ),
            input_schema=cls._closed_schema(
                {
                    "claims": {
                        "type": "array",
                        "items": claim_schema,
                        "minItems": 1,
                        "maxItems": 12,
                    }
                },
                required=("claims",),
            ),
            tool_choice_required=True,
        )

    @staticmethod
    def _closed_schema(
        properties: dict[str, Any],
        *,
        required: tuple[str, ...] = (),
    ) -> dict[str, Any]:
        schema: dict[str, Any] = {
            "type": "object",
            "additionalProperties": False,
            "properties": properties,
        }
        if required:
            schema["required"] = list(required)
        return schema

    def _claims_from_finish_arguments(
        self,
        arguments: dict[str, Any],
        packet: InvestigationPacket,
        graph,
        ledger: EvidenceLedger,
    ) -> list[EvidenceClaim]:
        return self._claims_from_payload(
            {"claims": arguments.get("claims")},
            packet,
            graph,
            ledger,
        )

    def _claims_from_payload(
        self,
        payload: dict[str, Any],
        packet: InvestigationPacket,
        graph,
        ledger: EvidenceLedger,
    ) -> list[EvidenceClaim]:
        rows = payload.get("claims")
        if not isinstance(rows, list):
            rows = []
        result: list[EvidenceClaim] = []
        required_criteria = tuple(dict.fromkeys(packet.required_evidence))

        for index, item in enumerate(rows, 1):
            if not isinstance(item, dict):
                continue
            claim_type = str(
                item.get("claimType")
                or ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"]
            ).strip().upper()
            if claim_type not in CANONICAL_CLAIM_TYPES:
                claim_type = ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"]

            raw_criterion = str(item.get("criterion") or "").strip()
            invalid_criterion = False
            criterion: str | None
            if raw_criterion:
                criterion = raw_criterion if raw_criterion in required_criteria else None
                invalid_criterion = bool(required_criteria) and criterion is None
            elif len(required_criteria) == 1:
                # Compatibility for older deterministic tests/provider fixtures. Runtime
                # schemas now require criterion explicitly.
                criterion = required_criteria[0]
            elif required_criteria:
                criterion = None
                invalid_criterion = True
            else:
                criterion = None

            limitations, invalid_limitation = self._normalize_limitations(
                item.get("limitations")
            )
            observation_refs = tuple(
                dict.fromkeys(
                    str(value)
                    for value in item.get("observationRefs") or []
                    if str(value)
                )
            )

            if invalid_criterion:
                claim_type = ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"]
                limitations = (
                    *limitations,
                    ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"],
                )
            if invalid_limitation:
                claim_type = ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"]
                limitations = (
                    *limitations,
                    ENGINEERING_LIMITATION_CODES["model_limitation_code_invalid"],
                )

            try:
                provenance = ledger.provenance_for(observation_refs)
            except KeyError as error:
                logger.warning(
                    "ENGINEERING_INVESTIGATION_CLAIM_REJECTED",
                    engineering_rule_id=packet.engineering_rule_id,
                    criterion=criterion,
                    claim_type=claim_type,
                    observation_refs=list(observation_refs),
                    error_type=type(error).__name__,
                    error_message=str(error)[:2000],
                )
                claim_type = ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"]
                limitations = (
                    *limitations,
                    ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"],
                )
                provenance = ledger.provenance_for(())

            has_provenance = bool(
                provenance.evidence_refs
                or provenance.graph_refs
                or provenance.source_anchor_refs
            )
            if (
                claim_type
                in {
                    ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"],
                    ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_not_met"],
                }
                and not has_provenance
            ):
                claim_type = ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"]
                limitations = (
                    *limitations,
                    ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"],
                )

            claim_value = CLAIM_VALUE_BY_TYPE[claim_type]
            seed = (
                f"{packet.engineering_rule_id}:{index}:{criterion}:{claim_type}:"
                f"{observation_refs}:{provenance}:{claim_value}:{limitations}"
            )
            claim = EvidenceClaim(
                "claim:" + hashlib.sha256(seed.encode()).hexdigest()[:24],
                packet.engineering_rule_id,
                claim_type,
                claim_value,
                provenance.evidence_refs,
                provenance.graph_refs,
                provenance.source_anchor_refs,
                float(item.get("confidence") or 0),
                tuple(dict.fromkeys(limitations)),
                criterion,
            )

            if (
                claim_type == ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"]
                and not has_provenance
            ):
                result.append(claim)
                continue

            try:
                result.append(self.validator.validate(claim, graph))
            except EvidenceClaimValidationError as error:
                logger.warning(
                    "ENGINEERING_INVESTIGATION_CLAIM_REJECTED",
                    engineering_rule_id=packet.engineering_rule_id,
                    criterion=criterion,
                    claim_id=claim.claim_id,
                    claim_type=claim.claim_type,
                    observation_refs=list(observation_refs),
                    error_type=type(error).__name__,
                    error_message=str(error)[:2000],
                    evidence_ref_count=len(claim.evidence_refs),
                    graph_path_ref_count=len(claim.graph_path_refs),
                    source_anchor_ref_count=len(claim.source_anchor_refs),
                )
                result.append(
                    EvidenceClaim(
                        claim_id=claim.claim_id + ":unresolved",
                        engineering_rule_id=packet.engineering_rule_id,
                        claim_type=ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"],
                        value=None,
                        evidence_refs=(),
                        confidence=0.0,
                        limitations=(
                            ENGINEERING_LIMITATION_CODES[
                                "engineering_evidence_insufficient"
                            ],
                        ),
                        criterion=criterion,
                    )
                )

        if result:
            return result

        return [
            EvidenceClaim(
                "claim:"
                + hashlib.sha256(
                    f"{packet.engineering_rule_id}:empty".encode()
                ).hexdigest()[:24],
                packet.engineering_rule_id,
                ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"],
                None,
                (),
                confidence=0.0,
                limitations=(
                    ENGINEERING_LIMITATION_CODES[
                        "investigation_returned_no_valid_claims"
                    ],
                ),
            )
        ]

    @staticmethod
    def _normalize_limitations(value: Any) -> tuple[tuple[str, ...], bool]:
        if value is None:
            return (), False
        if not isinstance(value, list):
            return (), True
        allowed = set(MODEL_SELECTABLE_LIMITATION_CODES)
        result: list[str] = []
        invalid = False
        for item in value:
            code = str(item).strip().upper()
            if not code:
                continue
            if code not in allowed:
                invalid = True
                continue
            if code not in result:
                result.append(code)
        return tuple(result), invalid

    @staticmethod
    def _bounded_debug(value: Any, *, depth: int = 5) -> Any:
        if depth <= 0:
            return "[BOUNDED]"
        if isinstance(value, tuple):
            value = list(value)
        if isinstance(value, list):
            return [
                LawGuidedInvestigator._bounded_debug(item, depth=depth - 1)
                for item in value[:20]
            ]
        if isinstance(value, dict):
            return {
                str(key): LawGuidedInvestigator._bounded_debug(
                    item,
                    depth=depth - 1,
                )
                for key, item in list(value.items())[:20]
            }
        if isinstance(value, str) and len(value) > 2000:
            return value[:2000] + "…"
        return value

    @classmethod
    def _fit_working_result(cls, value: Any) -> Any:
        rendered = json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
        if len(rendered) <= MAX_WORKING_RESULT_CHARS:
            return value
        observation_id = value.get("observationId") if isinstance(value, dict) else None
        section = value.get("section") if isinstance(value, dict) else None
        return {
            "error": "WORKING_VIEW_TOO_LARGE",
            "observationId": observation_id,
            "section": section,
            "renderedChars": len(rendered),
            "instruction": (
                "Full observation remains in the EvidenceLedger. Retry inspect_observation "
                "with a smaller limit or a narrower section."
            ),
        }

    @staticmethod
    def _rule_contract(packet: InvestigationPacket) -> dict[str, Any]:
        return {
            "engineeringRuleId": packet.engineering_rule_id,
            "concept": packet.concept,
            "investigationGoals": list(packet.investigation_goals),
            "startingNodeTypes": list(packet.starting_node_types),
            "targetNodeTypes": list(packet.target_node_types),
            "edgeStrategies": list(packet.edge_strategies),
            "graphQueries": list(packet.graph_queries),
            "retrievalHints": {
                "keywords": list(packet.keywords),
                "commonApis": list(packet.common_apis),
                "commonLibraries": list(packet.common_libraries),
                "patterns": list(packet.patterns),
            },
            "requiredEvidence": list(packet.required_evidence),
            "supportingEvidence": list(packet.supporting_evidence),
            "negativeEvidence": list(packet.negative_evidence),
            "unresolvedConditions": list(packet.unresolved_conditions),
        }

    @classmethod
    def _render_prompt(cls, contract: dict[str, Any]) -> str:
        rendered = json.dumps(contract, ensure_ascii=False, sort_keys=True)
        if len(rendered) > MAX_PROMPT_CHARS:
            raise ValueError("ENGINEERING_INVESTIGATION_WORKING_CONTEXT_EXCEEDED")
        return rendered

    @classmethod
    def _prompt(
        cls,
        packet: InvestigationPacket,
        ledger: EvidenceLedger,
        working_results: list[dict[str, Any]],
        step: int,
    ) -> str:
        return cls._render_prompt(
            {
                "task": (
                    "Investigate the EngineeringRule against the Program Evidence Graph. "
                    "The LCSP EvidenceLedger is the source of truth; this prompt is only a working view. "
                    "Use the EngineeringRule-owned graph/retrieval hints before broad search, inspect only "
                    "advertised observation sections, and finish when sufficiently evidenced. "
                    "Never decide legal compliance, certification, or infer facts outside evidence."
                ),
                "engineeringRule": cls._rule_contract(packet),
                "evidenceLedger": ledger.index(offset=0, limit=20),
                "seedContext": {
                    "seedEvidenceRefCount": len(packet.evidence_refs),
                    "unresolvedFrontierCount": len(packet.unresolved_frontiers),
                    "wizardContextStored": bool(packet.wizard_context),
                },
                "recentToolResults": working_results[-MAX_WORKING_RESULTS:],
                "nativeToolStep": step + 1,
                "claimRules": [
                    "startingNodeTypes, targetNodeTypes, graphQueries and edgeStrategies are canonical graph retrieval hints; use them rather than inventing graph types.",
                    "requiredEvidence, supportingEvidence and negativeEvidence are engineering criterion labels, NOT Program Evidence Graph node types.",
                    "Use retrievalHints keywords/commonApis/commonLibraries/patterns for targeted code search; do not substitute criterion labels as search_nodes.node_types.",
                    "At finish emit exactly one primary claim for each requiredEvidence label and set criterion to that exact label; supportingEvidence/negativeEvidence are evidence guidance, not extra claim criteria.",
                    "If a required criterion cannot be resolved, emit UNRESOLVED_ENGINEERING_FACT for that criterion rather than an unscoped generic unresolved claim.",
                    "MET/NOT_MET must reference one or more observationRefs with concrete provenance.",
                    "Do not author evidenceRefs, graphPathRefs, or sourceAnchorRefs yourself.",
                    "LCSP derives immutable provenance from observationRefs deterministically.",
                    "Absence is NOT_MET only when the relevant observation proves bounded complete search.",
                    "Search resource guards are internal; never infer engineering meaning from max_hops, max_results, node limits, edge limits, or neighbor limits.",
                    "Use only result.truncated to decide whether a bounded search is exhaustive. truncated=true is not an unresolved engineering fact by itself.",
                    "If required evidence is still missing after truncated=true, continue or narrow the search from continuationFrontiers before finishing.",
                    "Treat dynamic or external uncertainty as UNRESOLVED only when the relevant observation contains an actual unresolvedFrontier or boundary that can affect the required criterion.",
                    "Every EvidenceLedger summary advertises availableSections. Never guess section names across graph, wizard, repo-map, or code-search observations.",
                ],
            }
        )

    @classmethod
    def _finish_prompt(
        cls,
        packet: InvestigationPacket,
        ledger: EvidenceLedger,
        working_results: list[dict[str, Any]],
    ) -> str:
        return cls._render_prompt(
            {
                "task": (
                    "Investigation turn budget is exhausted. Call finish now. Reference only "
                    "EvidenceLedger observation IDs; LCSP will derive all graph/source provenance."
                ),
                "engineeringRule": cls._rule_contract(packet),
                "evidenceLedger": ledger.index(offset=0, limit=40),
                "recentToolResults": working_results[-MAX_WORKING_RESULTS:],
                "claimRules": [
                    "Emit exactly one primary claim per requiredEvidence criterion and set criterion to the exact requiredEvidence label.",
                    "If a required criterion is insufficiently evidenced, emit UNRESOLVED_ENGINEERING_FACT for that criterion.",
                    "Do not create separate claims for supportingEvidence or negativeEvidence labels; use them only to select supporting observations.",
                    "Do not mark a claim unresolved solely because an observation has truncated=true when the required criterion is already proven by concrete evidence.",
                    "Do not invent evidence/node/edge/source-anchor IDs.",
                    "Use only observationRefs returned by the EvidenceLedger.",
                ],
            }
        )

    @staticmethod
    def _log_finish(
        *,
        packet: InvestigationPacket,
        claims: list[EvidenceClaim],
        workflow_run_id: str,
        correlation_id: str | None,
        forced: bool,
        ledger: EvidenceLedger,
    ) -> None:
        logger.info(
            "ENGINEERING_INVESTIGATION_FINISHED",
            engineering_rule_id=packet.engineering_rule_id,
            claim_count=len(claims),
            claim_types=[claim.claim_type for claim in claims],
            claims=[
                {
                    "claim_id": claim.claim_id,
                    "criterion": claim.criterion,
                    "claim_type": claim.claim_type,
                    "value": claim.value,
                    "evidence_refs": list(claim.evidence_refs),
                    "graph_path_refs": list(claim.graph_path_refs),
                    "source_anchor_refs": list(claim.source_anchor_refs),
                    "confidence": claim.confidence,
                    "limitations": list(claim.limitations),
                }
                for claim in claims
            ],
            ledger_observation_count=ledger.total,
            forced_finish=forced,
            workflow_run_id=workflow_run_id,
            correlationId=correlation_id,
        )
