"""Narrate an already-computed classification decision without changing it."""

from langchain.agents import create_agent

from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
from model_policy import INVESTIGATOR_MODEL_SPEC


class RationaleNarrator:
    """Use an LLM only to explain deterministic classification results."""

    def __init__(self, model: str = INVESTIGATOR_MODEL_SPEC):
        """Create a narrator backed by LangChain's standard agent runtime."""
        self._model = model

    def generate_rationale(
        self,
        usage_claims: list,
        applicable_rules: list,
        risk_level: str,
        applicability_assessment: str,
        workflow_run_id: str,
        node_name: str,
        correlationId: str | None = None,
    ) -> str | None:
        """Draft a human-readable explanation for an existing decision.

        The model is not permitted to decide the risk tier. The generated text
        is rejected when it obviously contradicts the precomputed decision, and
        any provider/safety/budget failure simply removes the optional narrative.

        Args:
            usage_claims: Sanitized usage evidence supporting the decision.
            applicable_rules: Legal-rule evidence supporting the decision.
            risk_level: Risk level already calculated by deterministic logic.
            applicability_assessment: Precomputed applicability result.
            workflow_run_id: Workflow identifier used for LLM telemetry/budgeting.
            node_name: Orchestration node requesting the narrative.
            correlationId: Optional end-to-end trace identifier.

        Returns:
            Narrative text when usable; otherwise ``None``.
        """
        prompt = f"""
        You are a legal rationale drafting assistant.
        Your task is to write a short narrative explaining the classification decision.

        DECISION CONTEXT:
        Risk Level: {risk_level}
        Applicability: {applicability_assessment}

        EVIDENCE:
        Usage Claims: {usage_claims}
        Applicable Rules: {applicable_rules}

        INSTRUCTIONS:
        - Write a 2-3 sentence narrative explaining why this risk level was assigned based on the evidence.
        - Do not contradict the assigned Risk Level or Applicability.
        - Do not use overclaiming words like 'certified', 'approved', 'compliant'.
        - Do not output raw source code.
        """

        try:
            agent = create_agent(
                model=self._model,
                system_prompt=(
                    "You explain an existing LCSP decision without changing it or "
                    "making legal conclusions."
                ),
                middleware=MODEL_GOVERNANCE_MIDDLEWARE,
                name="lcsp-classification-rationale-narrator",
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
            messages = result.get("messages") or []
            if not messages:
                return None
            content = getattr(messages[-1], "content", "")
            if not isinstance(content, str) or not content.strip():
                return None

            # Simple check if LLM contradicts the computed decision
            # (In a real system, you might use a more robust parser or specific formatting)
            lower_response = content.lower()
            if "low" in lower_response and risk_level != "LOW":
                # Very basic rejection if it contradicts
                return None
            if "high" in lower_response and risk_level != "HIGH":
                return None

            return content
        except Exception:
            # Rationale is optional; deterministic classification still proceeds.
            return None
