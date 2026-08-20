"""Promote high-impact sensitive semantics only from bounded data-lineage paths.

Identifier/contract taxonomy remains a weak seed. A field named ``fingerprint`` or
``document_id`` is not trusted sensitive evidence by itself, and lexical co-occurrence in
the same file is not corroboration. Promotion requires one connected lineage path whose
processing operations establish the semantic capability.
"""
from __future__ import annotations

import re
from collections import deque
from dataclasses import replace
from pathlib import Path

from .semantic_ir import SemanticNodeFact, SemanticProgram

_VISUAL_BIOMETRIC = re.compile(
    r"face[_ .-]?(?:detect|recogn|encod|embed|feature)|rekognition|facenet|deepface|insightface",
    re.I,
)
_BIOMETRIC_REPRESENTATION = re.compile(
    r"embedding|encoding|feature[_ .-]?(?:vector|extract)|template",
    re.I,
)
_IDENTITY_MATCH = re.compile(
    r"(?:^|[._ -])(?:compare|similarity|verify|verification|match|identify|recognize)(?:$|[._ -])",
    re.I,
)
# Modality words alone are ambiguous (software/config fingerprints are common). Require
# an adjacent biometric-processing operation before the modality contributes a strong
# path signal.
_NON_VISUAL_BIOMETRIC = re.compile(
    r"finger(?:print)?[_ .-]?(?:scan|template|match|verify|recogn|feature|extract)|"
    r"voiceprint[_ .-]?(?:match|verify|recogn|template|feature|extract)|"
    r"speaker[_ .-]?(?:embed|verify|recogn)|"
    r"iris[_ .-]?(?:scan|match|verify|recogn|template)|"
    r"retina[_ .-]?(?:scan|match|verify|recogn|template)|"
    r"palm[_ .-]?(?:print|scan|match|verify|recogn|template)",
    re.I,
)
_OCR = re.compile(
    r"(?:^|[._ -])(?:ocr|tesseract|textract|document[_ .-]?ai|vision[_ .-]?text)(?:$|[._ -])",
    re.I,
)
_ID_DOCUMENT = re.compile(
    r"kyc|identity[_ .-]?(?:document|verification)|government[_ .-]?id|national[_ .-]?id|"
    r"passport|mrz|citizen[_ .-]?id|id[_ .-]?card",
    re.I,
)

_DATA_CARRIER_TYPES = frozenset(
    {
        "PARAMETER",
        "RETURN_VALUE",
        "VARIABLE",
        "PROPERTY",
        "DTO_FIELD",
        "DATA_OBJECT",
        "DATA_ASSET",
        "MEDIA_OBJECT",
        "AI_INPUT",
        "AI_OUTPUT",
    }
)
_LINEAGE_EDGES = frozenset(
    {
        "FLOWS_TO",
        "PASSES_ARGUMENT",
        "RECEIVES_RETURN",
        "ASSIGNS",
        "ALIASES",
        "READS_PROPERTY",
        "WRITES_PROPERTY",
        "MAPS_TO",
        "PARSES",
        "SERIALIZES",
        "DESERIALIZES",
        "TRANSFORMS",
        "DERIVES_FROM",
        "ENCODES",
        "DECODES",
        "CARRIES_DATA",
        "DECLARES_DATA",
        "READS_FROM",
        "LOADS_FROM",
        "WRITES_TO",
        "PERSISTS_TO",
        "SENDS_TO_EXTERNAL",
        "RECEIVES_FROM_EXTERNAL",
        "SENDS_TO_AI",
        "RECEIVES_FROM_AI",
    }
)
_MAX_HOPS = 12


class SensitiveLineageGate:
    """Keep taxonomy hints inferred and promote only path-corroborated data."""

    def __init__(self, workspace_path: str | Path) -> None:
        self.workspace = Path(workspace_path).resolve(strict=False)

    def enrich(self, program: SemanticProgram) -> SemanticProgram:
        node_by_key = {node.key: node for node in program.nodes}
        forward: dict[str, set[str]] = {}
        reverse: dict[str, set[str]] = {}
        for edge in program.edges:
            if edge.edge_type not in _LINEAGE_EDGES:
                continue
            if edge.source_key not in node_by_key or edge.target_key not in node_by_key:
                continue
            forward.setdefault(edge.source_key, set()).add(edge.target_key)
            reverse.setdefault(edge.target_key, set()).add(edge.source_key)

        replacements: list[SemanticNodeFact] = []
        for node in program.nodes:
            if node.node_type not in _DATA_CARRIER_TYPES:
                replacements.append(node)
                continue

            semantics = set(node.semantic_types)
            biometric = self._path_supports(
                node.key,
                node_by_key=node_by_key,
                forward=forward,
                reverse=reverse,
                capability="BIOMETRIC_PROCESSING",
            )
            identity_document = self._path_supports(
                node.key,
                node_by_key=node_by_key,
                forward=forward,
                reverse=reverse,
                capability="IDENTITY_DOCUMENT_PROCESSING",
            )

            if biometric:
                semantics.add("SENSITIVE.BIOMETRIC")
            if identity_document:
                semantics.add("PII.GOVERNMENT_ID")

            attrs = dict(node.attributes or {})
            attrs.pop("corroboratedCapabilities", None)
            existing_capabilities = {
                str(value) for value in attrs.get("capabilities") or [] if value
            }
            existing_capabilities.difference_update(
                {"BIOMETRIC_PROCESSING", "IDENTITY_DOCUMENT_PROCESSING"}
            )
            if existing_capabilities:
                attrs["capabilities"] = sorted(existing_capabilities)
            else:
                attrs.pop("capabilities", None)

            corroborated = []
            if biometric:
                corroborated.append("BIOMETRIC_PROCESSING")
            if identity_document:
                corroborated.append("IDENTITY_DOCUMENT_PROCESSING")
            if corroborated:
                attrs["corroboratedCapabilities"] = corroborated

            high_impact_present = bool(
                semantics.intersection({"SENSITIVE.BIOMETRIC", "PII.GOVERNMENT_ID"})
            )
            if corroborated:
                resolution = "CORROBORATED"
            elif high_impact_present and node.resolution_state != "UNRESOLVED":
                resolution = "INFERRED"
            else:
                resolution = node.resolution_state

            replacements.append(
                node
                if (
                    tuple(sorted(semantics)) == tuple(sorted(node.semantic_types))
                    and attrs == node.attributes
                    and resolution == node.resolution_state
                )
                else replace(
                    node,
                    semantic_types=tuple(sorted(semantics)),
                    attributes=attrs,
                    resolution_state=resolution,
                )
            )

        program.nodes = replacements
        return program

    @classmethod
    def _path_supports(
        cls,
        start: str,
        *,
        node_by_key: dict[str, SemanticNodeFact],
        forward: dict[str, set[str]],
        reverse: dict[str, set[str]],
        capability: str,
    ) -> bool:
        return cls._walk_has_capability(
            start,
            node_by_key=node_by_key,
            adjacency=forward,
            capability=capability,
        ) or cls._walk_has_capability(
            start,
            node_by_key=node_by_key,
            adjacency=reverse,
            capability=capability,
        )

    @classmethod
    def _walk_has_capability(
        cls,
        start: str,
        *,
        node_by_key: dict[str, SemanticNodeFact],
        adjacency: dict[str, set[str]],
        capability: str,
    ) -> bool:
        initial = cls._signals(node_by_key.get(start))
        queue = deque([(start, 0, initial)])
        seen: set[tuple[str, tuple[str, ...]]] = set()
        while queue:
            current, depth, signals = queue.popleft()
            state = (current, tuple(sorted(signals)))
            if state in seen:
                continue
            seen.add(state)
            if cls._satisfies(signals, capability):
                return True
            if depth >= _MAX_HOPS:
                continue
            for nxt in sorted(adjacency.get(current, set())):
                node = node_by_key.get(nxt)
                if node is None:
                    continue
                queue.append((nxt, depth + 1, signals | cls._signals(node)))
        return False

    @staticmethod
    def _signals(node: SemanticNodeFact | None) -> set[str]:
        if node is None:
            return set()
        # Never use previously inferred sensitive semantic types or prior
        # corroboratedCapabilities as proof of themselves. Those values may have come
        # from a high-recall/file-level pass. Only concrete symbol/operation identity on
        # the connected lineage path may contribute corroborating behavior here.
        text = " ".join(
            [
                str(node.label or ""),
                str(node.symbol_ref or ""),
            ]
        )
        result: set[str] = set()
        if _VISUAL_BIOMETRIC.search(text):
            result.add("VISUAL_BIOMETRIC")
        if _NON_VISUAL_BIOMETRIC.search(text):
            result.add("NON_VISUAL_BIOMETRIC")
        if _BIOMETRIC_REPRESENTATION.search(text):
            result.add("BIOMETRIC_REPRESENTATION")
        if _IDENTITY_MATCH.search(text):
            result.add("IDENTITY_MATCH")
        if _OCR.search(text):
            result.add("OCR")
        if _ID_DOCUMENT.search(text):
            result.add("IDENTITY_DOCUMENT")
        return result

    @staticmethod
    def _satisfies(signals: set[str], capability: str) -> bool:
        if capability == "BIOMETRIC_PROCESSING":
            visual = {
                "VISUAL_BIOMETRIC",
                "BIOMETRIC_REPRESENTATION",
                "IDENTITY_MATCH",
            }.issubset(signals)
            non_visual = "NON_VISUAL_BIOMETRIC" in signals and bool(
                signals.intersection({"BIOMETRIC_REPRESENTATION", "IDENTITY_MATCH"})
            )
            return visual or non_visual
        if capability == "IDENTITY_DOCUMENT_PROCESSING":
            return {"OCR", "IDENTITY_DOCUMENT"}.issubset(signals)
        return False
