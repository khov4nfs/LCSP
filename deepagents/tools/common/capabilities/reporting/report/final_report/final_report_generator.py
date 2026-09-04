"""Generate final assessment Markdown from direct EngineeringRule results."""

from langchain.agents import create_agent

from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
from model_policy import INVESTIGATOR_MODEL_SPEC


class FinalReportGenerator:
    """Render evidence deterministically and use LLM only for bounded narration."""

    def __init__(self, model: str = INVESTIGATOR_MODEL_SPEC):
        self._model = model

    def generate(
        self,
        assessment_name: str,
        assessment_context: str,
        technical_evidence: list,
        rule_evaluations: list | None = None,
        citations: list | None = None,
        limitations: str = "",
        evidence_provenance: str = "",
        workflow_run_id: str = "final-report:local",
        node_name: str = "final_report.executive_summary",
        correlationId: str | None = None,
        **legacy,
    ) -> str:
        # Temporary call compatibility for historical tests/consumers while the
        # runtime itself no longer creates VerifiedProfile/LegalRuleMatch artifacts.
        if rule_evaluations is None:
            rule_evaluations = legacy.get("legal_rule_applicability") or []
        citations = citations or []

        executive_summary = self._generate_executive_summary(
            assessment_name,
            assessment_context,
            rule_evaluations,
            workflow_run_id=workflow_run_id,
            node_name=node_name,
            correlationId=correlationId,
        )

        content = [
            f"# AI Engineering Control Assessment Report — {assessment_name}",
            "**Basis: pinned repository evidence + EngineeringRule evaluations**\n",
            "## 1. Executive Summary",
            f"{executive_summary}\n",
            "## 2. Assessment Context",
            f"{assessment_context}\n",
            "## 3. Repository Evidence",
        ]

        if not technical_evidence:
            content.append("No repository evidence provided.")
        else:
            for evidence in technical_evidence:
                content.append(f"- {evidence}")
        content.append("")

        content.append("## 4. EngineeringRule Evaluations")
        if not rule_evaluations:
            content.append("No EngineeringRule evaluations were produced.")
        else:
            for evaluation in rule_evaluations:
                content.append(f"- {evaluation}")
        content.append("")

        content.append("## 5. Legal Source and Evidence References")
        if not citations:
            content.append("No references provided.")
        else:
            for citation in citations:
                content.append(f"- {citation}")
        content.append("")

        content.append("## 6. Assessment Limitations and Uncertainty")
        content.append(limitations if limitations else "No known limitations recorded.")
        content.append("")

        content.append("## 7. Appendix: Evidence Provenance")
        content.append(
            evidence_provenance
            if evidence_provenance
            else "No provenance information provided."
        )

        return "\n".join(content)

    def _generate_executive_summary(
        self,
        assessment_name: str,
        context: str,
        rule_evaluations: list,
        *,
        workflow_run_id: str,
        node_name: str,
        correlationId: str | None,
    ) -> str:
        prompt = f"""
        You are an engineering assessment reporting assistant.
        Draft a 3-4 sentence Executive Summary from structured Program Evidence Graph results.

        ASSESSMENT NAME: {assessment_name}
        CONTEXT: {context}
        ENGINEERING RULE EVALUATIONS: {rule_evaluations}

        INSTRUCTIONS:
        - Summarize which engineering controls were evidenced as met, not met, or unresolved.
        - Treat COMPLIANT/NON_COMPLIANT only as canonical EngineeringRule status labels.
        - Do not claim legal certification, legal approval, legal compliance, or a court-level violation conclusion.
        - Do not include raw source code.
        """
        agent = create_agent(
            model=self._model,
            system_prompt=(
                "You draft bounded LCSP assessment narration. Never make a legal "
                "certification, approval, or compliance conclusion."
            ),
            middleware=MODEL_GOVERNANCE_MIDDLEWARE,
            name="lcsp-final-report-narrator",
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
            raise ValueError("LangChain agent returned no report narration")
        content = getattr(messages[-1], "content", "")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("LangChain agent returned an empty report narration")
        return content
