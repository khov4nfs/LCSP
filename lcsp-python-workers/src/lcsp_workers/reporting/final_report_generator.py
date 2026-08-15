"""Generate final assessment Markdown with an LLM-assisted executive summary."""

from lcsp_workers.llm.gateway_client import LLMGatewayClient


class FinalReportGenerator:
    """Render the report body deterministically and delegate summary narration to LLM."""

    def __init__(self, llm_client: LLMGatewayClient):
        """Create the generator with the required safety-aware LLM client."""
        self.llm_client = llm_client

    def generate(
        self,
        assessment_name: str,
        assessment_context: str,
        technical_evidence: list,
        verified_ai_usage: list,
        legal_rule_applicability: list,
        citations: list,
        limitations: str,
        evidence_provenance: str
    ) -> str:
        """Generate the complete Final Report Markdown document.

        Only the executive-summary narrative is model-generated; all evidence,
        legal applicability, citations, limitations, and provenance sections are
        rendered from structured inputs supplied by the caller.

        Args:
            assessment_name: Assessment display name.
            assessment_context: Structured AI-system/business context.
            technical_evidence: Evidence summary entries.
            verified_ai_usage: Verified AI usage claims.
            legal_rule_applicability: Applicable legal-rule summaries.
            citations: Legal/evidence references to display.
            limitations: Known assessment limitations and uncertainty.
            evidence_provenance: Evidence-chain provenance statement.

        Returns:
            Final report as Markdown.
        """
        # 1. Generate Executive Summary using LLM
        # No raw source code should be passed here, only structured metadata.
        executive_summary = self._generate_executive_summary(
            assessment_name, assessment_context, verified_ai_usage, legal_rule_applicability
        )

        # Build document structure
        content = [
            f"# Title: AI System Compliance Assessment Report — {assessment_name}",
            "**Label: Final submission artifact**\n",
            "## 1. Executive Summary",
            f"{executive_summary}\n",
            "## 2. AI System Description",
            f"{assessment_context}\n",
            "## 3. Technical Evidence Summary"
        ]

        # Section 3: Technical
        if not technical_evidence:
            content.append("No technical evidence provided.")
        else:
            for ev in technical_evidence:
                content.append(f"- {ev}")
        content.append("")

        # Section 4: Verified AI Usage
        content.append("## 4. Verified AI Usage")
        if not verified_ai_usage:
            content.append("No AI usage claims verified.")
        else:
            for claim in verified_ai_usage:
                content.append(f"- {claim}")
        content.append("")

        # Section 5: Legal Rule Applicability Analysis
        content.append("## 5. Legal Rule Applicability Analysis")
        if not legal_rule_applicability:
            content.append("No applicable legal rules.")
        else:
            for rule in legal_rule_applicability:
                content.append(f"- {rule}")
        content.append("")

        # Section 6: Citations and Legal References
        content.append("## 6. Citations and Legal References")
        if not citations:
            content.append("No citations provided.")
        else:
            for citation in citations:
                content.append(f"- {citation}")
        content.append("")

        # Section 7: Assessment Limitations and Uncertainty
        content.append("## 7. Assessment Limitations and Uncertainty")
        content.append(limitations if limitations else "None identified.")
        content.append("")

        # Section 8: Appendix: Evidence Provenance
        content.append("## 8. Appendix: Evidence Provenance")
        content.append(evidence_provenance if evidence_provenance else "No provenance information provided.")

        return "\n".join(content)

    def _generate_executive_summary(
        self,
        assessment_name: str,
        context: str,
        usage: list,
        rules: list
    ) -> str:
        """Narrate structured findings without sending raw source code to the model.

        LLM safety/budget/provider failures are intentionally allowed to propagate
        so the consumer can mark final-report generation as failed instead of
        silently publishing a partially generated final artifact.
        """
        prompt = f"""
        You are a compliance reporting assistant.
        Draft a 3-4 sentence Executive Summary for the following AI Assessment.

        ASSESSMENT NAME: {assessment_name}
        CONTEXT: {context}
        VERIFIED USAGE: {usage}
        APPLICABLE RULES: {rules}

        INSTRUCTIONS:
        - Summarize the assessment's key findings.
        - Do not state that the system is 'certified', 'compliant', 'approved', or 'production ready'.
        - Do not include any raw source code.
        """

        # LLM can throw BudgetExceeded or PromptSafetyViolation.
        # These will be caught by the Consumer.
        response = self.llm_client.complete(
            prompt=prompt,
            max_tokens=300
        )
        return response.content
