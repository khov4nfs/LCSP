from lcsp_workers.llm.gateway_client import LLMGatewayClient

class RationaleNarrator:
    def __init__(self, llm_client: LLMGatewayClient):
        self.llm_client = llm_client

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
        """
        Draft a human-readable rationale using LLM.
        Must NOT contain raw source code in the prompt.
        Must narrate the already-computed decision, NOT decide.
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
            response = self.llm_client.complete(
                prompt=prompt,
                workflow_run_id=workflow_run_id,
                node_name=node_name,
                max_tokens=256,
                correlationId=correlationId,
            )
            
            # Simple check if LLM contradicts the computed decision
            # (In a real system, you might use a more robust parser or specific formatting)
            lower_response = response.content.lower()
            if "low" in lower_response and risk_level != "LOW":
                # Very basic rejection if it contradicts
                return None
            if "high" in lower_response and risk_level != "HIGH":
                return None
                
            return response.content
        except Exception:
            # BudgetExceeded or PromptSafetyViolation
            # Rationale is optional, so we return None and proceed
            return None
