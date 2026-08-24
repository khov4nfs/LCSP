"""Final fail-closed semantic normalization before Unified Graph persistence.

Earlier extractors intentionally favor recall. This pass prevents weak lexical findings
from being promoted into stronger graph semantics that Planner/Investigator may treat as
material evidence. It does not make legal conclusions; it only narrows technical node
identity to what static evidence actually supports.
"""
from __future__ import annotations

import re
from dataclasses import replace

from .semantic_ir import SemanticNodeFact, SemanticProgram

_TRUE_INFERENCE_FRAGMENTS = (
    "chat.completions.create",
    "completions.create",
    "responses.create",
    "messages.create",
    "embeddings.create",
    "generate_content",
    "generatecontent",
    "invoke_model",
    ".converse",
    ".predict",
    ".predict_proba",
    ".decision_function",
    ".forward",
    ".infer",
    ".classify",
    "ollama.chat",
    "ollama.generate",
    "ollama.embed",
)
_FALSE_INFERENCE_RE = re.compile(
    r"(?:^|[.$_])(?:sub|match|search|compile|replace|redact|sanitize|mask)(?:$|[($._])|"
    r"(?:key|token|secret|credential)[_ .-]?pattern",
    re.I,
)
_MUTATING_ACTION_RE = re.compile(
    r"(?:^|[.$_])(?:approve|accept|reject|deny|rank|recommend|update_status|set_status)(?:$|[($._])",
    re.I,
)
_SYNTHETIC_ACTION_TYPES = frozenset(
    {"APPROVAL", "REJECTION", "RANKING", "RECOMMENDATION", "STATUS_CHANGE"}
)

_FINDING_NODE_TYPES = {
    "AI_PROVIDER_USAGE": "AI_PROVIDER",
    "AI_FRAMEWORK_USAGE": "AI_SYSTEM",
    "AI_MODEL_INVOCATION": "AI_MODEL_INVOCATION",
    "AI_INPUT_SIGNAL": "AI_INPUT",
    "AI_OUTPUT_SIGNAL": "AI_OUTPUT",
    "AI_DECISION_FLOW_SIGNAL": "BUSINESS_ACTION",
    "AUTOMATED_DECISION_SIGNAL": "BUSINESS_ACTION",
    "HUMAN_REVIEW_SIGNAL": "HUMAN_REVIEW",
    "RANKING_SIGNAL": "RANKING",
    "RECOMMENDATION_SIGNAL": "RECOMMENDATION",
    "STATUS_UPDATE_SIGNAL": "STATUS_CHANGE",
    "USER_IMPACT_SIGNAL": "BUSINESS_ACTION",
    "SENSITIVE_DATA_SIGNAL": "SENSITIVE_DATA",
    "DOMAIN_CONTEXT_SIGNAL": "BUSINESS_ACTION",
    "HARM_POTENTIAL_SIGNAL": "BUSINESS_ACTION",
    "SYSTEM_PROMPT_DETECTED": "AI_CAPABILITY",
    "DYNAMIC_SYSTEM_PROMPT_REFERENCE": "AI_CAPABILITY",
    "RAG_USAGE_SIGNAL": "AI_CAPABILITY",
    "MODEL_OUTPUT_PARSER_SIGNAL": "PARSER",
    "DISPLAY_ONLY_SIGNAL": "BUSINESS_ACTION",
    "HUMAN_OVERSIGHT_CONTROL_SIGNAL": "HUMAN_REVIEW",
    "AI_INTERACTION_DISCLOSURE_SIGNAL": "BUSINESS_ACTION",
    "INCIDENT_HANDLING_SIGNAL": "BUSINESS_ACTION",
    "SCAN_COVERAGE_LIMITATION": "COVERAGE_GAP",
    "UNSUPPORTED_DYNAMIC_FLOW": "COVERAGE_GAP",
}

_SENSITIVE_CAPABILITY = {
    "SENSITIVE.BIOMETRIC": "BIOMETRIC_PROCESSING",
    "PII.GOVERNMENT_ID": "IDENTITY_DOCUMENT_PROCESSING",
}


class SemanticIntegrityFinalizer:
    """Suppress semantic escalation that is not supported by concrete static behavior."""

    def enrich(self, program: SemanticProgram) -> SemanticProgram:
        normalized = [self._normalize_finding_node(node) for node in program.nodes]

        # SemanticProgram deliberately allows duplicate facts for the same stable key.
        # ProgramGraphBuilder later unions semantic types and keeps the strongest node
        # resolution state. Therefore a weak inferred sensitive fact plus an unrelated
        # OBSERVED duplicate would otherwise become OBSERVED/CORROBORATED after merge.
        # Resolve trust at the stable key level before the builder sees those duplicates.
        strong_sensitive_keys = {
            node.key
            for node in normalized
            if self._has_strong_sensitive_capability(node)
        }
        weak_sensitive_keys = {
            node.key
            for node in normalized
            if self._has_high_impact_sensitive_semantic(node)
            and node.key not in strong_sensitive_keys
        }
        normalized = [
            (
                replace(node, resolution_state="INFERRED")
                if node.key in weak_sensitive_keys
                and node.resolution_state != "UNRESOLVED"
                else node
            )
            for node in normalized
        ]

        # A semantic key may have been emitted by more than one high-recall pass. Treat
        # the key as the unit of identity: once its concrete call shape is shown not to
        # be inference, every duplicate fact for that key must be prevented from winning
        # the builder's first-node-type merge semantics.
        false_ai_keys = {
            node.key
            for node in normalized
            if node.node_type == "AI_MODEL_INVOCATION" and not self._trusted_ai_invocation(node)
        }
        false_action_keys = {
            node.key
            for node in normalized
            if node.key.startswith("business:")
            and node.node_type in _SYNTHETIC_ACTION_TYPES
            and not self._trusted_business_mutation(node.label)
        }
        false_decision_keys = {
            node.key
            for node in normalized
            if node.node_type == "BUSINESS_DECISION"
            and str((node.attributes or {}).get("derivedFromAction") or "") in false_action_keys
        }
        removed_keys = {
            *false_action_keys,
            *false_decision_keys,
            *(f"ai-input:{key}" for key in false_ai_keys),
            *(f"ai-output:{key}" for key in false_ai_keys),
        }

        result_nodes: list[SemanticNodeFact] = []
        for node in normalized:
            if node.key in removed_keys:
                continue
            if node.key in false_ai_keys:
                attrs = dict(node.attributes or {})
                attrs.pop("provider", None)
                attrs["semanticSuppressedRole"] = "AI_MODEL_INVOCATION"
                attrs["semanticSuppressionReason"] = "NO_EXPLICIT_INFERENCE_OPERATION"
                result_nodes.append(
                    replace(
                        node,
                        node_type="CALL_SITE",
                        attributes=attrs,
                        resolution_state="OBSERVED",
                    )
                )
                continue
            result_nodes.append(node)

        result_edges = []
        for edge in program.edges:
            if edge.source_key in removed_keys or edge.target_key in removed_keys:
                continue
            if edge.source_key in false_ai_keys and edge.edge_type in {
                "SENDS_TO_AI",
                "RECEIVES_FROM_AI",
            }:
                continue
            if edge.target_key in false_ai_keys and edge.edge_type in {
                "SENDS_TO_AI",
                "RECEIVES_FROM_AI",
            }:
                continue
            result_edges.append(edge)

        program.nodes = result_nodes
        program.edges = result_edges
        program.unresolved_frontiers = [
            ref for ref in program.unresolved_frontiers if ref not in removed_keys
        ]
        return program

    @staticmethod
    def _normalize_finding_node(node: SemanticNodeFact) -> SemanticNodeFact:
        finding_type = str((node.attributes or {}).get("findingType") or "")
        node_type = _FINDING_NODE_TYPES.get(finding_type)
        if not node_type or node_type == node.node_type:
            return node
        attrs = dict(node.attributes or {})
        attrs["projectedFindingNodeType"] = node_type
        return replace(node, node_type=node_type, attributes=attrs)

    @staticmethod
    def _has_high_impact_sensitive_semantic(node: SemanticNodeFact) -> bool:
        semantics = set(node.semantic_types)
        return any(semantic in semantics for semantic in _SENSITIVE_CAPABILITY)

    @staticmethod
    def _has_strong_sensitive_capability(node: SemanticNodeFact) -> bool:
        if node.resolution_state != "CORROBORATED":
            return False
        semantics = set(node.semantic_types)
        required = {
            capability
            for semantic, capability in _SENSITIVE_CAPABILITY.items()
            if semantic in semantics
        }
        if not required:
            return False
        attrs = dict(node.attributes or {})
        capabilities = set(
            attrs.get("corroboratedCapabilities") or attrs.get("capabilities") or []
        )
        return required.issubset(capabilities)

    @staticmethod
    def _trusted_ai_invocation(node: SemanticNodeFact) -> bool:
        finding_type = str((node.attributes or {}).get("findingType") or "")
        if finding_type == "AI_MODEL_INVOCATION":
            return True
        label = str(node.label or "").strip().lower()
        if not label or _FALSE_INFERENCE_RE.search(label):
            return False
        return any(fragment in label for fragment in _TRUE_INFERENCE_FRAGMENTS)

    @staticmethod
    def _trusted_business_mutation(label: str) -> bool:
        return bool(_MUTATING_ACTION_RE.search(str(label or "")))
