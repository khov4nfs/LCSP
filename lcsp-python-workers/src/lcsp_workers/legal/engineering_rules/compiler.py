"""LLM compiler from approved legal rules to reusable engineering investigation rules."""
from __future__ import annotations
import json
from typing import Any
from lcsp_workers.llm.fallback_client import LLMClientProtocol
from lcsp_workers.scanner.program_graph.vocabulary import EDGE_TYPES, NODE_TYPES
from .models import ENGINEERING_RULE_SCHEMA_VERSION, EngineeringRule
from .validator import validate_engineering_rule
COMPILER_VERSION = "engineering-rule-compiler/1.0.0"; PROMPT_VERSION = "legal-to-engineering/v1"

class EngineeringRuleCompiler:
    def __init__(self, llm_client: LLMClientProtocol) -> None: self.llm = llm_client
    def compile(self, *, legal_rule: dict[str, Any], legal_rule_catalog_version_id: str, legal_corpus_version_id: str, legal_context: list[dict[str, Any]], source_fingerprint: str, workflow_run_id: str, correlation_id: str | None = None) -> list[EngineeringRule]:
        response = self.llm.complete(prompt=self._prompt(legal_rule, legal_context), workflow_run_id=workflow_run_id, node_name="compile_engineering_rules", max_tokens=6000, correlationId=correlation_id)
        payload = _json_object(response.content); rows = payload.get("engineeringRules")
        if not isinstance(rows, list) or not rows: raise ValueError("compiler returned no engineering rules")
        legal_rule_id = str(legal_rule.get("legalRuleId") or legal_rule.get("legal_rule_id") or ""); chunk_ids = [str(v.get("id")) for v in legal_context if v.get("id")]; locators = [str(v.get("locator")) for v in legal_context if v.get("locator")]
        result = []
        for index, raw in enumerate(rows, 1):
            if not isinstance(raw, dict): continue
            item = dict(raw); item.setdefault("engineeringRuleId", f"{legal_rule_id}::ENG::{index}"); item.update({"legalRuleId": legal_rule_id, "legalRuleCatalogVersionId": legal_rule_catalog_version_id, "legalCorpusVersionId": legal_corpus_version_id, "sourceChunkIds": chunk_ids, "sourceLocators": locators, "sourceFingerprint": source_fingerprint, "compilerModel": getattr(response, "model", "configured"), "compilerVersion": COMPILER_VERSION, "promptVersion": PROMPT_VERSION, "schemaVersion": ENGINEERING_RULE_SCHEMA_VERSION})
            result.append(validate_engineering_rule(EngineeringRule.from_dict(item)))
        if not result: raise ValueError("compiler produced no valid engineering rules")
        return result
    @staticmethod
    def _prompt(rule: dict[str, Any], context: list[dict[str, Any]]) -> str:
        contract = {"task": "Translate approved legal applicability logic into engineering evidence investigation rules.", "constraints": ["Do not decide compliance or risk level.", "Do not invent requirements outside supplied legal context.", "Keywords are discovery hints only, never proof.", "Split distinct technical controls into separate rules."], "nodeTypes": sorted(NODE_TYPES), "edgeTypes": sorted(EDGE_TYPES), "legalRule": rule, "legalContext": context, "output": {"engineeringRules": [{"engineeringRuleId": "stable id", "concept": "UPPER_SNAKE_CASE", "legalIntent": {}, "investigationGoals": [], "startingNodeTypes": [], "targetNodeTypes": [], "edgeStrategies": [], "graphQueries": [{"name": "query", "startNodeTypes": [], "direction": "FORWARD", "followEdges": [], "stopNodeTypes": [], "semanticTypes": []}], "keywords": [], "commonApis": [], "commonLibraries": [], "patterns": [], "requiredEvidence": [], "supportingEvidence": [], "negativeEvidence": [], "unresolvedConditions": []}]}}
        return "Return JSON only.\n" + json.dumps(contract, ensure_ascii=False, sort_keys=True)

def _json_object(text: str) -> dict[str, Any]:
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start: raise ValueError("compiler output is not JSON")
    value = json.loads(text[start:end + 1])
    if not isinstance(value, dict): raise ValueError("compiler output must be object")
    return value
