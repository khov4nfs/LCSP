"""Provenance-gated LLM business semantics for Unified System Evidence Graph v3."""
from __future__ import annotations

import hashlib
import json
import re
from collections import deque
from dataclasses import replace
from typing import Any

from lcsp_workers.llm.fallback_client import LLMClientProtocol
from lcsp_workers.llm.gateway_client import LLMToolDefinition
from lcsp_workers.platform.logging import get_logger

from .models import ProgramEvidenceGraph
from .validator import validate_program_graph

logger = get_logger(__name__)

_ALLOWED_NODE_TYPES = frozenset(
    {
        "BUSINESS_PROCESS",
        "PROCESS_STEP",
        "BUSINESS_DECISION",
        "BUSINESS_OUTCOME",
        "BUSINESS_OBJECT",
        "ACTOR",
        "DATA_SUBJECT",
        "AI_CAPABILITY",
    }
)
_ALLOWED_EDGE_TYPES = frozenset(
    {
        "PART_OF_PROCESS",
        "PRECEDES",
        "PERFORMED_BY",
        "AFFECTS_SUBJECT",
        "INVOKES_AI",
        "INFLUENCES_DECISION",
        "USES_DATA",
        "PRODUCES_OUTCOME",
        "REQUIRES_HUMAN_REVIEW",
    }
)
_ENTRYPOINT_NODE_TYPES = frozenset(
    {
        "HTTP_ROUTE",
        "GRPC_METHOD",
        "GRAPHQL_OPERATION",
        "EVENT",
        "QUEUE",
        "COMMAND",
        "QUERY",
        "CRON",
        "WEBHOOK",
        "MODEL_DEPLOYMENT",
        "MODEL_ENDPOINT",
        "TRAINING_JOB",
        "FINE_TUNING_JOB",
        "RETRAINING_JOB",
        "MODEL_MONITORING",
        "AI_MODEL_INVOCATION",
    }
)
_ENTRYPOINT_PRIORITY = {
    "HTTP_ROUTE": 0,
    "GRPC_METHOD": 1,
    "GRAPHQL_OPERATION": 2,
    "EVENT": 3,
    "QUEUE": 4,
    "COMMAND": 5,
    "QUERY": 6,
    "CRON": 7,
    "WEBHOOK": 8,
    "MODEL_DEPLOYMENT": 9,
    "MODEL_ENDPOINT": 10,
    "TRAINING_JOB": 11,
    "FINE_TUNING_JOB": 12,
    "RETRAINING_JOB": 13,
    "MODEL_MONITORING": 14,
    "AI_MODEL_INVOCATION": 15,
}
_CONTEXT_NODE_TYPES = frozenset(
    {
        *_ENTRYPOINT_NODE_TYPES,
        "HTTP_REQUEST",
        "HTTP_RESPONSE",
        "PROTOCOL_MESSAGE",
        "DATA_CONTRACT",
        "CALL_SITE",
        "FUNCTION",
        "METHOD",
        "CLASS",
        "PARAMETER",
        "RETURN_VALUE",
        "VARIABLE",
        "PROPERTY",
        "DTO",
        "DTO_FIELD",
        "AI_SYSTEM",
        "AI_CAPABILITY",
        "AI_PROVIDER",
        "AI_INPUT",
        "AI_OUTPUT",
        "MODEL",
        "MODEL_ARTIFACT",
        "DATASET",
        "DATA_PREPARATION",
        "EVALUATION_JOB",
        "MODEL_REGISTRY",
        "MODEL_DRIFT_SIGNAL",
        "DATA_OBJECT",
        "DATA_ASSET",
        "MEDIA_OBJECT",
        "PERSONAL_DATA",
        "SENSITIVE_DATA",
        "DATABASE",
        "TABLE",
        "ENTITY",
        "REPOSITORY_ACCESS",
        "EXTERNAL_SERVICE",
        "EXTERNAL_API",
        "BUSINESS_DECISION",
        "BUSINESS_OUTCOME",
        "BUSINESS_ACTION",
        "APPROVAL",
        "REJECTION",
        "RANKING",
        "RECOMMENDATION",
        "STATUS_CHANGE",
        "NOTIFICATION",
        "HUMAN_REVIEW",
        "HUMAN_OVERRIDE",
        "UNRESOLVED_DYNAMIC_TARGET",
    }
)
# Structural ownership/import inventory is useful for the base graph but makes a business
# cluster fan out to the whole repository. Business enrichment follows executable/data/
# framework/lifecycle relationships and relies on source anchors already attached to nodes.
_CLUSTER_EXCLUDED_EDGE_TYPES = frozenset(
    {
        "CONTAINS",
        "DECLARES",
        "IMPORTS",
        "EXPORTS",
        "DEPENDS_ON",
        "CORROBORATES",
        "SUPPORTED_BY",
        "HAS_LIMITATION",
    }
)
_LEGAL_CONCLUSION_RE = re.compile(
    r"\b(?:compliant|non[- ]?compliant|legal applicability|legal violation|high[- ]risk|medium[- ]risk|low[- ]risk|prohibited practice)\b|"
    r"(?:tuân thủ|không tuân thủ|vi phạm pháp luật|rủi ro cao|rủi ro trung bình|rủi ro thấp|hành vi bị cấm)",
    re.I,
)
_PROPOSAL_ID_RE = re.compile(r"^[a-z][a-z0-9_-]{1,63}$")
_MAX_CLUSTERS = 16
_CLUSTER_MAX_DEPTH = 8
_CLUSTER_MAX_NODES = 120
_CLUSTER_MAX_EDGES = 240
_CLUSTER_OVERLAP_THRESHOLD = 0.72


class BusinessSemanticEnricher:
    """Infer business meaning per bounded technical cluster and gate every proposal.

    The model never writes the graph directly. LCSP deterministically clusters the base
    technical graph around runtime/model-lifecycle entrypoints, gives the model one
    sanitized cluster at a time, and accepts only proposals backed by refs that existed
    in the pre-LLM graph. A later cluster therefore cannot use a semantic node emitted by
    an earlier cluster as provenance. One provider/schema failure skips only that cluster.
    """

    def __init__(self, llm_client: LLMClientProtocol) -> None:
        self._llm = llm_client

    def enrich(
        self,
        graph: ProgramEvidenceGraph,
        *,
        workflow_run_id: str,
        correlation_id: str | None = None,
    ) -> ProgramEvidenceGraph:
        if graph.schema_version != "3.0.0":
            return graph

        # Freeze the technical authority boundary before any LLM proposal is merged.
        base_graph = graph
        trusted_support_refs = self._technical_support_refs(base_graph)
        contexts = self._cluster_contexts(base_graph)
        if not contexts:
            return graph

        enriched = graph
        accepted_node_count = 0
        accepted_edge_count = 0
        succeeded_clusters = 0
        failed_clusters = 0

        for index, context in enumerate(contexts):
            cluster_id = str(context["clusterId"])
            cluster_run_id = f"{workflow_run_id}:business-cluster:{index + 1}"
            try:
                response = self._llm.complete_with_tools(
                    self._prompt(context),
                    tools=[self._tool()],
                    workflow_run_id=cluster_run_id,
                    node_name="enrich_business_semantics",
                    max_tokens=3000,
                    correlationId=correlation_id,
                )
                calls = [
                    call
                    for call in response.tool_calls
                    if call.name == "submit_business_semantics"
                ]
                if len(calls) != 1:
                    raise ValueError(
                        "business semantic enricher requires exactly one proposal call"
                    )
                proposal = self._namespace_payload(calls[0].arguments, cluster_id)
                enriched, added_nodes, added_edges = self.validate_and_merge(
                    enriched,
                    proposal,
                    trusted_support_refs=trusted_support_refs,
                    base_graph_id=base_graph.graph_id,
                )
                accepted_node_count += added_nodes
                accepted_edge_count += added_edges
                succeeded_clusters += 1
                logger.info(
                    "BUSINESS_SEMANTIC_CLUSTER_ENRICHED",
                    cluster_id=cluster_id,
                    entrypoint_type=context.get("entrypointType"),
                    entrypoint_label=context.get("entrypointLabel"),
                    accepted_node_count=added_nodes,
                    accepted_edge_count=added_edges,
                    workflow_run_id=workflow_run_id,
                    correlationId=correlation_id,
                )
            except Exception as error:
                failed_clusters += 1
                logger.warning(
                    "BUSINESS_SEMANTIC_CLUSTER_SKIPPED",
                    cluster_id=cluster_id,
                    entrypoint_type=context.get("entrypointType"),
                    error_type=type(error).__name__,
                    workflow_run_id=workflow_run_id,
                    correlationId=correlation_id,
                )

        logger.info(
            "BUSINESS_SEMANTIC_GRAPH_ENRICHMENT_READY",
            cluster_count=len(contexts),
            succeeded_cluster_count=succeeded_clusters,
            failed_cluster_count=failed_clusters,
            accepted_node_count=accepted_node_count,
            accepted_edge_count=accepted_edge_count,
            graph_node_count=enriched.node_count,
            graph_edge_count=enriched.edge_count,
            workflow_run_id=workflow_run_id,
            correlationId=correlation_id,
        )
        return enriched

    @classmethod
    def validate_and_merge(
        cls,
        graph: ProgramEvidenceGraph,
        payload: dict[str, Any],
        *,
        trusted_support_refs: set[str] | None = None,
        base_graph_id: str | None = None,
    ) -> tuple[ProgramEvidenceGraph, int, int]:
        """Validate one model proposal payload and return a new immutable graph value."""
        if graph.schema_version != "3.0.0":
            raise ValueError("business semantic enrichment requires graph v3")
        raw_nodes = payload.get("nodes")
        raw_edges = payload.get("edges")
        if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list):
            raise ValueError("business semantic proposal arrays are required")

        authority_refs = (
            set(trusted_support_refs)
            if trusted_support_refs is not None
            else cls._technical_support_refs(graph)
        )
        stable_base_id = str(base_graph_id or graph.graph_id)
        technical_node_ids = {
            str(node.get("node_id"))
            for node in graph.nodes
            if node.get("node_id")
            and str(node.get("origin") or "STATIC_ANALYSIS")
            != "LLM_SEMANTIC_ENRICHMENT"
        }

        proposal_nodes: dict[str, dict[str, Any]] = {}
        proposal_endpoint_ids: dict[str, str] = {}
        existing_semantic = cls._existing_semantic_nodes(graph)
        for raw in raw_nodes[:40]:
            if not isinstance(raw, dict):
                continue
            proposal_id = str(raw.get("proposalNodeId") or "")
            node_type = str(raw.get("nodeType") or "")
            label = cls._label(raw.get("label"))
            support_refs = cls._support_refs(raw.get("supportRefs"), authority_refs)
            if (
                not _PROPOSAL_ID_RE.fullmatch(proposal_id)
                or node_type not in _ALLOWED_NODE_TYPES
                or not label
                or not support_refs
            ):
                continue

            semantic_key = cls._semantic_identity(node_type, label, support_refs)
            existing_id = existing_semantic.get(semantic_key)
            if existing_id:
                proposal_endpoint_ids[proposal_id] = existing_id
                continue

            node_id = cls._stable_id(
                "node",
                {
                    "baseGraph": stable_base_id,
                    "proposal": proposal_id,
                    "type": node_type,
                    "label": label,
                    "support": support_refs,
                },
            )
            proposal_endpoint_ids[proposal_id] = node_id
            proposal_nodes[proposal_id] = {
                "node_id": node_id,
                "node_type": node_type,
                "label": label,
                "source": None,
                "attributes": {"semanticProposalId": proposal_id},
                "semantic_types": [],
                "evidence_refs": [],
                "coverage_state": "SUFFICIENT",
                "source_anchor_ref": None,
                "origin": "LLM_SEMANTIC_ENRICHMENT",
                "resolution_state": "CORROBORATED",
                "support_refs": support_refs,
            }
            existing_semantic[semantic_key] = node_id

        endpoint_map = {
            **{node_id: node_id for node_id in technical_node_ids},
            **{
                f"proposal:{proposal_id}": node_id
                for proposal_id, node_id in proposal_endpoint_ids.items()
            },
        }
        existing_edge_keys = {
            (
                str(edge.get("edge_type") or ""),
                str(edge.get("source_node_id") or ""),
                str(edge.get("target_node_id") or ""),
            )
            for edge in graph.edges
        }
        new_edges: list[dict[str, Any]] = []
        seen_edge_keys: set[tuple[str, str, str]] = set()
        for raw in raw_edges[:80]:
            if not isinstance(raw, dict):
                continue
            edge_type = str(raw.get("edgeType") or "")
            source = endpoint_map.get(str(raw.get("sourceRef") or ""))
            target = endpoint_map.get(str(raw.get("targetRef") or ""))
            support_refs = cls._support_refs(raw.get("supportRefs"), authority_refs)
            if (
                edge_type not in _ALLOWED_EDGE_TYPES
                or not source
                or not target
                or not support_refs
            ):
                continue
            key = (edge_type, source, target)
            if key in seen_edge_keys or key in existing_edge_keys:
                continue
            seen_edge_keys.add(key)
            new_edges.append(
                {
                    "edge_id": cls._stable_id(
                        "edge",
                        {
                            "baseGraph": stable_base_id,
                            "type": edge_type,
                            "source": source,
                            "target": target,
                            "support": support_refs,
                        },
                    ),
                    "edge_type": edge_type,
                    "source_node_id": source,
                    "target_node_id": target,
                    "confidence": 1.0,
                    "attributes": {},
                    "evidence_refs": [],
                    "coverage_state": "SUFFICIENT",
                    "origin": "LLM_SEMANTIC_ENRICHMENT",
                    "resolution_state": "CORROBORATED",
                    "support_refs": support_refs,
                }
            )

        if not proposal_nodes and not new_edges:
            return graph, 0, 0
        nodes = [*graph.nodes, *proposal_nodes.values()]
        edges = [*graph.edges, *new_edges]
        enriched = cls._rebuild(graph, nodes, edges)
        return validate_program_graph(enriched), len(proposal_nodes), len(new_edges)

    @classmethod
    def _cluster_contexts(cls, graph: ProgramEvidenceGraph) -> list[dict[str, Any]]:
        """Create deterministic bounded business-analysis clusters from technical entrypoints."""
        node_by_id = {
            str(node.get("node_id")): node
            for node in graph.nodes
            if node.get("node_id")
        }
        adjacency: dict[str, list[tuple[str, dict[str, Any]]]] = {}
        for edge in graph.edges:
            if edge.get("edge_type") in _CLUSTER_EXCLUDED_EDGE_TYPES:
                continue
            source = str(edge.get("source_node_id") or "")
            target = str(edge.get("target_node_id") or "")
            if source not in node_by_id or target not in node_by_id:
                continue
            adjacency.setdefault(source, []).append((target, edge))
            adjacency.setdefault(target, []).append((source, edge))

        entrypoints = [
            node
            for node in graph.nodes
            if node.get("node_type") in _ENTRYPOINT_NODE_TYPES
            and cls._context_trusted(node)
        ]
        entrypoints.sort(
            key=lambda node: (
                _ENTRYPOINT_PRIORITY.get(str(node.get("node_type")), 99),
                str(node.get("label") or ""),
                str(node.get("node_id") or ""),
            )
        )

        clusters: list[tuple[set[str], dict[str, Any]]] = []
        for entrypoint in entrypoints:
            node_ids, edge_ids = cls._bounded_cluster(
                str(entrypoint["node_id"]),
                node_by_id,
                adjacency,
            )
            if not node_ids:
                continue
            # Skip AI/lifecycle fallback seeds already substantially covered by a
            # higher-priority API/event/process entrypoint cluster.
            if cls._overlaps_existing(node_ids, [row[0] for row in clusters]):
                continue
            context = cls._context_from_ids(
                graph,
                node_ids=node_ids,
                edge_ids=edge_ids,
                cluster_id=cls._cluster_id(entrypoint),
                entrypoint=entrypoint,
            )
            if context["nodes"]:
                clusters.append((node_ids, context))
            if len(clusters) >= _MAX_CLUSTERS:
                break

        # Repositories without explicit public/runtime entrypoints still deserve one
        # bounded semantic pass when there is trusted AI/data/business evidence.
        if not clusters:
            fallback_nodes = [
                node
                for node in graph.nodes
                if node.get("node_type") in _CONTEXT_NODE_TYPES
                and cls._context_trusted(node)
            ][:40]
            if fallback_nodes:
                seed_ids = {str(node["node_id"]) for node in fallback_nodes}
                expanded = set(seed_ids)
                edge_ids: set[str] = set()
                for seed_id in list(seed_ids):
                    node_ids, local_edges = cls._bounded_cluster(
                        seed_id,
                        node_by_id,
                        adjacency,
                        max_depth=3,
                        max_nodes=_CLUSTER_MAX_NODES,
                    )
                    expanded.update(node_ids)
                    edge_ids.update(local_edges)
                    if len(expanded) >= _CLUSTER_MAX_NODES:
                        break
                context = cls._context_from_ids(
                    graph,
                    node_ids=set(list(sorted(expanded))[:_CLUSTER_MAX_NODES]),
                    edge_ids=edge_ids,
                    cluster_id="fallback",
                    entrypoint=None,
                )
                if context["nodes"]:
                    clusters.append((expanded, context))

        return [context for _, context in clusters]

    @classmethod
    def _bounded_cluster(
        cls,
        seed_id: str,
        node_by_id: dict[str, dict[str, Any]],
        adjacency: dict[str, list[tuple[str, dict[str, Any]]]],
        *,
        max_depth: int = _CLUSTER_MAX_DEPTH,
        max_nodes: int = _CLUSTER_MAX_NODES,
    ) -> tuple[set[str], set[str]]:
        if seed_id not in node_by_id:
            return set(), set()
        selected = {seed_id}
        edge_ids: set[str] = set()
        queue = deque([(seed_id, 0)])
        while queue:
            node_id, depth = queue.popleft()
            if depth >= max_depth:
                continue
            neighbors = sorted(
                adjacency.get(node_id, []),
                key=lambda row: (
                    str(row[1].get("edge_type") or ""),
                    str(row[1].get("edge_id") or ""),
                    row[0],
                ),
            )
            for next_id, edge in neighbors:
                next_node = node_by_id.get(next_id)
                if not next_node or not cls._context_trusted(next_node, allow_unresolved=True):
                    continue
                edge_id = str(edge.get("edge_id") or "")
                if edge_id:
                    edge_ids.add(edge_id)
                if next_id in selected:
                    continue
                if len(selected) >= max_nodes:
                    return selected, edge_ids
                selected.add(next_id)
                queue.append((next_id, depth + 1))
        return selected, edge_ids

    @staticmethod
    def _overlaps_existing(candidate: set[str], existing: list[set[str]]) -> bool:
        if not candidate:
            return True
        for prior in existing:
            if not prior:
                continue
            overlap = len(candidate.intersection(prior)) / min(len(candidate), len(prior))
            if overlap >= _CLUSTER_OVERLAP_THRESHOLD:
                return True
        return False

    @classmethod
    def _context_from_ids(
        cls,
        graph: ProgramEvidenceGraph,
        *,
        node_ids: set[str],
        edge_ids: set[str],
        cluster_id: str,
        entrypoint: dict[str, Any] | None,
    ) -> dict[str, Any]:
        rows = [
            node
            for node in graph.nodes
            if str(node.get("node_id") or "") in node_ids
            and node.get("node_type") in _CONTEXT_NODE_TYPES
        ]
        rows.sort(key=lambda node: str(node.get("node_id") or ""))
        allowed_ids = {str(node.get("node_id")) for node in rows}
        edges = [
            edge
            for edge in graph.edges
            if str(edge.get("edge_id") or "") in edge_ids
            and str(edge.get("source_node_id") or "") in allowed_ids
            and str(edge.get("target_node_id") or "") in allowed_ids
        ]
        edges.sort(key=lambda edge: str(edge.get("edge_id") or ""))
        unresolved = [
            ref
            for ref in graph.unresolved_frontiers
            if str(ref) in allowed_ids or not str(ref).startswith("node:")
        ][:20]
        return {
            "clusterId": cluster_id,
            "entrypointRef": (
                str(entrypoint.get("node_id")) if entrypoint is not None else None
            ),
            "entrypointType": (
                str(entrypoint.get("node_type")) if entrypoint is not None else "FALLBACK"
            ),
            "entrypointLabel": (
                str(entrypoint.get("label")) if entrypoint is not None else "fallback"
            ),
            "nodes": [cls._safe_node(node) for node in rows[:_CLUSTER_MAX_NODES]],
            "edges": [cls._safe_edge(edge) for edge in edges[:_CLUSTER_MAX_EDGES]],
            "unresolvedFrontiers": unresolved,
            "coverageState": graph.coverage_state,
        }

    @staticmethod
    def _context_trusted(
        node: dict[str, Any],
        *,
        allow_unresolved: bool = False,
    ) -> bool:
        state = str(node.get("resolution_state") or "OBSERVED")
        if state == "INFERRED":
            return False
        if state == "UNRESOLVED":
            return allow_unresolved and node.get("node_type") == "UNRESOLVED_DYNAMIC_TARGET"
        if str(node.get("origin") or "") == "LLM_SEMANTIC_ENRICHMENT":
            return False
        return state in {"OBSERVED", "CORROBORATED"}

    @staticmethod
    def _safe_node(node: dict[str, Any]) -> dict[str, Any]:
        source = node.get("source") if isinstance(node.get("source"), dict) else {}
        attrs = node.get("attributes") if isinstance(node.get("attributes"), dict) else {}
        safe_attrs = {
            str(key): value
            for key, value in attrs.items()
            if isinstance(value, (str, int, float, bool, list))
        }
        return {
            "nodeId": node.get("node_id"),
            "nodeType": node.get("node_type"),
            "label": node.get("label"),
            "semanticTypes": list(node.get("semantic_types") or []),
            "origin": node.get("origin"),
            "resolutionState": node.get("resolution_state"),
            "attributes": safe_attrs,
            "source": (
                {
                    "filePath": source.get("file_path"),
                    "symbolRef": source.get("symbol_ref"),
                    "startLine": source.get("start_line"),
                    "endLine": source.get("end_line"),
                }
                if source
                else None
            ),
        }

    @staticmethod
    def _safe_edge(edge: dict[str, Any]) -> dict[str, Any]:
        return {
            "edgeId": edge.get("edge_id"),
            "edgeType": edge.get("edge_type"),
            "sourceNodeId": edge.get("source_node_id"),
            "targetNodeId": edge.get("target_node_id"),
            "origin": edge.get("origin"),
            "resolutionState": edge.get("resolution_state"),
        }

    @classmethod
    def _prompt(cls, context: dict[str, Any]) -> str:
        return (
            "You are the LCSP Business Semantic Enricher. Analyze only this bounded cluster from "
            "the Unified System Evidence Graph. Infer business processes, steps, actors, data "
            "subjects, business decisions/outcomes, business objects, and AI capability roles only "
            "when concrete graph refs in THIS cluster support them. Every proposed node and edge "
            "must cite supportRefs that already exist in the supplied cluster. Do not decide legal "
            "applicability, compliance/non-compliance, prohibited practice, or legal risk tier. Do "
            "not invent source facts. If business meaning is ambiguous, omit the proposal. Existing "
            "technical node IDs may be edge endpoints directly; proposed semantic node endpoints use "
            "proposal:<proposalNodeId>. Submit exactly one native tool call.\n\n"
            + json.dumps(context, ensure_ascii=False, separators=(",", ":"))
        )

    @staticmethod
    def _tool() -> LLMToolDefinition:
        support_ref = {
            "type": "string",
            "pattern": r"^(node|edge|source-anchor):[A-Za-z0-9_-]{4,160}$",
        }
        return LLMToolDefinition(
            name="submit_business_semantics",
            description="Submit only provenance-backed business semantic graph proposals.",
            tool_choice_required=True,
            input_schema={
                "type": "object",
                "additionalProperties": False,
                "required": ["nodes", "edges"],
                "properties": {
                    "nodes": {
                        "type": "array",
                        "maxItems": 40,
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": [
                                "proposalNodeId",
                                "nodeType",
                                "label",
                                "supportRefs",
                            ],
                            "properties": {
                                "proposalNodeId": {
                                    "type": "string",
                                    "pattern": r"^[a-z][a-z0-9_-]{1,63}$",
                                },
                                "nodeType": {
                                    "type": "string",
                                    "enum": sorted(_ALLOWED_NODE_TYPES),
                                },
                                "label": {
                                    "type": "string",
                                    "minLength": 1,
                                    "maxLength": 160,
                                },
                                "supportRefs": {
                                    "type": "array",
                                    "minItems": 1,
                                    "maxItems": 12,
                                    "uniqueItems": True,
                                    "items": support_ref,
                                },
                            },
                        },
                    },
                    "edges": {
                        "type": "array",
                        "maxItems": 80,
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": [
                                "edgeType",
                                "sourceRef",
                                "targetRef",
                                "supportRefs",
                            ],
                            "properties": {
                                "edgeType": {
                                    "type": "string",
                                    "enum": sorted(_ALLOWED_EDGE_TYPES),
                                },
                                "sourceRef": {"type": "string", "maxLength": 200},
                                "targetRef": {"type": "string", "maxLength": 200},
                                "supportRefs": {
                                    "type": "array",
                                    "minItems": 1,
                                    "maxItems": 12,
                                    "uniqueItems": True,
                                    "items": support_ref,
                                },
                            },
                        },
                    },
                },
            },
        )

    @staticmethod
    def _technical_support_refs(graph: ProgramEvidenceGraph) -> set[str]:
        """Return refs that existed before LLM semantic enrichment and may be authority."""
        node_refs = {
            str(node.get("node_id"))
            for node in graph.nodes
            if node.get("node_id")
            and str(node.get("origin") or "STATIC_ANALYSIS")
            != "LLM_SEMANTIC_ENRICHMENT"
        }
        edge_refs = {
            str(edge.get("edge_id"))
            for edge in graph.edges
            if edge.get("edge_id")
            and str(edge.get("origin") or "STATIC_ANALYSIS")
            != "LLM_SEMANTIC_ENRICHMENT"
        }
        anchor_refs = {
            str(anchor.get("anchor_id"))
            for anchor in graph.source_anchors
            if anchor.get("anchor_id")
            and str(anchor.get("graph_node_id") or "") in node_refs
        }
        return node_refs | edge_refs | anchor_refs

    @staticmethod
    def _support_refs(value: Any, known: set[str]) -> list[str]:
        if not isinstance(value, list):
            return []
        refs = []
        for raw in value[:12]:
            ref = str(raw or "")
            if ref in known and ref not in refs:
                refs.append(ref)
        return refs

    @staticmethod
    def _label(value: Any) -> str:
        label = " ".join(str(value or "").split())[:160]
        if not label or _LEGAL_CONCLUSION_RE.search(label):
            return ""
        return label

    @classmethod
    def _namespace_payload(
        cls,
        payload: dict[str, Any],
        cluster_id: str,
    ) -> dict[str, Any]:
        """Namespace model-local proposal IDs so independent clusters cannot collide."""
        if not isinstance(payload, dict):
            raise ValueError("business semantic proposal payload must be an object")
        raw_nodes = payload.get("nodes") if isinstance(payload.get("nodes"), list) else []
        raw_edges = payload.get("edges") if isinstance(payload.get("edges"), list) else []
        prefix = "c" + hashlib.sha256(cluster_id.encode()).hexdigest()[:8] + "_"
        mapping: dict[str, str] = {}
        nodes: list[dict[str, Any]] = []
        for raw in raw_nodes:
            if not isinstance(raw, dict):
                continue
            original = str(raw.get("proposalNodeId") or "")
            if not _PROPOSAL_ID_RE.fullmatch(original):
                nodes.append(dict(raw))
                continue
            namespaced = (prefix + original)[:63].rstrip("_-")
            if len(namespaced) < 2:
                namespaced = prefix + "node"
            mapping[original] = namespaced
            nodes.append({**raw, "proposalNodeId": namespaced})

        edges: list[dict[str, Any]] = []
        for raw in raw_edges:
            if not isinstance(raw, dict):
                continue
            row = dict(raw)
            for key in ("sourceRef", "targetRef"):
                value = str(row.get(key) or "")
                if value.startswith("proposal:"):
                    original = value.split(":", 1)[1]
                    if original in mapping:
                        row[key] = f"proposal:{mapping[original]}"
            edges.append(row)
        return {"nodes": nodes, "edges": edges}

    @classmethod
    def _existing_semantic_nodes(
        cls,
        graph: ProgramEvidenceGraph,
    ) -> dict[tuple[str, str, tuple[str, ...]], str]:
        result: dict[tuple[str, str, tuple[str, ...]], str] = {}
        for node in graph.nodes:
            if str(node.get("origin") or "") != "LLM_SEMANTIC_ENRICHMENT":
                continue
            node_id = str(node.get("node_id") or "")
            label = str(node.get("label") or "")
            node_type = str(node.get("node_type") or "")
            support_refs = [str(ref) for ref in node.get("support_refs") or []]
            if node_id and label and node_type and support_refs:
                result[cls._semantic_identity(node_type, label, support_refs)] = node_id
        return result

    @staticmethod
    def _semantic_identity(
        node_type: str,
        label: str,
        support_refs: list[str],
    ) -> tuple[str, str, tuple[str, ...]]:
        normalized_label = " ".join(label.lower().split())
        return node_type, normalized_label, tuple(sorted(set(support_refs)))

    @staticmethod
    def _cluster_id(entrypoint: dict[str, Any]) -> str:
        return hashlib.sha256(
            json.dumps(
                {
                    "nodeId": entrypoint.get("node_id"),
                    "nodeType": entrypoint.get("node_type"),
                    "label": entrypoint.get("label"),
                },
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        ).hexdigest()[:16]

    @classmethod
    def _rebuild(
        cls,
        graph: ProgramEvidenceGraph,
        nodes: list[dict[str, Any]],
        edges: list[dict[str, Any]],
    ) -> ProgramEvidenceGraph:
        indexes: dict[str, list[str]] = {}
        for node in nodes:
            node_id = str(node.get("node_id") or "")
            if not node_id:
                continue
            indexes.setdefault(f"node:{node.get('node_type')}", []).append(node_id)
            indexes.setdefault(f"origin:{node.get('origin')}", []).append(node_id)
            indexes.setdefault(
                f"resolution:{node.get('resolution_state')}", []
            ).append(node_id)
            for semantic in node.get("semantic_types") or []:
                indexes.setdefault(f"semantic:{semantic}", []).append(node_id)
        indexes = {
            key: sorted(set(value)) for key, value in sorted(indexes.items())
        }
        evidence_refs = sorted(
            {
                str(ref)
                for item in [*nodes, *edges]
                for ref in [
                    *(item.get("evidence_refs") or []),
                    *(item.get("support_refs") or []),
                ]
                if str(ref)
            }
        )
        provenance = dict(graph.provenance)
        provenance["business_semantic_enrichment"] = "LLM_PROVENANCE_GATED_CLUSTERED"
        body = {
            "schema_version": graph.schema_version,
            "snapshot_id": graph.snapshot_id,
            "commit_sha": graph.commit_sha,
            "nodes": nodes,
            "edges": edges,
            "source_anchors": graph.source_anchors,
            "indexes": indexes,
            "unresolved_frontiers": graph.unresolved_frontiers,
            "coverage_state": graph.coverage_state,
            "coverage_notes": graph.coverage_notes,
            "provenance": provenance,
            "evidence_refs": evidence_refs,
        }
        digest = hashlib.sha256(
            json.dumps(body, sort_keys=True, separators=(",", ":"), default=str).encode()
        ).hexdigest()
        return replace(
            graph,
            graph_id=f"program-graph:{digest[:32]}",
            node_count=len(nodes),
            edge_count=len(edges),
            nodes=nodes,
            edges=edges,
            indexes=indexes,
            provenance=provenance,
            evidence_refs=evidence_refs,
            graph_hash=f"sha256:{digest}",
        )

    @staticmethod
    def _stable_id(kind: str, payload: object) -> str:
        digest = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
        ).hexdigest()
        return f"{kind}:{digest[:32]}"
