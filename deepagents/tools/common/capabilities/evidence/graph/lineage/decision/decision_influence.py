"""Connect data lineage to structurally proven business decisions and human controls."""
from __future__ import annotations

import re
from collections import deque

from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram

_ACTION_EDGES = frozenset({"APPROVES", "REJECTS", "RANKS", "RECOMMENDS", "UPDATES_STATUS"})
_ACTION_TYPES = frozenset(
    {"APPROVAL", "REJECTION", "RANKING", "RECOMMENDATION", "STATUS_CHANGE", "BUSINESS_ACTION"}
)
_FLOW_EDGES = frozenset(
    {
        "FLOWS_TO",
        "PASSES_ARGUMENT",
        "RECEIVES_RETURN",
        "ASSIGNS",
        "ALIASES",
        "MAPS_TO",
        "TRANSFORMS",
        "PARSES",
        "VALIDATES",
        "SERIALIZES",
        "DESERIALIZES",
        "CALLS",
        "CALLS_DYNAMICALLY",
        "RESOLVES_TO",
        "HANDLED_BY",
        "PUBLISHES_COMMAND",
        "HANDLES_COMMAND",
        "PUBLISHES_QUERY",
        "HANDLES_QUERY",
        "PUBLISHES_EVENT",
        "CONSUMES_EVENT",
        "PUBLISHES_TO_QUEUE",
        "CONSUMES_FROM_QUEUE",
        "WRITES_TO",
        "PERSISTS_TO",
        "SENDS_TO_EXTERNAL",
    }
)
_EFFECT_EDGES = frozenset(
    {
        "WRITES_TO",
        "PERSISTS_TO",
        "SENDS_TO_EXTERNAL",
        "PUBLISHES_EVENT",
        "PUBLISHES_TO_QUEUE",
    }
)
_EFFECT_TYPES = frozenset(
    {
        "REPOSITORY_ACCESS",
        "DATABASE",
        "TABLE",
        "ENTITY",
        "EXTERNAL_API",
        "EXTERNAL_SERVICE",
        "FILE_STORAGE",
        "QUEUE",
        "EVENT",
    }
)
_READ_LIKE_ACTION_RE = re.compile(
    r"(?:^|[.$_])(?:get|fetch|read|find|list|load|lookup|search|query|assert|is|has|exists|"
    r"require|get_accepted|accepted_)[A-Za-z0-9_$.-]*",
    re.I,
)
_MAX_EFFECT_HOPS = 10


class DecisionInfluenceEnricher:
    """Materialize BUSINESS_DECISION only when a business action reaches a real effect.

    Lexical action hints are high-recall candidates only. A call such as
    ``get_accepted_technical_profile`` may contain ``accept`` but is a read, not a
    decision. Promotion requires a bounded structural path from the action call to a
    persistence/external/event effect. This pass remains technical evidence only and
    never decides legal automation or risk tier.
    """

    def enrich(self, program: SemanticProgram) -> SemanticProgram:
        node_by_key = {node.key: node for node in program.nodes}
        edges = tuple(program.edges)
        incoming_data = self._incoming_data(edges)
        outgoing_data = self._outgoing_data(edges)
        adjacency = self._adjacency(edges)

        for edge in edges:
            if edge.edge_type not in _ACTION_EDGES:
                continue
            call = node_by_key.get(edge.source_key)
            action = node_by_key.get(edge.target_key)
            if not call or not action or action.node_type not in _ACTION_TYPES:
                continue
            if self._read_like(call.label):
                continue

            effect_keys = self._reachable_effects(
                call.key,
                node_by_key=node_by_key,
                adjacency=adjacency,
            )
            if not effect_keys:
                # A lexical approve/reject/rank/recommend token without a bounded
                # business-state effect remains a candidate action node only.
                continue

            decision_key = f"business-decision:{action.key}"
            program.add_node(
                SemanticNodeFact(
                    decision_key,
                    "BUSINESS_DECISION",
                    action.label,
                    action.file_path,
                    action.start_line,
                    action.end_line,
                    action.symbol_ref,
                    attributes={
                        "actionCategory": action.node_type,
                        "derivedFromAction": action.key,
                        "effectCount": len(effect_keys),
                    },
                    semantic_types=action.semantic_types,
                    evidence_refs=action.evidence_refs,
                    origin="DATA_LINEAGE",
                    resolution_state="CORROBORATED",
                )
            )
            program.add_edge(
                SemanticEdgeFact(
                    "PRODUCES_OUTCOME",
                    decision_key,
                    action.key,
                    origin="DATA_LINEAGE",
                    resolution_state="CORROBORATED",
                )
            )

            for data_key in incoming_data.get(call.key, []):
                program.add_edge(
                    SemanticEdgeFact(
                        "INFLUENCES_DECISION",
                        data_key,
                        decision_key,
                        origin="DATA_LINEAGE",
                        resolution_state="CORROBORATED",
                    )
                )

            # Bind the semantic decision directly to concrete bounded side effects.
            # This gives query/claim topology a real path instead of treating the
            # returned value itself as proof that business state was written.
            for effect_key in sorted(effect_keys):
                program.add_edge(
                    SemanticEdgeFact(
                        "WRITES_BUSINESS_STATE",
                        decision_key,
                        effect_key,
                        origin="DATA_LINEAGE",
                        resolution_state="CORROBORATED",
                    )
                )

            reachable = self._reachable_nodes(call.key, adjacency)
            for human_key in sorted(reachable):
                human = node_by_key.get(human_key)
                if not human or human.node_type not in {"HUMAN_REVIEW", "HUMAN_OVERRIDE"}:
                    continue
                program.add_edge(
                    SemanticEdgeFact(
                        "REVIEWED_BY"
                        if human.node_type == "HUMAN_REVIEW"
                        else "OVERRIDDEN_BY",
                        decision_key,
                        human.key,
                        origin="DATA_LINEAGE",
                        resolution_state="CORROBORATED",
                    )
                )

            # Preserve returned state as lineage context, but do not equate it with
            # persistence. The effect edge above is the authoritative decision effect.
            for data_key in outgoing_data.get(call.key, []):
                program.add_edge(
                    SemanticEdgeFact(
                        "PRODUCES_OUTCOME",
                        decision_key,
                        data_key,
                        origin="DATA_LINEAGE",
                        resolution_state="CORROBORATED",
                    )
                )
        return program

    @staticmethod
    def _read_like(label: str) -> bool:
        normalized = str(label or "").strip()
        if not normalized:
            return True
        lowered = normalized.lower()
        if "get_accepted" in lowered or "accepted_" in lowered:
            return True
        leaf = re.split(r"[.$]", normalized)[-1]
        return bool(_READ_LIKE_ACTION_RE.match(leaf))

    @staticmethod
    def _incoming_data(edges: tuple[SemanticEdgeFact, ...]) -> dict[str, list[str]]:
        result: dict[str, list[str]] = {}
        for edge in edges:
            if edge.edge_type != "FLOWS_TO" or not edge.source_key.startswith("data-object:"):
                continue
            result.setdefault(edge.target_key, []).append(edge.source_key)
        return result

    @staticmethod
    def _outgoing_data(edges: tuple[SemanticEdgeFact, ...]) -> dict[str, list[str]]:
        result: dict[str, list[str]] = {}
        for edge in edges:
            if edge.edge_type != "FLOWS_TO" or not edge.target_key.startswith("data-object:"):
                continue
            result.setdefault(edge.source_key, []).append(edge.target_key)
        return result

    @staticmethod
    def _adjacency(
        edges: tuple[SemanticEdgeFact, ...],
    ) -> dict[str, list[tuple[str, str]]]:
        result: dict[str, list[tuple[str, str]]] = {}
        for edge in edges:
            if edge.edge_type not in _FLOW_EDGES:
                continue
            result.setdefault(edge.source_key, []).append(
                (edge.target_key, edge.edge_type)
            )
        return result

    @classmethod
    def _reachable_effects(
        cls,
        start: str,
        *,
        node_by_key: dict[str, SemanticNodeFact],
        adjacency: dict[str, list[tuple[str, str]]],
    ) -> set[str]:
        queue = deque([(start, 0)])
        seen = {start}
        effects: set[str] = set()
        while queue:
            current, depth = queue.popleft()
            if depth >= _MAX_EFFECT_HOPS:
                continue
            for nxt, edge_type in adjacency.get(current, []):
                node = node_by_key.get(nxt)
                if node is None:
                    continue
                if edge_type in _EFFECT_EDGES and node.node_type in _EFFECT_TYPES:
                    if node.node_type != "REPOSITORY_ACCESS" or str(
                        (node.attributes or {}).get("operation") or ""
                    ).upper() != "READ":
                        effects.add(nxt)
                if nxt not in seen:
                    seen.add(nxt)
                    queue.append((nxt, depth + 1))
        return effects

    @classmethod
    def _reachable_nodes(
        cls,
        start: str,
        adjacency: dict[str, list[tuple[str, str]]],
    ) -> set[str]:
        queue = deque([(start, 0)])
        seen = {start}
        while queue:
            current, depth = queue.popleft()
            if depth >= _MAX_EFFECT_HOPS:
                continue
            for nxt, _ in adjacency.get(current, []):
                if nxt in seen:
                    continue
                seen.add(nxt)
                queue.append((nxt, depth + 1))
        return seen
