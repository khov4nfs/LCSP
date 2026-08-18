"""Render EngineeringRule gap-analysis Markdown deterministically."""


class GapAnalysisGenerator:
    """Pure template renderer for direct engineering-rule assessment results."""

    @staticmethod
    def generate(
        assessment_name: str,
        assessment_context: str,
        technical_evidence: list,
        rule_evaluations: list,
        missing_evidence: list,
        recommendations: list,
    ) -> str:
        content = [
            f"# Gap Analysis — {assessment_name}",
            "**Basis: Program Evidence Graph + EngineeringRule evaluation**\n",
            "## 1. Assessment Context",
            f"{assessment_context}\n",
            "## 2. Repository Evidence",
        ]

        if not technical_evidence:
            content.append("No repository evidence provided.")
        else:
            for evidence in technical_evidence:
                content.append(f"- {evidence}")
        content.append("")

        content.append("## 3. EngineeringRule Results")
        if not rule_evaluations:
            content.append("No EngineeringRule evaluation results.")
        else:
            for evaluation in rule_evaluations:
                content.append(f"- {evaluation}")
        content.append("")

        content.append("## 4. Missing Evidence / Unknown Results")
        if not missing_evidence:
            content.append("No unresolved evidence recorded.")
        else:
            for gap in missing_evidence:
                content.append(f"- {gap}")
        content.append("")

        content.append("## 5. Recommended Next Steps")
        if not recommendations:
            content.append("No recommendations recorded.")
        else:
            for recommendation in recommendations:
                content.append(f"- {recommendation}")

        return "\n".join(content)
