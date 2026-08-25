"""Build first-class semantic data lineage without trusting identifier names alone.

The base repository extractor owns language syntax. This pass consumes its Semantic IR
and adds stable DATA_OBJECT flow identities around values, calls, AI invocations and
framework boundaries. It also reads protocol contracts (currently protobuf).

Identifier taxonomy remains a weak seed. Trusted biometric/government-ID semantics are
promoted later by ``SensitiveLineageGate`` only when one bounded lineage path contains
the required processing behavior; this extractor never promotes sensitive semantics from
file-level lexical co-occurrence.
"""
from __future__ import annotations

import re
from pathlib import Path

from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticEdgeFact, SemanticNodeFact, SemanticProgram
from tools.common.capabilities.evidence.graph.lineage.sensitive.sensitive_data import (
    semantic_types_for_identifier,
)
from tools.common.capabilities.evidence.graph.schema.source_roles import is_test_source_path

_EXCLUDED = {
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    "coverage",
    "vendor",
    ".venv",
    "venv",
    "__pycache__",
    "target",
    "bin",
    "obj",
}
_DATA_CARRIER_TYPES = frozenset(
    {
        "PARAMETER",
        "RETURN_VALUE",
        "VARIABLE",
        "PROPERTY",
        "DTO_FIELD",
        "AI_INPUT",
        "AI_OUTPUT",
        "PERSONAL_DATA",
        "SENSITIVE_DATA",
        "MEDIA_OBJECT",
    }
)
_DERIVATION_EDGES = frozenset(
    {
        "ALIASES",
        "ASSIGNS",
        "MAPS_TO",
        "PARSES",
        "SERIALIZES",
        "DESERIALIZES",
        "CASTS_TO",
        "TRANSFORMS",
        "VALIDATES",
        "SANITIZES",
        "READS_PROPERTY",
        "WRITES_PROPERTY",
    }
)
_BOUNDARY_PUBLISH_EDGES = frozenset(
    {
        "PUBLISHES_EVENT",
        "PUBLISHES_TO_QUEUE",
        "PUBLISHES_COMMAND",
        "PUBLISHES_QUERY",
    }
)
_BOUNDARY_CONSUME_EDGES = frozenset(
    {
        "CONSUMES_EVENT",
        "CONSUMES_FROM_QUEUE",
        "HANDLES_COMMAND",
        "HANDLES_QUERY",
    }
)
_BOUNDARY_TYPES = frozenset({"EVENT", "QUEUE", "COMMAND", "QUERY", "PROTOCOL_MESSAGE"})

_PROTO_MESSAGE_RE = re.compile(r"\bmessage\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{(.*?)\}", re.S)
_PROTO_FIELD_RE = re.compile(
    r"(?m)^\s*(?:repeated\s+|optional\s+)?([.A-Za-z_][\w.]*)\s+([A-Za-z_][\w]*)\s*=\s*\d+\s*;"
)
_PROTO_RPC_RE = re.compile(
    r"\brpc\s+([A-Za-z_][\w]*)\s*\(\s*(?:stream\s+)?([.A-Za-z_][\w.]*)\s*\)\s*returns\s*\(\s*(?:stream\s+)?([.A-Za-z_][\w.]*)\s*\)"
)


class SemanticDataLineageExtractor:
    """Enrich Semantic IR with lineage identities and protocol contract evidence."""

    def __init__(self, workspace_path: str | Path) -> None:
        self.workspace = Path(workspace_path).resolve(strict=False)

    def enrich(self, program: SemanticProgram) -> SemanticProgram:
        self._materialize_data_objects(program)
        self._link_value_flow(program)
        self._link_framework_boundary_payloads(program)
        self._link_ai_inputs_outputs(program)
        self._extract_protobuf_contracts(program)
        # Do not infer biometric/government-ID processing from same-file vocabulary.
        # SensitiveLineageGate runs after contract/DB lineage is complete and is the
        # single authority that may promote those weak seeds to CORROBORATED by proving
        # the required operation composition on one connected data-flow path.
        return program

    def _materialize_data_objects(self, program: SemanticProgram) -> None:
        for node in tuple(program.nodes):
            if node.node_type not in _DATA_CARRIER_TYPES:
                continue
            key = self._data_key(node.key)
            semantic_types = tuple(sorted(set(node.semantic_types)))
            state = "INFERRED" if semantic_types else "OBSERVED"
            program.add_node(
                SemanticNodeFact(
                    key,
                    "DATA_OBJECT",
                    node.label,
                    node.file_path,
                    node.start_line,
                    node.end_line,
                    node.symbol_ref,
                    attributes={"sourceNodeType": node.node_type},
                    semantic_types=semantic_types,
                    evidence_refs=node.evidence_refs,
                    origin="DATA_LINEAGE",
                    resolution_state=state,
                )
            )
            program.add_edge(
                SemanticEdgeFact(
                    "CARRIES_DATA",
                    node.key,
                    key,
                    origin="DATA_LINEAGE",
                    resolution_state="OBSERVED",
                )
            )

    def _link_value_flow(self, program: SemanticProgram) -> None:
        node_by_key = {node.key: node for node in program.nodes}
        carrier_keys = {
            node.key
            for node in program.nodes
            if node.node_type in _DATA_CARRIER_TYPES
        }
        for edge in tuple(program.edges):
            source = node_by_key.get(edge.source_key)
            target = node_by_key.get(edge.target_key)
            if not source or not target:
                continue
            if edge.edge_type in _DERIVATION_EDGES:
                if edge.source_key in carrier_keys and edge.target_key in carrier_keys:
                    program.add_edge(
                        SemanticEdgeFact(
                            "FLOWS_TO",
                            self._data_key(edge.source_key),
                            self._data_key(edge.target_key),
                            confidence=edge.confidence,
                            origin="DATA_LINEAGE",
                            resolution_state="CORROBORATED",
                        )
                    )
            elif edge.edge_type == "PASSES_ARGUMENT" and edge.source_key in carrier_keys:
                program.add_edge(
                    SemanticEdgeFact(
                        "FLOWS_TO",
                        self._data_key(edge.source_key),
                        edge.target_key,
                        confidence=edge.confidence,
                        origin="DATA_LINEAGE",
                        resolution_state="OBSERVED",
                    )
                )
            elif edge.edge_type == "RECEIVES_RETURN" and edge.target_key in carrier_keys:
                program.add_edge(
                    SemanticEdgeFact(
                        "FLOWS_TO",
                        edge.source_key,
                        self._data_key(edge.target_key),
                        confidence=edge.confidence,
                        origin="DATA_LINEAGE",
                        resolution_state="OBSERVED",
                    )
                )

    def _link_framework_boundary_payloads(self, program: SemanticProgram) -> None:
        node_by_key = {node.key: node for node in program.nodes}
        incoming_by_call: dict[str, list[str]] = {}
        for edge in program.edges:
            if edge.edge_type == "FLOWS_TO" and edge.source_key.startswith("data-object:"):
                incoming_by_call.setdefault(edge.target_key, []).append(edge.source_key)

        boundary_data: dict[str, str] = {}
        for edge in tuple(program.edges):
            if edge.edge_type not in _BOUNDARY_PUBLISH_EDGES:
                continue
            boundary = node_by_key.get(edge.target_key)
            if not boundary or boundary.node_type not in _BOUNDARY_TYPES:
                continue
            data_key = boundary_data.setdefault(
                boundary.key, f"data-object:boundary:{boundary.key}"
            )
            program.add_node(
                SemanticNodeFact(
                    data_key,
                    "DATA_OBJECT",
                    f"{boundary.node_type.lower()} payload",
                    boundary.file_path,
                    boundary.start_line,
                    boundary.end_line,
                    attributes={
                        "boundaryType": boundary.node_type,
                        "boundaryIdentity": boundary.label,
                    },
                    origin="DATA_LINEAGE",
                    resolution_state="OBSERVED",
                )
            )
            program.add_edge(
                SemanticEdgeFact(
                    "CARRIES_DATA",
                    boundary.key,
                    data_key,
                    origin="DATA_LINEAGE",
                )
            )
            for source_data in incoming_by_call.get(edge.source_key, []):
                program.add_edge(
                    SemanticEdgeFact(
                        "FLOWS_TO",
                        source_data,
                        data_key,
                        origin="DATA_LINEAGE",
                        resolution_state="CORROBORATED",
                    )
                )

        for edge in tuple(program.edges):
            if edge.edge_type not in _BOUNDARY_CONSUME_EDGES:
                continue
            boundary = node_by_key.get(edge.source_key)
            if not boundary or boundary.node_type not in _BOUNDARY_TYPES:
                continue
            data_key = boundary_data.get(boundary.key) or f"data-object:boundary:{boundary.key}"
            if boundary.key not in boundary_data:
                program.add_node(
                    SemanticNodeFact(
                        data_key,
                        "DATA_OBJECT",
                        f"{boundary.node_type.lower()} payload",
                        boundary.file_path,
                        boundary.start_line,
                        boundary.end_line,
                        attributes={
                            "boundaryType": boundary.node_type,
                            "boundaryIdentity": boundary.label,
                        },
                        origin="DATA_LINEAGE",
                        resolution_state="OBSERVED",
                    )
                )
                program.add_edge(
                    SemanticEdgeFact(
                        "CARRIES_DATA",
                        boundary.key,
                        data_key,
                        origin="DATA_LINEAGE",
                    )
                )
                boundary_data[boundary.key] = data_key
            program.add_edge(
                SemanticEdgeFact(
                    "FLOWS_TO",
                    data_key,
                    edge.target_key,
                    origin="DATA_LINEAGE",
                    resolution_state="CORROBORATED",
                )
            )

    def _link_ai_inputs_outputs(self, program: SemanticProgram) -> None:
        edges = tuple(program.edges)
        for ai in tuple(program.nodes):
            if ai.node_type != "AI_MODEL_INVOCATION":
                continue
            input_key = f"ai-input:{ai.key}"
            output_key = f"ai-output:{ai.key}"
            input_sources = [
                edge.source_key
                for edge in edges
                if edge.edge_type == "FLOWS_TO"
                and edge.target_key == ai.key
                and edge.source_key.startswith("data-object:")
            ]
            output_targets = [
                edge.target_key
                for edge in edges
                if edge.edge_type == "FLOWS_TO"
                and edge.source_key == ai.key
                and edge.target_key.startswith("data-object:")
            ]
            if input_sources:
                program.add_node(
                    SemanticNodeFact(
                        input_key,
                        "AI_INPUT",
                        f"input to {ai.label}",
                        ai.file_path,
                        ai.start_line,
                        ai.end_line,
                        origin="DATA_LINEAGE",
                        resolution_state="CORROBORATED",
                    )
                )
                for source_key in input_sources:
                    program.add_edge(
                        SemanticEdgeFact(
                            "FLOWS_TO",
                            source_key,
                            input_key,
                            origin="DATA_LINEAGE",
                            resolution_state="CORROBORATED",
                        )
                    )
                program.add_edge(
                    SemanticEdgeFact(
                        "SENDS_TO_AI",
                        input_key,
                        ai.key,
                        origin="DATA_LINEAGE",
                        resolution_state="CORROBORATED",
                    )
                )
            if output_targets:
                program.add_node(
                    SemanticNodeFact(
                        output_key,
                        "AI_OUTPUT",
                        f"output from {ai.label}",
                        ai.file_path,
                        ai.start_line,
                        ai.end_line,
                        origin="DATA_LINEAGE",
                        resolution_state="CORROBORATED",
                    )
                )
                program.add_edge(
                    SemanticEdgeFact(
                        "RECEIVES_FROM_AI",
                        ai.key,
                        output_key,
                        origin="DATA_LINEAGE",
                        resolution_state="CORROBORATED",
                    )
                )
                for target_key in output_targets:
                    program.add_edge(
                        SemanticEdgeFact(
                            "FLOWS_TO",
                            output_key,
                            target_key,
                            origin="DATA_LINEAGE",
                            resolution_state="CORROBORATED",
                        )
                    )

    def _extract_protobuf_contracts(self, program: SemanticProgram) -> None:
        for path in self._files({".proto"}):
            rel = path.relative_to(self.workspace).as_posix()
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            contract_key = f"data-contract:proto:{rel}"
            program.add_node(
                SemanticNodeFact(
                    contract_key,
                    "DATA_CONTRACT",
                    rel,
                    rel,
                    1,
                    1,
                    attributes={"protocol": "GRPC_PROTOBUF"},
                    origin="CONTRACT_ANALYSIS",
                )
            )
            message_keys: dict[str, str] = {}
            for match in _PROTO_MESSAGE_RE.finditer(text):
                name, body = match.groups()
                line = _line(text, match.start())
                message_key = f"protocol-message:{rel}:{name}"
                message_keys[name] = message_key
                program.add_node(
                    SemanticNodeFact(
                        message_key,
                        "PROTOCOL_MESSAGE",
                        name,
                        rel,
                        line,
                        line,
                        name,
                        attributes={"protocol": "GRPC_PROTOBUF"},
                        origin="CONTRACT_ANALYSIS",
                    )
                )
                program.add_edge(
                    SemanticEdgeFact(
                        "DECLARES",
                        contract_key,
                        message_key,
                        origin="CONTRACT_ANALYSIS",
                    )
                )
                for field_match in _PROTO_FIELD_RE.finditer(body):
                    field_type, field_name = field_match.groups()
                    field_line = line + body.count("\n", 0, field_match.start())
                    semantic_types = semantic_types_for_identifier(field_name)
                    data_key = f"data-object:proto:{rel}:{name}:{field_name}"
                    program.add_node(
                        SemanticNodeFact(
                            data_key,
                            "DATA_OBJECT",
                            f"{name}.{field_name}",
                            rel,
                            field_line,
                            field_line,
                            f"{name}.{field_name}",
                            attributes={
                                "protocol": "GRPC_PROTOBUF",
                                "fieldType": field_type,
                            },
                            semantic_types=semantic_types,
                            origin="CONTRACT_ANALYSIS",
                            resolution_state=(
                                "INFERRED" if semantic_types else "OBSERVED"
                            ),
                        )
                    )
                    program.add_edge(
                        SemanticEdgeFact(
                            "DECLARES_DATA",
                            message_key,
                            data_key,
                            origin="CONTRACT_ANALYSIS",
                        )
                    )
                    program.add_edge(
                        SemanticEdgeFact(
                            "CARRIES_DATA",
                            message_key,
                            data_key,
                            origin="CONTRACT_ANALYSIS",
                        )
                    )

            for rpc in _PROTO_RPC_RE.finditer(text):
                method, request_type, response_type = rpc.groups()
                line = _line(text, rpc.start())
                method_key = f"grpc-method:{rel}:{method}"
                program.add_node(
                    SemanticNodeFact(
                        method_key,
                        "GRPC_METHOD",
                        method,
                        rel,
                        line,
                        line,
                        method,
                        attributes={
                            "requestType": request_type,
                            "responseType": response_type,
                        },
                        origin="CONTRACT_ANALYSIS",
                    )
                )
                program.add_edge(
                    SemanticEdgeFact(
                        "DECLARES",
                        contract_key,
                        method_key,
                        origin="CONTRACT_ANALYSIS",
                    )
                )
                request_key = message_keys.get(request_type.split(".")[-1])
                response_key = message_keys.get(response_type.split(".")[-1])
                if request_key:
                    program.add_edge(
                        SemanticEdgeFact(
                            "FLOWS_TO",
                            request_key,
                            method_key,
                            origin="CONTRACT_ANALYSIS",
                        )
                    )
                if response_key:
                    program.add_edge(
                        SemanticEdgeFact(
                            "FLOWS_TO",
                            method_key,
                            response_key,
                            origin="CONTRACT_ANALYSIS",
                        )
                    )

    def _files(self, extensions: set[str]) -> tuple[Path, ...]:
        result = []
        for path in self.workspace.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in extensions:
                continue
            try:
                relative = path.relative_to(self.workspace)
            except ValueError:
                continue
            if any(part in _EXCLUDED for part in relative.parts):
                continue
            rel = relative.as_posix()
            if is_test_source_path(rel):
                continue
            result.append(path)
        return tuple(sorted(result))

    @staticmethod
    def _data_key(source_key: str) -> str:
        return f"data-object:{source_key}"


def _line(text: str, offset: int) -> int:
    return text.count("\n", 0, max(0, offset)) + 1
