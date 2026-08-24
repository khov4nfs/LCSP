"""Agentic RAG investigator with progressive, symbol-based repository code access."""
from __future__ import annotations

import json
from typing import Any

from tools.common.llm import LLMToolDefinition
from tools.common.platform.logging import get_logger
from tools.graph.scanner.program_graph.query_engine import ProgramGraphQueryEngine

from .code_context import CodeContextSession
from .evidence_ledger import EvidenceLedger
from .investigator import (
    FINISH_TOOL_NAME,
    GRAPH_TOOL_NAMES,
    MAX_INVESTIGATION_STEPS,
    MAX_WORKING_RESULTS,
    STATE_TOOL_NAMES,
    LawGuidedInvestigator,
    summarize_investigation_tool_result,
)
from .models import EvidenceClaim, InvestigationPacket


logger = get_logger(__name__)
CODE_CONTEXT_TOOL_NAMES = (
    "repo_map",
    "search_code",
    "get_symbol",
    "get_file_outline",
    "get_code",
    "find_references",
    "workspace_update",
    "workspace_get",
)
MAX_CODE_CONTEXT_TOOL_STEPS = 12
MAX_CODE_AWARE_GRAPH_TOOL_STEPS = 8
MAX_SEED_CODE_QUERY_TERMS = 12


class CodeContextLawGuidedInvestigator(LawGuidedInvestigator):
    """Investigate with graph tools plus AST/CST symbol-level progressive disclosure.

    Program Evidence Graph remains the canonical evidence source. Code-context tools
    only expose an ephemeral, commit-pinned working view over source materialized from
    the RepositorySnapshot. Full source is never persisted into the assessment artifact.
    """

    def investigate(
        self,
        *,
        packet: InvestigationPacket,
        graph,
        workflow_run_id: str,
        correlation_id: str | None = None,
        code_context: CodeContextSession | None = None,
    ) -> list[EvidenceClaim]:
        if code_context is None or not code_context.available:
            return super().investigate(
                packet=packet,
                graph=graph,
                workflow_run_id=workflow_run_id,
                correlation_id=correlation_id,
            )

        engine = ProgramGraphQueryEngine(graph)
        ledger = EvidenceLedger()
        working_results: list[dict[str, Any]] = []
        for item in packet.initial_results:
            observation = ledger.add(source="engineering_rule_seed_query", result=item)
            working_results.append(
                {
                    "step": 0,
                    "tool": "engineering_rule_seed_query",
                    "callId": None,
                    "result": {
                        "observationId": observation.observation_id,
                        "summary": ledger.summary(observation),
                        "preview": ledger.preview(observation.observation_id, limit=6),
                        "instruction": (
                            "For graph traversal use nodes[].node_id from this preview. "
                            "The observationId is an EvidenceLedger handle, not a Program Evidence Graph ref."
                        ),
                    },
                }
            )
        if packet.wizard_context:
            ledger.add(source="wizard_context", result=dict(packet.wizard_context))

        code_candidates_found = False
        source_probe_attempted = False
        seed_query = self._seed_code_query(packet)
        if seed_query:
            seed_result = code_context.search_code(query=seed_query)
            if not seed_result.get("error"):
                seed_candidate = self._seed_source_candidate(seed_result)
                code_candidates_found = seed_candidate is not None
                seed_view = self._store_observation(
                    ledger,
                    source="code_context_seed",
                    tool="search_code",
                    call_id="seed:engineering_rule",
                    arguments={"query": seed_query},
                    result=seed_result,
                )
                working_results.append(
                    {
                        "step": 0,
                        "tool": "search_code",
                        "callId": "seed:engineering_rule",
                        "result": seed_view,
                    }
                )
                if seed_candidate is not None:
                    # The prior runtime restricted the first LLM phase to get_code +
                    # inspect_observation and waited for the model to choose get_code.
                    # In production that created a deterministic no-progress loop: the
                    # model repeatedly paged the same seed observations until forced
                    # finish. LCSP already owns the ranked candidate set, so probe the
                    # best production candidate deterministically before the first LLM
                    # turn and let the agent reason from actual source immediately.
                    source_probe_attempted = True
                    source_result = code_context.get_code(
                        symbol_id=str(seed_candidate.get("symbolId") or "")
                    )
                    if not source_result.get("error"):
                        source_view = self._store_observation(
                            ledger,
                            source="code_context_seed_source",
                            tool="get_code",
                            call_id="seed:source_probe",
                            arguments={
                                "symbol_id": str(seed_candidate.get("symbolId") or "")
                            },
                            result=source_result,
                            expose_result=True,
                        )
                        working_results.append(
                            {
                                "step": 0,
                                "tool": "get_code",
                                "callId": "seed:source_probe",
                                "result": source_view,
                            }
                        )
        working_results = working_results[-MAX_WORKING_RESULTS:]

        all_tools = self._code_aware_tool_definitions()
        graph_tool_calls_used = 0
        code_tool_calls_used = 0
        inspection_offsets: dict[tuple[str, str], int] = {}

        for step in range(MAX_INVESTIGATION_STEPS):
            source_probe_required = code_candidates_found and not source_probe_attempted
            tools = self._runtime_tool_definitions(
                all_tools,
                graph_tool_calls_used=graph_tool_calls_used,
                code_tool_calls_used=code_tool_calls_used,
                source_probe_required=source_probe_required,
            )
            response = self.llm.complete_with_tools(
                prompt=self._code_prompt(packet, ledger, working_results, step),
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
                logger.info(
                    "ENGINEERING_INVESTIGATION_TOOL_CALL",
                    engineering_rule_id=packet.engineering_rule_id,
                    step=step + 1,
                    tool=call.name,
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
                    prepared_arguments, reference_error = self._resolve_graph_observation_ref(
                        call.name,
                        call.arguments,
                        ledger,
                    )
                    if reference_error is not None:
                        tool_result = reference_error
                    elif graph_tool_calls_used >= MAX_CODE_AWARE_GRAPH_TOOL_STEPS:
                        tool_result = {
                            "error": "GRAPH_TOOL_BUDGET_EXHAUSTED",
                            "truncated": True,
                            "instruction": (
                                "Graph tools are exhausted for this rule. Continue with code-context/state "
                                "tools or finish; do not retry graph tools."
                            ),
                        }
                    else:
                        raw_result = self._execute_graph_tool(
                            engine,
                            call.name,
                            prepared_arguments,
                        )
                        if (
                            isinstance(raw_result, dict)
                            and raw_result.get("error") == "INVALID_GRAPH_TOOL_ARGUMENTS"
                        ):
                            # Invalid model arguments are not evidence and must not consume the
                            # bounded graph investigation budget.
                            tool_result = raw_result
                        else:
                            graph_tool_calls_used += 1
                            tool_result = self._store_observation(
                                ledger,
                                source="graph_tool",
                                tool=call.name,
                                call_id=call.call_id,
                                arguments=prepared_arguments,
                                result=raw_result,
                            )
                elif call.name in CODE_CONTEXT_TOOL_NAMES:
                    if code_tool_calls_used >= MAX_CODE_CONTEXT_TOOL_STEPS:
                        tool_result = {
                            "error": "CODE_CONTEXT_TOOL_BUDGET_EXHAUSTED",
                            "truncated": True,
                        }
                    else:
                        raw_result = self._execute_code_tool(
                            code_context,
                            call.name,
                            call.arguments,
                        )
                        # Invalid or unresolved model arguments are not useful work and
                        # must not burn the bounded code-context budget.
                        if not raw_result.get("error"):
                            code_tool_calls_used += 1
                        if call.name == "get_code":
                            source_probe_attempted = True
                        elif call.name == "search_code" and not raw_result.get("error"):
                            code_candidates_found = code_candidates_found or bool(
                                raw_result.get("results")
                            )
                        tool_result = self._store_observation(
                            ledger,
                            source="code_context_tool",
                            tool=call.name,
                            call_id=call.call_id,
                            arguments=call.arguments,
                            result=raw_result,
                            expose_result=call.name in {"get_code", "get_symbol"},
                        )
                elif call.name == "list_observations":
                    tool_result = ledger.index(
                        offset=int(call.arguments.get("offset") or 0),
                        limit=int(call.arguments.get("limit") or 20),
                    )
                elif call.name == "inspect_observation":
                    observation_id = str(call.arguments.get("observation_id") or "")
                    section = (
                        str(call.arguments.get("section"))
                        if call.arguments.get("section")
                        else ""
                    )
                    requested_offset = int(call.arguments.get("offset") or 0)
                    progress_key = (observation_id, section)
                    effective_offset = max(
                        requested_offset,
                        inspection_offsets.get(progress_key, 0),
                    )
                    try:
                        tool_result = ledger.inspect(
                            observation_id,
                            section=section or None,
                            offset=effective_offset,
                            limit=int(call.arguments.get("limit") or 12),
                        )
                        if effective_offset != requested_offset:
                            tool_result["requestedOffset"] = requested_offset
                            tool_result["autoAdvanced"] = True
                        next_offset = tool_result.get("nextOffset")
                        if isinstance(next_offset, int):
                            inspection_offsets[progress_key] = next_offset
                        elif not tool_result.get("error"):
                            total = tool_result.get("total")
                            if isinstance(total, int):
                                inspection_offsets[progress_key] = total
                            if (
                                effective_offset > requested_offset
                                and isinstance(total, int)
                                and effective_offset >= total
                            ):
                                tool_result = {
                                    "error": "OBSERVATION_PAGE_ALREADY_CONSUMED",
                                    "observationId": observation_id,
                                    "section": section or None,
                                    "total": total,
                                    "instruction": (
                                        "This observation section has already been fully inspected. "
                                        "Choose a different observation/tool or finish; do not repeat offset 0."
                                    ),
                                }
                    except KeyError as error:
                        tool_result = {
                            "error": "UNKNOWN_OBSERVATION_REF",
                            "detail": str(error),
                        }
                else:
                    tool_result = {
                        "error": "UNKNOWN_INVESTIGATION_TOOL",
                        "allowedTools": sorted(
                            {
                                *GRAPH_TOOL_NAMES,
                                *CODE_CONTEXT_TOOL_NAMES,
                                *STATE_TOOL_NAMES,
                                FINISH_TOOL_NAME,
                            }
                        ),
                    }

                working_result = self._fit_working_result(tool_result)
                logger.info(
                    "ENGINEERING_INVESTIGATION_TOOL_RESULT",
                    engineering_rule_id=packet.engineering_rule_id,
                    step=step + 1,
                    tool=call.name,
                    result_summary=summarize_investigation_tool_result(working_result),
                    graph_tool_calls_used=graph_tool_calls_used,
                    code_tool_calls_used=code_tool_calls_used,
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
            prompt=self._code_finish_prompt(packet, ledger, working_results),
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

    @classmethod
    def _runtime_tool_definitions(
        cls,
        tools: list[LLMToolDefinition],
        *,
        graph_tool_calls_used: int,
        code_tool_calls_used: int,
        source_probe_required: bool,
    ) -> list[LLMToolDefinition]:
        """Expose only actions that can still make progress in the current phase.

        Deterministic seed retrieval now probes a production source candidate before
        the first model turn. This fallback gate therefore exposes only get_code when
        a later search discovers candidates that have not yet been source-inspected;
        inspect_observation is deliberately excluded so it cannot become a no-progress
        escape hatch that keeps the model in the restricted phase forever.
        """
        if source_probe_required and code_tool_calls_used < MAX_CODE_CONTEXT_TOOL_STEPS:
            return [tool for tool in tools if tool.name == "get_code"]

        result: list[LLMToolDefinition] = []
        for tool in tools:
            if (
                tool.name in GRAPH_TOOL_NAMES
                and graph_tool_calls_used >= MAX_CODE_AWARE_GRAPH_TOOL_STEPS
            ):
                continue
            if (
                tool.name in CODE_CONTEXT_TOOL_NAMES
                and code_tool_calls_used >= MAX_CODE_CONTEXT_TOOL_STEPS
            ):
                continue
            result.append(tool)
        return result

    @classmethod
    def _resolve_graph_observation_ref(
        cls,
        tool_name: str,
        arguments: dict[str, Any],
        ledger: EvidenceLedger,
    ) -> tuple[dict[str, Any], dict[str, Any] | None]:
        """Keep EvidenceLedger observation IDs out of Program Evidence Graph namespaces.

        ``obs:*`` is a server-side EvidenceLedger handle. It is not a graph node and must
        never be converted into ``unresolvedFrontiers``. A singleton node observation can
        be resolved deterministically; multi-node observations tell the model exactly
        which node refs are available without consuming graph-search budget.
        """
        prepared = dict(arguments)
        if tool_name == "symbol_context":
            canonical_key = "symbol_ref"
            candidate_keys = ("symbol_ref", "symbolRef")
        elif tool_name in {
            "trace_static_flow",
            "inspect_data_path",
            "inspect_decision_path",
            "inspect_human_review_path",
        }:
            canonical_key = "start_ref"
            candidate_keys = ("start_ref", "startRef")
        else:
            return prepared, None

        supplied_key = next((key for key in candidate_keys if key in prepared), None)
        if supplied_key is None:
            return prepared, None
        reference = str(prepared.get(supplied_key) or "")
        if not reference.startswith("obs:"):
            return prepared, None

        try:
            observation = ledger.get(reference)
        except KeyError:
            return prepared, {
                "error": "UNKNOWN_OBSERVATION_REF",
                "observationId": reference,
                "instruction": (
                    "Use list_observations/inspect_observation to obtain an existing observation, "
                    "then pass a concrete nodes[].node_id to graph traversal tools."
                ),
            }

        node_refs: list[str] = []
        value = observation.result
        if isinstance(value, dict):
            for section in ("nodes", "reviewNodes", "finalActions", "neighbors"):
                rows = value.get(section)
                if not isinstance(rows, list):
                    continue
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    node_ref = str(row.get("node_id") or row.get("nodeId") or "")
                    if node_ref and node_ref not in node_refs:
                        node_refs.append(node_ref)

        if len(node_refs) == 1:
            for key in candidate_keys:
                prepared.pop(key, None)
            prepared[canonical_key] = node_refs[0]
            return prepared, None

        return prepared, {
            "error": "OBSERVATION_REF_REQUIRES_GRAPH_NODE_ID",
            "observationId": reference,
            "availableNodeRefs": node_refs[:20],
            "instruction": (
                "EvidenceLedger observation IDs are not graph refs. Use inspect_observation on a "
                "nodes-like section and pass one concrete nodes[].node_id to this graph tool."
            ),
        }

    @staticmethod
    def _seed_code_query(packet: InvestigationPacket) -> str | None:
        terms: list[str] = []
        for group in (
            packet.keywords,
            packet.common_apis,
            packet.common_libraries,
            packet.patterns,
        ):
            for value in group:
                normalized = str(value).strip()
                if normalized and normalized not in terms:
                    terms.append(normalized)
        if not terms:
            for value in packet.investigation_goals:
                normalized = str(value).strip()
                if normalized and normalized not in terms:
                    terms.append(normalized)
        query = " ".join(terms[:MAX_SEED_CODE_QUERY_TERMS]).strip()
        return query[:1200] or None

    @staticmethod
    def _seed_source_candidate(seed_result: dict[str, Any]) -> dict[str, Any] | None:
        rows = [
            row
            for row in seed_result.get("results") or []
            if isinstance(row, dict) and row.get("symbolId")
        ]
        if not rows:
            return None

        def is_production(row: dict[str, Any]) -> bool:
            path = str(row.get("path") or "").lower()
            return not any(
                marker in path
                for marker in (
                    "/test/",
                    "/tests/",
                    "/fixtures/",
                    "/examples/",
                    ".spec.",
                    ".test.",
                    "__mocks__",
                )
            )

        return next((row for row in rows if is_production(row)), rows[0])

    @classmethod
    def _code_aware_tool_definitions(cls) -> list[LLMToolDefinition]:
        # Graph resource guards are intentionally internal. The model sees only the
        # canonical truncated signal and continuation frontiers in tool results.
        graph_tools: list[LLMToolDefinition] = []
        for tool in super()._tool_definitions():
            if tool.name not in GRAPH_TOOL_NAMES:
                continue
            properties = dict(tool.input_schema.get("properties") or {})
            for internal in ("max_hops", "max_results", "max_neighbors"):
                properties.pop(internal, None)
            if tool.name == "search_nodes":
                # EngineeringRule seed queries already apply semantic/path constraints.
                # Hiding these free-form filters prevents criterion labels/strategy names
                # from being misused as repository path or semantic-type filters.
                properties.pop("path_prefixes", None)
                properties.pop("semantic_types", None)
            required = tuple(
                value
                for value in tool.input_schema.get("required") or []
                if value in properties
            )
            description = tool.description
            if tool.name == "search_nodes":
                description = (
                    "Search bounded Program Evidence Graph nodes by canonical node type and/or text. "
                    "EngineeringRule semantic/path constraints are already represented by seed queries; "
                    "criterion labels are not graph node types."
                )
            elif tool.name in {
                "trace_static_flow",
                "inspect_data_path",
                "inspect_decision_path",
                "inspect_human_review_path",
            }:
                description += (
                    " start_ref must be a concrete nodes[].node_id from a graph observation, never an "
                    "EvidenceLedger obs:* identifier."
                )
            graph_tools.append(
                LLMToolDefinition(
                    name=tool.name,
                    description=description,
                    input_schema=cls._closed_schema(properties, required=required),
                )
            )

        string_array = {"type": "array", "items": {"type": "string"}}
        code_tools = [
            LLMToolDefinition(
                name="repo_map",
                description=(
                    "Read a hierarchical repository/file/symbol map without implementation source. "
                    "Use only when the EngineeringRule retrieval hints do not already give a targeted "
                    "search term or path clue; use cursor when truncated=true."
                ),
                input_schema=cls._closed_schema({"cursor": {"type": "string"}}),
            ),
            LLMToolDefinition(
                name="search_code",
                description=(
                    "Hybrid search over AST/CST symbol chunks using the EngineeringRule keywords, APIs, "
                    "libraries and patterns. Results are candidates: inspect the most relevant production "
                    "symbol with get_code before using implementation behavior as evidence."
                ),
                input_schema=cls._closed_schema(
                    {
                        "query": {"type": "string"},
                        "scope": string_array,
                        "cursor": {"type": "string"},
                    }
                ),
            ),
            LLMToolDefinition(
                name="get_symbol",
                description="Get commit-pinned symbol metadata and direct caller/callee IDs.",
                input_schema=cls._closed_schema(
                    {"symbol_id": {"type": "string"}}, required=("symbol_id",)
                ),
            ),
            LLMToolDefinition(
                name="get_file_outline",
                description="Get all AST/CST symbols and line ranges for one repository file.",
                input_schema=cls._closed_schema(
                    {"file_path": {"type": "string"}}, required=("file_path",)
                ),
            ),
            LLMToolDefinition(
                name="get_code",
                description=(
                    "Read one bounded source page inside a semantic symbol chunk. Use this after search_code "
                    "or get_symbol when implementation behavior is relevant. The chunk boundary is a "
                    "function/method/class/etc.; use nextCursor until the needed behavior is visible."
                ),
                input_schema=cls._closed_schema(
                    {
                        "symbol_id": {"type": "string"},
                        "chunk_id": {"type": "string"},
                        "cursor": {"type": "string"},
                    }
                ),
            ),
            LLMToolDefinition(
                name="find_references",
                description="Follow direct callers/callees/references from a commit-pinned symbol ID.",
                input_schema=cls._closed_schema(
                    {
                        "symbol_id": {"type": "string"},
                        "direction": {
                            "type": "string",
                            "enum": ["CALLERS", "CALLEES", "ALL"],
                        },
                    },
                    required=("symbol_id",),
                ),
            ),
            LLMToolDefinition(
                name="workspace_update",
                description=(
                    "Update orchestrator-owned working memory with important symbols or concise hypotheses. "
                    "This avoids resending repository context through the prompt."
                ),
                input_schema=cls._closed_schema(
                    {
                        "add_symbols": string_array,
                        "remove_symbols": string_array,
                        "notes": string_array,
                    }
                ),
            ),
            LLMToolDefinition(
                name="workspace_get",
                description="Read the current commit-pinned server-side code investigation workspace.",
                input_schema=cls._closed_schema({}),
            ),
        ]
        state_tools = [
            tool
            for tool in super()._tool_definitions()
            if tool.name in STATE_TOOL_NAMES
        ]
        return [*graph_tools, *code_tools, *state_tools, cls._finish_tool_definition()]

    def _execute_code_tool(
        self,
        code_context: CodeContextSession,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        try:
            if tool_name == "repo_map":
                return code_context.repo_map(cursor=arguments.get("cursor"))
            if tool_name == "search_code":
                return code_context.search_code(
                    query=arguments.get("query"),
                    scope=arguments.get("scope") or (),
                    cursor=arguments.get("cursor"),
                )
            if tool_name == "get_symbol":
                return code_context.get_symbol(str(arguments.get("symbol_id") or ""))
            if tool_name == "get_file_outline":
                return code_context.get_file_outline(str(arguments.get("file_path") or ""))
            if tool_name == "get_code":
                return code_context.get_code(
                    symbol_id=(str(arguments.get("symbol_id")) if arguments.get("symbol_id") else None),
                    chunk_id=(str(arguments.get("chunk_id")) if arguments.get("chunk_id") else None),
                    cursor=(str(arguments.get("cursor")) if arguments.get("cursor") else None),
                )
            if tool_name == "find_references":
                return code_context.find_references(
                    symbol_id=str(arguments.get("symbol_id") or ""),
                    direction=str(arguments.get("direction") or "ALL"),
                )
            if tool_name == "workspace_update":
                return code_context.workspace_update(
                    add_symbols=arguments.get("add_symbols") or (),
                    remove_symbols=arguments.get("remove_symbols") or (),
                    notes=arguments.get("notes") or (),
                )
            if tool_name == "workspace_get":
                return code_context.workspace_get()
        except (TypeError, ValueError) as error:
            return {
                "error": "INVALID_CODE_CONTEXT_TOOL_ARGUMENTS",
                "tool": tool_name,
                "errorType": type(error).__name__,
            }
        return {"error": "UNKNOWN_CODE_CONTEXT_TOOL", "tool": tool_name}

    @classmethod
    def _code_prompt(
        cls,
        packet: InvestigationPacket,
        ledger: EvidenceLedger,
        working_results: list[dict[str, Any]],
        step: int,
    ) -> str:
        payload = json.loads(super()._prompt(packet, ledger, working_results, step))
        payload["lcspCodeContextProtocol"] = "AST_SYMBOL_CHUNKS_V1"
        payload["codeInvestigationFlow"] = [
            "SEARCH: LCSP deterministically seeds code search from EngineeringRule retrievalHints and probes the best production source candidate before the first LLM turn",
            "IDENTIFY: code-search previews expose candidate symbolId/chunkId; use get_symbol only when caller/callee metadata is needed",
            "EXPAND: inspect additional relevant source only when the seeded source does not resolve the criterion",
            "FOLLOW_REFERENCES: use find_references and graph tools for callers/callees/data/decision paths",
            "REMEMBER: pin important symbols/hypotheses with workspace_update when useful",
            "FINISH: reference EvidenceLedger observations only; LCSP derives provenance",
        ]
        payload["codeContextRules"] = [
            "EvidenceLedger obs:* identifiers are NOT Program Evidence Graph refs. Graph traversal start_ref must be a concrete nodes[].node_id from a graph observation.",
            "requiredEvidence/supportingEvidence/negativeEvidence are criterion labels, not graph node types or default code-search queries.",
            "Prefer the EngineeringRule retrievalHints keywords/commonApis/commonLibraries/patterns and canonical start/target node types.",
            "search_code results are candidate metadata, not proof of implementation behavior; when source is available and behavior matters, inspect a relevant symbol with get_code before finishing MET/NOT_MET.",
            "Prefer runtime/production source. Tests, specs, mocks, fixtures and examples may corroborate behavior but must not by themselves prove production behavior unless the EngineeringRule explicitly targets them.",
            "Every EvidenceLedger summary contains availableSections. Use those exact names and do not guess sections from another observation type.",
            "For pageable observations, when hasMore=true use the returned nextOffset. Never request the same observationId + section + offset twice; LCSP may auto-advance repeated pages.",
            "Never request an entire repository or file when a symbol/chunk is sufficient.",
            "Source pages are bounded inside AST/CST symbol boundaries; follow nextCursor when truncated=true and more source is still necessary.",
            "search_code cursors are stable for this commit and search session.",
            "Do not infer search semantics from max_hops/max_results/node/edge/neighbor limits; those guards are internal.",
            "A tool omitted from the current native tool list is unavailable for this phase. Do not retry an exhausted graph/code action by name.",
        ]
        return cls._render_prompt(payload)

    @classmethod
    def _code_finish_prompt(
        cls,
        packet: InvestigationPacket,
        ledger: EvidenceLedger,
        working_results: list[dict[str, Any]],
    ) -> str:
        payload = json.loads(super()._finish_prompt(packet, ledger, working_results))
        payload["lcspCodeContextProtocol"] = "AST_SYMBOL_CHUNKS_V1"
        payload["codeContextRule"] = (
            "Do not mark a criterion unresolved merely because a bounded code/search page is truncated "
            "when concrete observation evidence already proves the criterion. Search-result metadata alone "
            "does not prove implementation behavior when source was available but never inspected."
        )
        return cls._render_prompt(payload)

    @classmethod
    def _store_observation(
        cls,
        ledger: EvidenceLedger,
        *,
        source: str,
        tool: str,
        call_id: str | None,
        arguments: dict[str, Any],
        result: Any,
        expose_result: bool = False,
    ) -> dict[str, Any]:
        observation = ledger.add(
            source=source,
            tool=tool,
            call_id=call_id,
            arguments=dict(arguments),
            result=result,
        )
        payload: dict[str, Any] = {
            "observationId": observation.observation_id,
            "summary": ledger.summary(observation),
            "instruction": (
                "Full result is retained by LCSP. The summary advertises availableSections; "
                "use those exact sections or the returned cursor when more context is needed."
            ),
        }
        if expose_result:
            payload["result"] = result
        else:
            payload["preview"] = ledger.preview(observation.observation_id, limit=6)
        return payload
