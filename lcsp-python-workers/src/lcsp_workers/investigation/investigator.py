"""LLM semantic synthesis over deterministic law-guided graph packets."""
from __future__ import annotations
import hashlib, json
from typing import Any
from lcsp_workers.llm.fallback_client import LLMClientProtocol
from .evidence_claim_validator import EvidenceClaimValidator
from .models import EvidenceClaim, InvestigationPacket

class LawGuidedInvestigator:
    def __init__(self, llm_client: LLMClientProtocol) -> None: self.llm = llm_client; self.validator = EvidenceClaimValidator()
    def investigate(self, *, packet: InvestigationPacket, graph, workflow_run_id: str, correlation_id: str | None = None) -> list[EvidenceClaim]:
        body = {"task": "Synthesize engineering facts only. Never decide compliance, violation or risk tier.", "engineeringRuleId": packet.engineering_rule_id, "concept": packet.concept, "goals": packet.investigation_goals, "initialGraphResults": packet.initial_results, "unresolvedFrontiers": packet.unresolved_frontiers, "wizardContext": packet.wizard_context, "output": {"claims": [{"claimType": "UPPER_SNAKE_CASE", "value": True, "evidenceRefs": [], "graphPathRefs": [], "sourceAnchorRefs": [], "confidence": 0.0, "limitations": []}]}}
        response = self.llm.complete(prompt="Return JSON only. Every non-unknown claim requires evidenceRefs from the supplied graph packet.\n" + json.dumps(body, ensure_ascii=False, sort_keys=True), workflow_run_id=workflow_run_id, node_name="investigate_engineering_rule", max_tokens=5000, correlationId=correlation_id)
        payload = _json(response.content); rows = payload.get("claims")
        if not isinstance(rows, list): raise ValueError("investigator response must contain claims")
        result = []
        for index, item in enumerate(rows, 1):
            if not isinstance(item, dict): continue
            refs = tuple(str(v) for v in item.get("evidenceRefs") or [] if str(v)); seed = f"{packet.engineering_rule_id}:{index}:{item.get('claimType')}:{refs}"
            claim = EvidenceClaim("claim:" + hashlib.sha256(seed.encode()).hexdigest()[:24], packet.engineering_rule_id, str(item.get("claimType") or "UNRESOLVED_ENGINEERING_FACT"), item.get("value"), refs, tuple(str(v) for v in item.get("graphPathRefs") or [] if str(v)), tuple(str(v) for v in item.get("sourceAnchorRefs") or [] if str(v)), float(item.get("confidence") or 0), tuple(str(v) for v in item.get("limitations") or [] if str(v)))
            result.append(self.validator.validate(claim, graph))
        return result

def _json(text: str) -> dict[str, Any]:
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start: raise ValueError("investigator output is not JSON")
    value = json.loads(text[start:end + 1])
    if not isinstance(value, dict): raise ValueError("investigator output must be object")
    return value
