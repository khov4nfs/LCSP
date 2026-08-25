"""Normalize AI invocation semantics before lineage materialization.

Provider/framework presence is useful repository evidence, but it is not proof that a
specific call executes model inference. The base scanner intentionally favors recall;
this gate restores the stronger semantic contract required by Unified Graph v3:
``AI_MODEL_INVOCATION`` means an invocation-shaped operation, not any symbol containing
an AI provider name.
"""
from __future__ import annotations

import re
from dataclasses import replace

from tools.common.capabilities.evidence.graph.schema.semantic_ir import SemanticNodeFact, SemanticProgram


_INVOCATION_RE = re.compile(
    r"(?:"
    r"(?:chat\.)?completions?\.create|responses?\.create|messages?\.create|"
    r"embeddings?\.create|generate[_ .-]?content|generatecontent|invoke[_ .-]?model|"
    r"\bconverse(?:_stream)?\b|\.predict(?:_proba)?$|\.infer(?:ence)?$|"
    r"\.generate$|\.classify$|\.score$|\.forward$|\.embed(?:dings?)?$|"
    r"pipeline$|model\.__call__$"
    r")",
    re.I,
)
_PROVIDER_CLIENT_RE = re.compile(
    r"(?:^|\.)(?:OpenAI|AzureOpenAI|Anthropic|Client|AsyncClient|InferenceClient|"
    r"GenerativeModel|ChatOpenAI|ChatAnthropic)$",
    re.I,
)
_CONFIGURATION_RE = re.compile(
    r"(?:config|configuration|settings|options|generationconfig|generatecontentconfig|"
    r"safetysettings|key[_ .-]?pattern|api[_ .-]?key|token[_ .-]?pattern)",
    re.I,
)
_NON_INVOCATION_SUFFIX_RE = re.compile(
    r"\.(?:sub|search|match|compile|replace|split|join|format|encode|decode|"
    r"getenv|loads|dumps|parse|validate)$",
    re.I,
)

_FINDING_ROLE_NODE_TYPES = {
    "AI_PROVIDER_USAGE": "SDK_CLIENT",
    "AI_FRAMEWORK_USAGE": "SDK_CLIENT",
    "AI_INPUT_SIGNAL": "DATA_OBJECT",
    "AI_OUTPUT_SIGNAL": "DATA_OBJECT",
    "AI_DECISION_FLOW_SIGNAL": "CALL_SITE",
    "AUTOMATED_DECISION_SIGNAL": "BUSINESS_ACTION",
    "HUMAN_REVIEW_SIGNAL": "HUMAN_REVIEW",
    "RANKING_SIGNAL": "RANKING",
    "RECOMMENDATION_SIGNAL": "RECOMMENDATION",
    "STATUS_UPDATE_SIGNAL": "STATUS_CHANGE",
    "SENSITIVE_DATA_SIGNAL": "SENSITIVE_DATA",
}


class AIInvocationSemanticGate:
    """Demote recall-oriented AI hits that do not prove model execution."""

    def enrich(self, program: SemanticProgram) -> SemanticProgram:
        hardened: list[SemanticNodeFact] = []
        for node in program.nodes:
            attrs = dict(node.attributes or {})
            finding_type = str(attrs.get("findingType") or "")

            if finding_type and finding_type != "AI_MODEL_INVOCATION":
                requested = _FINDING_ROLE_NODE_TYPES.get(finding_type)
                if node.node_type == "AI_MODEL_INVOCATION" and requested:
                    attrs["semanticRole"] = finding_type
                    hardened.append(
                        replace(
                            node,
                            node_type=requested,
                            attributes=attrs,
                            resolution_state="OBSERVED",
                        )
                    )
                    continue

            if node.node_type != "AI_MODEL_INVOCATION":
                hardened.append(node)
                continue

            label = str(node.label or "").strip()
            if finding_type == "AI_MODEL_INVOCATION" or self._is_invocation(label):
                attrs["invocationSemantics"] = "MODEL_EXECUTION"
                hardened.append(
                    node
                    if attrs == node.attributes
                    else replace(node, attributes=attrs)
                )
                continue

            if _PROVIDER_CLIENT_RE.search(label):
                target_type = "SDK_CLIENT"
                role = "PROVIDER_CLIENT"
            else:
                target_type = "CALL_SITE"
                role = (
                    "PROVIDER_CONFIGURATION"
                    if _CONFIGURATION_RE.search(label)
                    else "PROVIDER_REFERENCE"
                )
            attrs["semanticRole"] = role
            attrs["demotedFrom"] = "AI_MODEL_INVOCATION"
            hardened.append(
                replace(
                    node,
                    node_type=target_type,
                    attributes=attrs,
                    resolution_state="OBSERVED",
                )
            )

        program.nodes = hardened
        return program

    @staticmethod
    def _is_invocation(label: str) -> bool:
        normalized = label.strip()
        if not normalized or _NON_INVOCATION_SUFFIX_RE.search(normalized):
            return False
        return bool(_INVOCATION_RE.search(normalized))
