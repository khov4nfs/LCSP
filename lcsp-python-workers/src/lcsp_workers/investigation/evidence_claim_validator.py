"""Fail closed when an LLM claim is not backed by material immutable provenance."""
from __future__ import annotations

import re
from dataclasses import replace
from typing import Any

from lcsp_workers.scanner.program_graph.models import ProgramEvidenceGraph
from lcsp_workers.scanner.program_graph.source_roles import (
    SOURCE_ROLE_PRODUCTION,
    SOURCE_ROLE_TEST,
    source_role,
)

from .claim_topology import (
    ClaimTopologyValidationError,
    topology_criterion_kind,
    validate_claim_topology,
)
from .models import ENGINEERING_EVIDENCE_CLAIM_TYPES, EvidenceClaim


class EvidenceClaimValidationError(ValueError):
    pass


_MAX_CLAIM_PROVENANCE_REFS = 8
_TOKEN = re.compile(r"[A-Za-zÀ-ỹ0-9]+", re.UNICODE)
_GENERIC_CRITERION_TOKENS = frozenset(
    {
        "ai",
        "system",
        "systems",
        "technical",
        "engineering",
        "requirement",
        "requirements",
        "evidence",
        "control",
        "controls",
        "data",
        "risk",
        "risks",
        "process",
        "management",
        "implementation",
        "implemented",
        "exists",
        "exist",
        "present",
        "documented",
        "ensure",
        "ensures",
        "must",
        "shall",
        "output",
        "surface",
        "with",
        "from",
        "that",
        "this",
        "the",
        "and",
        "for",
    }
)

# Certain governed requiredEvidence labels intentionally use stable business-neutral
# names while production code commonly uses protocol/library vocabulary instead. Map
# only those criteria to concrete implementation terms so valid C2PA/watermark/notice
# evidence can rank, while generic LLM token/accounting nodes cannot satisfy a
# transparency control merely because their label contains "output", "response", or
# an internal metadata field.
_CRITERION_EVIDENCE_TOKENS: dict[str, frozenset[str]] = {
    "AI_OUTPUT_SURFACE": frozenset(
        {
            "http",
            "notification",
            "publication",
            "publish",
            "storage",
            "stream",
            "websocket",
            "endpoint",
            "route",
            "download",
            "export",
            "render",
        }
    ),
    "DIRECT_AI_INTERACTION_SURFACE": frozenset(
        {
            "chatbot",
            "assistant",
            "bot",
            "chat",
            "conversation",
            "message",
            "reply",
        }
    ),
    "AI_INTERACTION_DISCLOSURE_CONTROL": frozenset(
        {"disclosure", "disclose", "notice", "label", "banner", "badge", "powered"}
    ),
    "AI_MEDIA_OUTPUT_SURFACE": frozenset(
        {
            "image",
            "audio",
            "video",
            "media",
            "frame",
            "codec",
            "mime",
            "render",
            "thumbnail",
        }
    ),
    "MACHINE_READABLE_MARK_CONTROL": frozenset(
        {
            "machine",
            "readable",
            "mark",
            "watermark",
            "provenance",
            "c2pa",
            "manifest",
            "xmp",
            "iptc",
            "exif",
            "credential",
            "credentials",
        }
    ),
    "PUBLIC_AI_CONTENT_SURFACE": frozenset(
        {"public", "publish", "publication", "post", "feed", "article", "broadcast", "share"}
    ),
    "PUBLIC_AI_CONTENT_NOTICE_CONTROL": frozenset(
        {"notice", "disclosure", "label", "badge", "banner"}
    ),
    "DEEPFAKE_OR_SIMULATED_MEDIA_SURFACE": frozenset(
        {
            "deepfake",
            "faceswap",
            "face",
            "swap",
            "voice",
            "clone",
            "cloning",
            "lipsync",
            "simulated",
            "synthetic",
            "impersonation",
        }
    ),
    "VISIBLE_DEEPFAKE_LABEL_CONTROL": frozenset(
        {"visible", "label", "overlay", "badge", "banner", "caption", "notice", "watermark"}
    ),
    "TRANSPARENCY_CONTROL_PRESENT": frozenset(
        {
            "disclosure",
            "notice",
            "label",
            "watermark",
            "provenance",
            "c2pa",
            "badge",
            "banner",
        }
    ),
    "TRANSPARENCY_CONTROL_CONTINUITY": frozenset(
        {
            "preserve",
            "preserved",
            "retain",
            "retained",
            "strip",
            "transcode",
            "export",
            "copy",
            "watermark",
            "provenance",
        }
    ),
    "ARTICLE_11_TRANSPARENCY_CONTROL": frozenset(
        {
            "disclosure",
            "notice",
            "label",
            "watermark",
            "provenance",
            "c2pa",
            "badge",
            "banner",
        }
    ),
}

_MATERIAL_RESOURCE_NODE_TYPES = frozenset(
    {
        "PACKAGE_DEPENDENCY",
        "EXTERNAL_SERVICE",
        "EXTERNAL_API",
        "DATABASE",
        "TABLE",
        "QUEUE",
        "AI_PROVIDER",
        "DATA_CATEGORY",
        "PERSONAL_DATA",
        "SENSITIVE_DATA",
    }
)
_CLOSED_CLAIM_TYPES = frozenset(
    {
        ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"],
        ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_not_met"],
    }
)


class EvidenceClaimValidator:
    """Validate and minimize claim provenance against persisted graph identities.

    LLM observations may contain broad search pages. A closed EngineeringRule claim is
    allowed to retain only a small, criterion-ranked set of production/material refs.
    Test/spec/script/example evidence cannot close MET/NOT_MET, and test-only refs from
    older graph artifacts are removed even when the graph itself predates test filtering.
    Path-oriented criteria additionally require their supplied graph refs to prove the
    asserted topology rather than merely naming individually valid nodes.
    """

    def validate(
        self,
        claim: EvidenceClaim,
        graph: ProgramEvidenceGraph | dict,
    ) -> EvidenceClaim:
        value = (
            graph
            if isinstance(graph, ProgramEvidenceGraph)
            else ProgramEvidenceGraph.from_dict(graph)
        )
        anchors = {str(anchor["anchor_id"]) for anchor in value.source_anchors}
        nodes = {str(node["node_id"]) for node in value.nodes}
        edges = {str(edge["edge_id"]) for edge in value.edges}
        known = set(value.evidence_refs) | anchors | nodes | edges

        supplied_refs = {
            *claim.evidence_refs,
            *claim.graph_path_refs,
            *claim.source_anchor_refs,
        }
        if not supplied_refs:
            raise EvidenceClaimValidationError("claim requires graph/source evidence refs")

        missing = [ref for ref in claim.evidence_refs if ref not in known]
        if missing:
            raise EvidenceClaimValidationError(f"unknown evidence refs: {missing}")

        missing_anchors = set(claim.source_anchor_refs) - anchors
        if missing_anchors:
            raise EvidenceClaimValidationError(
                f"source anchor does not resolve: {sorted(missing_anchors)}"
            )

        unknown_paths = [ref for ref in claim.graph_path_refs if ref not in known]
        if unknown_paths:
            raise EvidenceClaimValidationError(
                f"graph path ref does not resolve: {unknown_paths}"
            )

        if not 0 <= claim.confidence <= 1:
            raise EvidenceClaimValidationError("claim confidence out of range")
        if claim.claim_type in _CLOSED_CLAIM_TYPES and not claim.criterion:
            raise EvidenceClaimValidationError(
                "closed engineering claim requires a requiredEvidence criterion"
            )
        if claim.claim_type in _CLOSED_CLAIM_TYPES and claim.confidence <= 0:
            raise EvidenceClaimValidationError(
                "zero-confidence engineering claim cannot close a criterion"
            )

        if claim.claim_type in _CLOSED_CLAIM_TYPES:
            try:
                validate_claim_topology(
                    criterion=claim.criterion,
                    graph_path_refs=claim.graph_path_refs,
                    graph=value,
                    claim_value=claim.value,
                )
            except ClaimTopologyValidationError as error:
                raise EvidenceClaimValidationError(str(error)) from error

        selected = self._criterion_scoped_material_refs(claim, value)
        if claim.claim_type in _CLOSED_CLAIM_TYPES and not any(selected.values()):
            raise EvidenceClaimValidationError(
                "closed engineering claim requires criterion-aligned material production evidence"
            )

        return replace(
            claim,
            evidence_refs=selected["evidence"],
            graph_path_refs=selected["graph"],
            source_anchor_refs=selected["anchor"],
        )

    @classmethod
    def _criterion_scoped_material_refs(
        cls,
        claim: EvidenceClaim,
        graph: ProgramEvidenceGraph,
    ) -> dict[str, tuple[str, ...]]:
        node_by_id = {
            str(node.get("node_id")): node
            for node in graph.nodes
            if node.get("node_id")
        }
        edge_by_id = {
            str(edge.get("edge_id")): edge
            for edge in graph.edges
            if edge.get("edge_id")
        }
        anchor_by_id = {
            str(anchor.get("anchor_id")): anchor
            for anchor in graph.source_anchors
            if anchor.get("anchor_id")
        }
        evidence_to_nodes: dict[str, list[dict[str, Any]]] = {}
        evidence_to_edges: dict[str, list[dict[str, Any]]] = {}
        for node in graph.nodes:
            for ref in node.get("evidence_refs") or []:
                evidence_to_nodes.setdefault(str(ref), []).append(node)
        for edge in graph.edges:
            for ref in edge.get("evidence_refs") or []:
                evidence_to_edges.setdefault(str(ref), []).append(edge)

        criterion_name = str(claim.criterion or "").strip().upper()
        derived_tokens = cls._tokens(claim.criterion or "") - _GENERIC_CRITERION_TOKENS
        criterion_tokens = set(
            _CRITERION_EVIDENCE_TOKENS.get(criterion_name, frozenset(derived_tokens))
        )
        topology_kind = topology_criterion_kind(claim.criterion)
        candidates: list[tuple[int, int, str, str]] = []

        def add(kind: str, ref: str, rank: int) -> None:
            material, text = cls._reference_materiality(
                ref,
                node_by_id=node_by_id,
                edge_by_id=edge_by_id,
                anchor_by_id=anchor_by_id,
                evidence_to_nodes=evidence_to_nodes,
                evidence_to_edges=evidence_to_edges,
            )
            if not material:
                return
            score = len(criterion_tokens.intersection(cls._tokens(text)))
            candidates.append((score, rank, kind, ref))

        for ref in claim.source_anchor_refs:
            add("anchor", ref, 0)
        for ref in claim.graph_path_refs:
            add("graph", ref, 1)
        for ref in claim.evidence_refs:
            add("evidence", ref, 2)

        candidates.sort(key=lambda row: (-row[0], row[1], row[3]))
        positive = [row for row in candidates if row[0] > 0]
        fallback = [row for row in candidates if row[0] == 0]

        if topology_kind:
            # Topology validation already proved the structural relation. Preserve the
            # bounded material graph refs even when labels do not literally contain
            # criterion words such as "downstream" or "path"; lexical scoring is only
            # ranking here, not a second authority that can erase the proven path.
            graph_candidates = [row for row in candidates if row[2] == "graph"]
            chosen = graph_candidates[:_MAX_CLAIM_PROVENANCE_REFS]
            if len(chosen) < _MAX_CLAIM_PROVENANCE_REFS:
                chosen.extend(
                    row
                    for row in [*positive, *fallback]
                    if row not in chosen
                )
                chosen = chosen[:_MAX_CLAIM_PROVENANCE_REFS]
        elif criterion_tokens:
            chosen = positive[:_MAX_CLAIM_PROVENANCE_REFS]
        else:
            chosen = fallback[:2]

        result: dict[str, list[str]] = {"evidence": [], "graph": [], "anchor": []}
        for _, _, kind, ref in chosen:
            if ref not in result[kind]:
                result[kind].append(ref)
        return {key: tuple(value) for key, value in result.items()}

    @classmethod
    def _reference_materiality(
        cls,
        ref: str,
        *,
        node_by_id: dict[str, dict[str, Any]],
        edge_by_id: dict[str, dict[str, Any]],
        anchor_by_id: dict[str, dict[str, Any]],
        evidence_to_nodes: dict[str, list[dict[str, Any]]],
        evidence_to_edges: dict[str, list[dict[str, Any]]],
    ) -> tuple[bool, str]:
        nodes: list[dict[str, Any]] = []
        anchors: list[dict[str, Any]] = []
        evidence_edges: list[dict[str, Any]] = []
        edge = edge_by_id.get(ref)
        if ref in node_by_id:
            nodes.append(node_by_id[ref])
        if ref in anchor_by_id:
            anchor = anchor_by_id[ref]
            anchors.append(anchor)
            linked = node_by_id.get(str(anchor.get("graph_node_id") or ""))
            if linked:
                nodes.append(linked)
        if edge:
            evidence_edges.append(edge)
            for key in ("source_node_id", "target_node_id"):
                linked = node_by_id.get(str(edge.get(key) or ""))
                if linked:
                    nodes.append(linked)
        nodes.extend(evidence_to_nodes.get(ref, []))
        for evidence_edge in evidence_to_edges.get(ref, []):
            evidence_edges.append(evidence_edge)
            for key in ("source_node_id", "target_node_id"):
                linked = node_by_id.get(str(evidence_edge.get(key) or ""))
                if linked:
                    nodes.append(linked)

        paths = {
            str((node.get("source") or {}).get("file_path") or "")
            for node in nodes
            if (node.get("source") or {}).get("file_path")
        }
        paths.update(
            str(anchor.get("file_path") or "")
            for anchor in anchors
            if anchor.get("file_path")
        )
        roles = {source_role(path) for path in paths if path}
        if SOURCE_ROLE_TEST in roles and roles == {SOURCE_ROLE_TEST}:
            return False, ""
        if paths and SOURCE_ROLE_PRODUCTION not in roles:
            return False, ""

        node_types = {str(node.get("node_type") or "") for node in nodes}
        material = SOURCE_ROLE_PRODUCTION in roles or bool(
            node_types.intersection(_MATERIAL_RESOURCE_NODE_TYPES)
        )
        if not material:
            return False, ""

        # Criterion relevance must be derived from evidence VALUES only. Serializing
        # dictionaries with their field names caused generic keys such as `file_path`
        # and `metadata` to look like implementation evidence for media/mark controls.
        # Keep structural/materiality checks above, then rank only the concrete node,
        # source, semantic, attribute-value and edge-type values that the scanner saw.
        text_values: list[str] = []
        seen_nodes: set[str] = set()
        for node in nodes[:12]:
            node_id = str(node.get("node_id") or "")
            if node_id and node_id in seen_nodes:
                continue
            if node_id:
                seen_nodes.add(node_id)
            source = node.get("source") if isinstance(node.get("source"), dict) else {}
            text_values.extend(
                value
                for value in (
                    str(node.get("node_type") or ""),
                    str(node.get("label") or ""),
                    str(source.get("file_path") or ""),
                    str(source.get("symbol_ref") or ""),
                )
                if value
            )
            text_values.extend(
                str(value) for value in node.get("semantic_types") or [] if value
            )
            text_values.extend(cls._semantic_values(node.get("attributes") or {}))

        for anchor in anchors[:8]:
            text_values.extend(
                value
                for value in (
                    str(anchor.get("file_path") or ""),
                    str(anchor.get("symbol_ref") or ""),
                )
                if value
            )

        seen_edges: set[str] = set()
        for evidence_edge in evidence_edges[:12]:
            edge_id = str(evidence_edge.get("edge_id") or "")
            if edge_id and edge_id in seen_edges:
                continue
            if edge_id:
                seen_edges.add(edge_id)
            edge_type = str(evidence_edge.get("edge_type") or "")
            if edge_type:
                text_values.append(edge_type)
            text_values.extend(
                cls._semantic_values(evidence_edge.get("attributes") or {})
            )

        return True, " ".join(text_values)

    @classmethod
    def _semantic_values(cls, value: Any, *, depth: int = 4) -> list[str]:
        """Flatten bounded primitive values without leaking schema/key names into scoring."""
        if depth <= 0 or value is None:
            return []
        if isinstance(value, dict):
            result: list[str] = []
            for item in list(value.values())[:32]:
                result.extend(cls._semantic_values(item, depth=depth - 1))
            return result
        if isinstance(value, (list, tuple, set, frozenset)):
            result = []
            for item in list(value)[:32]:
                result.extend(cls._semantic_values(item, depth=depth - 1))
            return result
        if isinstance(value, (str, int, float, bool)):
            rendered = str(value).strip()
            return [rendered] if rendered else []
        return []

    @staticmethod
    def _tokens(value: str) -> set[str]:
        return {
            token.lower()
            for token in _TOKEN.findall(str(value).replace("_", " ").replace("-", " "))
            if len(token) > 2
        }
