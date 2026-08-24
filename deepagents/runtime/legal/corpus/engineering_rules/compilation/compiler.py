"""LLM compiler from approved legal rules to reusable engineering investigation rules."""
from __future__ import annotations

import json
from typing import Any

from tools.common.llm.fallback_client import LLMClientProtocol
from tools.graph.scanner.program_graph.vocabulary import EDGE_TYPES, NODE_TYPES

from .chunk_triage import LegalChunkEngineeringRuleTriage
from .models import (
    ENGINEERING_RULE_SCHEMA_VERSION,
    EngineeringRule,
    build_legal_reasoning_contract,
)
from .validator import validate_engineering_rule


COMPILER_VERSION = "engineering-rule-compiler/1.0.0"
PROMPT_VERSION = "legal-to-engineering/v1"


class EngineeringRuleCompiler:
    def __init__(self, llm_client: LLMClientProtocol) -> None:
        self.llm = llm_client
        self.triage = LegalChunkEngineeringRuleTriage(llm_client)

    def compile(
        self,
        *,
        legal_rule: dict[str, Any],
        legal_rule_catalog_version_id: str,
        legal_corpus_version_id: str,
        legal_context: list[dict[str, Any]],
        source_fingerprint: str,
        workflow_run_id: str,
        correlation_id: str | None = None,
    ) -> list[EngineeringRule]:
        triage_decisions = self.triage.analyze(
            legal_rule=legal_rule,
            legal_context=legal_context,
            workflow_run_id=workflow_run_id,
            correlation_id=correlation_id,
        )
        compile_context = self.triage.select_engineering_rule_context(
            legal_context,
            triage_decisions,
        )
        if not compile_context:
            return []
        response = self.llm.complete_structured(
            prompt=self._prompt(legal_rule, compile_context),
            response_format=_engineering_rules_response_schema(),
            workflow_run_id=workflow_run_id,
            node_name="compile_engineering_rules",
            max_tokens=6000,
            correlationId=correlation_id,
        )
        payload = response.structured_response
        if not isinstance(payload, dict):
            raise ValueError("compiler structured response must be object")
        rows = payload.get("engineeringRules")
        if not isinstance(rows, list) or not rows:
            return []
        legal_rule_id = str(
            legal_rule.get("legalRuleId") or legal_rule.get("legal_rule_id") or ""
        )
        chunk_ids = [str(v.get("id")) for v in compile_context if v.get("id")]
        locators = [
            str(v.get("locator")) for v in compile_context if v.get("locator")
        ]
        result = []
        for index, raw in enumerate(rows, 1):
            if not isinstance(raw, dict):
                continue
            item = dict(raw)
            item.setdefault("engineeringRuleId", f"{legal_rule_id}::ENG::{index}")
            required_evidence = tuple(
                str(value) for value in item.get("requiredEvidence") or [] if str(value)
            )
            supporting_evidence = tuple(
                str(value)
                for value in item.get("supportingEvidence") or []
                if str(value)
            )
            negative_evidence = tuple(
                str(value) for value in item.get("negativeEvidence") or [] if str(value)
            )
            item.update(
                {
                    "legalRuleId": legal_rule_id,
                    "legalRuleCatalogVersionId": legal_rule_catalog_version_id,
                    "legalCorpusVersionId": legal_corpus_version_id,
                    "sourceChunkIds": chunk_ids,
                    "sourceLocators": locators,
                    "legalReasoningContract": build_legal_reasoning_contract(
                        legal_rule=legal_rule,
                        legal_rule_catalog_version_id=legal_rule_catalog_version_id,
                        legal_corpus_version_id=legal_corpus_version_id,
                        legal_context=compile_context,
                        required_evidence=required_evidence,
                        supporting_evidence=supporting_evidence,
                        negative_evidence=negative_evidence,
                    ),
                    "sourceFingerprint": source_fingerprint,
                    "compilerModel": getattr(response, "model", "configured"),
                    "compilerVersion": COMPILER_VERSION,
                    "promptVersion": PROMPT_VERSION,
                    "schemaVersion": ENGINEERING_RULE_SCHEMA_VERSION,
                }
            )
            result.append(validate_engineering_rule(EngineeringRule.from_dict(item)))
        return result

    @staticmethod
    def _prompt(rule: dict[str, Any], context: list[dict[str, Any]]) -> str:
        contract = {
            "task": (
                "Translate approved legal applicability logic into engineering "
                "evidence investigation rules."
            ),
            "constraints": [
                "Do not decide compliance or risk level.",
                "Do not invent requirements outside supplied legal context.",
                "Keywords are discovery hints only, never proof.",
                "Split distinct technical controls into separate rules.",
            ],
            "nodeTypes": sorted(NODE_TYPES),
            "edgeTypes": sorted(EDGE_TYPES),
            "legalRule": rule,
            "legalContext": context,
            "output": {
                "engineeringRules": [
                    {
                        "engineeringRuleId": "stable id",
                        "concept": "UPPER_SNAKE_CASE",
                        "legalIntent": {},
                        "investigationGoals": [],
                        "startingNodeTypes": [],
                        "targetNodeTypes": [],
                        "edgeStrategies": [],
                        "graphQueries": [
                            {
                                "name": "query",
                                "startNodeTypes": [],
                                "direction": "FORWARD",
                                "followEdges": [],
                                "stopNodeTypes": [],
                                "semanticTypes": [],
                            }
                        ],
                        "keywords": [],
                        "commonApis": [],
                        "commonLibraries": [],
                        "patterns": [],
                        "requiredEvidence": [],
                        "supportingEvidence": [],
                        "negativeEvidence": [],
                        "unresolvedConditions": [],
                    }
                ]
            },
        }
        return "Use the configured structured response format only.\n" + json.dumps(
            contract,
            ensure_ascii=False,
            sort_keys=True,
        )


def _engineering_rules_response_schema() -> dict[str, Any]:
    string_array_schema = {"type": "array", "items": {"type": "string"}}
    graph_query_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "name": {"type": "string"},
            "startNodeTypes": string_array_schema,
            "direction": {
                "type": "string",
                "enum": ["FORWARD", "BACKWARD", "BIDIRECTIONAL"],
            },
            "followEdges": string_array_schema,
            "stopNodeTypes": string_array_schema,
            "semanticTypes": string_array_schema,
        },
        "required": [
            "name",
            "startNodeTypes",
            "direction",
            "followEdges",
            "stopNodeTypes",
            "semanticTypes",
        ],
    }
    engineering_rule_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "engineeringRuleId": {"type": "string"},
            "concept": {"type": "string"},
            "legalIntent": {"type": "object", "additionalProperties": True},
            "investigationGoals": string_array_schema,
            "startingNodeTypes": string_array_schema,
            "targetNodeTypes": string_array_schema,
            "edgeStrategies": string_array_schema,
            "graphQueries": {"type": "array", "items": graph_query_schema},
            "keywords": string_array_schema,
            "commonApis": string_array_schema,
            "commonLibraries": string_array_schema,
            "patterns": string_array_schema,
            "requiredEvidence": string_array_schema,
            "supportingEvidence": string_array_schema,
            "negativeEvidence": string_array_schema,
            "unresolvedConditions": string_array_schema,
        },
        "required": [
            "concept",
            "legalIntent",
            "investigationGoals",
            "startingNodeTypes",
            "targetNodeTypes",
            "edgeStrategies",
            "graphQueries",
            "keywords",
            "commonApis",
            "commonLibraries",
            "patterns",
            "requiredEvidence",
            "supportingEvidence",
            "negativeEvidence",
            "unresolvedConditions",
        ],
    }
    return {
        "title": "EngineeringRulesResponse",
        "description": "Reusable engineering investigation rules derived from legal context.",
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "engineeringRules": {
                "type": "array",
                "items": engineering_rule_schema,
            }
        },
        "required": ["engineeringRules"],
    }
