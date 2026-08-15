"""Produce bounded model-assisted classification proposals for later validation."""

import json
from typing import Any

from lcsp_workers.llm.gateway_client import LLMGatewayClient


ALLOWED_RISK_LEVELS = {"LOW", "MEDIUM", "HIGH", "BLOCKED"}
ALLOWED_APPLICABILITY = {"applicable", "partially_applicable", "not_applicable"}


class ModelAssistedClassificationProposer:
    """Ask an LLM for a structured proposal without granting final authority."""

    def __init__(self, llm_client: LLMGatewayClient):
        """Create the proposer with the gateway used for bounded LLM calls.

        Args:
            llm_client: Budget- and safety-aware LLM gateway client.
        """
        self.llm_client = llm_client

    def generate_proposal(
        self,
        usage_claims: list[dict[str, Any]],
        applicable_rules: list[dict[str, Any]],
        baseline_risk_level: str,
        baseline_applicability_assessment: str,
        workflow_run_id: str,
        node_name: str,
        correlationId: str | None = None,
    ) -> dict[str, Any] | None:
        """Generate and schema-check a model-assisted classification proposal.

        The deterministic baseline is included in the prompt and remains the
        fallback whenever the provider fails, returns invalid JSON, or proposes
        values outside the supported classification enums.

        Args:
            usage_claims: Sanitized AI-usage evidence supplied to the model.
            applicable_rules: Applicable legal-rule metadata supplied as evidence.
            baseline_risk_level: Deterministically computed risk level.
            baseline_applicability_assessment: Deterministic applicability result.
            workflow_run_id: Workflow identifier used for LLM usage tracking.
            node_name: Orchestration node issuing the request.
            correlationId: Optional end-to-end trace identifier.

        Returns:
            A validated proposal with the LLM request ID, or ``None`` when the
            proposal cannot be safely used.
        """
        prompt = f"""
        You are a classification proposal assistant.
        Return JSON only.

        BASELINE_DECISION:
        risk_level={baseline_risk_level}
        applicability_assessment={baseline_applicability_assessment}

        EVIDENCE:
        usage_claims={usage_claims}
        applicable_rules={applicable_rules}

        OUTPUT_SCHEMA:
        {{
          "risk_level": "LOW|MEDIUM|HIGH|BLOCKED",
          "applicability_assessment": "applicable|partially_applicable|not_applicable",
          "rationale": "2-3 sentence explanation without overclaiming"
        }}

        RULES:
        - Do not output markdown fences.
        - Do not invent citations or evidence.
        - Do not use overclaiming words such as certified, approved, compliant.
        - If the evidence is insufficient, keep the baseline blocked/degraded outcome.
        """

        try:
            response = self.llm_client.complete(
                prompt=prompt,
                workflow_run_id=workflow_run_id,
                node_name=node_name,
                max_tokens=256,
                correlationId=correlationId,
            )
        except Exception:
            return None

        try:
            proposal = json.loads(response.content)
        except json.JSONDecodeError:
            return None

        risk_level = proposal.get("risk_level")
        applicability = proposal.get("applicability_assessment")
        rationale = proposal.get("rationale")

        if risk_level not in ALLOWED_RISK_LEVELS:
            return None
        if applicability not in ALLOWED_APPLICABILITY:
            return None
        if rationale is not None and not isinstance(rationale, str):
            return None

        return {
            "risk_level": risk_level,
            "applicability_assessment": applicability,
            "rationale": rationale,
            "request_id": response.request_id,
        }
