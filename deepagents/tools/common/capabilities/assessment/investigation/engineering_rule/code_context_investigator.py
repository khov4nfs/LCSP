"""Agentic RAG investigator with progressive, symbol-based repository code access."""
from __future__ import annotations

import json
from contextvars import ContextVar
from typing import Any

from langchain.tools import BaseTool, tool

from tools.common.capabilities.platform.logging import get_logger
from tools.common.capabilities.evidence.graph.query.query_engine import ProgramGraphQueryEngine

from .code_context import CodeContextSession
from tools.common.capabilities.assessment.claims.evidence_claim.evidence_ledger import EvidenceLedger
from .investigator import (
    LawGuidedInvestigator,
)
from tools.common.capabilities.assessment.claims.evidence_claim.models import EvidenceClaim, InvestigationPacket


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
_ACTIVE_CODE_CONTEXT: ContextVar[CodeContextSession | None] = ContextVar(
    "engineering_investigation_code_context",
    default=None,
)
_ACTIVE_PACKET: ContextVar[InvestigationPacket | None] = ContextVar(
    "engineering_investigation_packet",
    default=None,
)


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
                packet=packet, graph=graph, workflow_run_id=workflow_run_id,
                correlation_id=correlation_id,
            )
        context_token = _ACTIVE_CODE_CONTEXT.set(code_context)
        packet_token = _ACTIVE_PACKET.set(packet)
        try:
            return super().investigate(
                packet=packet, graph=graph, workflow_run_id=workflow_run_id,
                correlation_id=correlation_id,
            )
        finally:
            _ACTIVE_PACKET.reset(packet_token)
            _ACTIVE_CODE_CONTEXT.reset(context_token)

    def _native_tools(
        self, *, engine: ProgramGraphQueryEngine, ledger: EvidenceLedger
    ) -> list[BaseTool]:
        native_tools = super()._native_tools(engine=engine, ledger=ledger)
        code_context = _ACTIVE_CODE_CONTEXT.get()
        if code_context is None:
            return native_tools

        packet = _ACTIVE_PACKET.get()
        seed_query = self._seed_code_query(packet) if packet is not None else None
        if seed_query:
            seed_result = code_context.search_code(query=seed_query)
            if not seed_result.get("error"):
                self._store_observation(
                    ledger, source="code_context_seed", tool="search_code",
                    call_id="seed:engineering_rule", arguments={"query": seed_query},
                    result=seed_result,
                )
                seed_candidate = self._seed_source_candidate(seed_result)
                if seed_candidate is not None:
                    source_result = code_context.get_code(
                        symbol_id=str(seed_candidate.get("symbolId") or "")
                    )
                    if not source_result.get("error"):
                        self._store_observation(
                            ledger, source="code_context_seed_source", tool="get_code",
                            call_id="seed:source_probe",
                            arguments={"symbol_id": str(seed_candidate.get("symbolId") or "")},
                            result=source_result, expose_result=True,
                        )

        calls = {"used": 0}

        def run_code(tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
            if calls["used"] >= MAX_CODE_CONTEXT_TOOL_STEPS:
                return {"error": "CODE_CONTEXT_TOOL_BUDGET_EXHAUSTED", "truncated": True}
            raw_result = self._execute_code_tool(code_context, tool_name, arguments)
            if not raw_result.get("error"):
                calls["used"] += 1
            return self._store_observation(
                ledger, source="code_context_tool", tool=tool_name, call_id=None,
                arguments=arguments, result=raw_result,
                expose_result=tool_name in {"get_code", "get_symbol"},
            )

        @tool
        def repo_map(cursor: str | None = None) -> dict[str, Any]:
            """Read a hierarchical repository, file, and symbol map without source."""
            return run_code("repo_map", locals())

        @tool
        def search_code(
            query: str, scope: list[str] | None = None, cursor: str | None = None
        ) -> dict[str, Any]:
            """Search commit-pinned symbol chunks using EngineeringRule retrieval hints."""
            return run_code("search_code", locals())

        @tool
        def get_symbol(symbol_id: str) -> dict[str, Any]:
            """Get commit-pinned symbol metadata and direct caller and callee IDs."""
            return run_code("get_symbol", locals())

        @tool
        def get_file_outline(file_path: str) -> dict[str, Any]:
            """Get symbols and line ranges for one repository file."""
            return run_code("get_file_outline", locals())

        @tool
        def get_code(
            symbol_id: str | None = None, chunk_id: str | None = None,
            cursor: str | None = None,
        ) -> dict[str, Any]:
            """Read one bounded source page inside a semantic symbol chunk."""
            return run_code("get_code", locals())

        @tool
        def find_references(symbol_id: str, direction: str = "ALL") -> dict[str, Any]:
            """Follow callers, callees, or references from a commit-pinned symbol ID."""
            return run_code("find_references", locals())

        @tool
        def workspace_update(
            add_symbols: list[str] | None = None,
            remove_symbols: list[str] | None = None,
            notes: list[str] | None = None,
        ) -> dict[str, Any]:
            """Update server-owned working memory with symbols or concise hypotheses."""
            return run_code("workspace_update", locals())

        @tool
        def workspace_get() -> dict[str, Any]:
            """Read the current commit-pinned code investigation workspace."""
            return run_code("workspace_get", {})

        return [
            *native_tools, repo_map, search_code, get_symbol, get_file_outline,
            get_code, find_references, workspace_update, workspace_get,
        ]

    def _agent_prompt(
        self, packet: InvestigationPacket, ledger: EvidenceLedger
    ) -> str:
        return self._code_prompt(packet, ledger, [], 0)

    def _graph_tool_limit(self) -> int:
        return MAX_CODE_AWARE_GRAPH_TOOL_STEPS

    def _prepare_graph_arguments(
        self, tool_name: str, arguments: dict[str, Any], ledger: EvidenceLedger
    ) -> tuple[dict[str, Any], dict[str, Any] | None]:
        return self._resolve_graph_observation_ref(tool_name, arguments, ledger)

    @staticmethod
    def _resolve_graph_observation_ref(
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

    @staticmethod
    def _execute_code_tool(
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
