"""Produce bounded model-assisted classification proposals for later validation."""

from typing import Any

from langchain.agents import create_agent

from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
from model_policy import INVESTIGATOR_MODEL_SPEC


ALLOWED_RISK_LEVELS = {"LOW", "MEDIUM", "HIGH", "BLOCKED"}
ALLOWED_APPLICABILITY = {"applicable", "partially_applicable", "not_applicable"}


class ModelAssistedClassificationProposer:
    """Ask an LLM for a structured proposal without granting final authority."""

    def __init__(self, model: str = INVESTIGATOR_MODEL_SPEC):
        """Create the proposer with a LangChain provider:model specification."""
        self._model = model

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
        Use the configured structured response format only.

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
        - Do not invent citations or evidence.
        - Do not use overclaiming words such as certified, approved, compliant.
        - If the evidence is insufficient, keep the baseline blocked/degraded outcome.
        """

        try:
            agent = create_agent(
                model=self._model,
                system_prompt=(
                    "You propose bounded classification fields only. Deterministic "
                    "LCSP evaluation remains authoritative."
                ),
                response_format=_classification_proposal_response_schema(),
                middleware=MODEL_GOVERNANCE_MIDDLEWARE,
                name="lcsp-classification-proposer",
            )
            result = agent.invoke(
                {"messages": [{"role": "user", "content": prompt}]},
                config={
                    "metadata": {
                        "workflow_run_id": workflow_run_id,
                        "node_name": node_name,
                        "correlationId": correlationId,
                    },
                    "configurable": {"thread_id": workflow_run_id},
                },
            )
        except Exception:
            return None

        proposal = result.get("structured_response")
        if not isinstance(proposal, dict):
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
            "request_id": None,
        }


def _classification_proposal_response_schema() -> dict[str, Any]:
    return {
        "title": "ClassificationProposalResponse",
        "description": "Bounded model-assisted classification proposal.",
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "risk_level": {
                "type": "string",
                "enum": sorted(ALLOWED_RISK_LEVELS),
            },
            "applicability_assessment": {
                "type": "string",
                "enum": sorted(ALLOWED_APPLICABILITY),
            },
            "rationale": {
                "type": "string",
                "description": "Two to three sentence explanation without overclaiming.",
            },
        },
        "required": [
            "risk_level",
            "applicability_assessment",
            "rationale",
        ],
    }
