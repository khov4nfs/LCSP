"""Render gap-analysis Markdown deterministically from structured assessment data."""


class GapAnalysisGenerator:
    """Pure template renderer for gap-analysis documents; no LLM is used."""

    @staticmethod
    def generate(
        assessment_name: str,
        assessment_context: str,
        technical_evidence: list,
        ai_usage_claims: list,
        applicable_rules: list,
        missing_evidence: list,
        recommendations: list
    ) -> str:
        """Generate a six-section gap-analysis Markdown document.

        Args:
            assessment_name: Display name of the assessment.
            assessment_context: Business/system context summarized for the reader.
            technical_evidence: Structured technical evidence entries to list.
            ai_usage_claims: Identified AI usage claims.
            applicable_rules: Legal rules considered applicable.
            missing_evidence: Coverage gaps requiring follow-up.
            recommendations: Recommended next actions.

        Returns:
            Deterministically rendered Markdown document.
        """
        # Section 1: Context
        content = [
            f"# Title: Gap Analysis — {assessment_name}",
            "**Label: Wizard Readiness and Legal Gap Analysis**\n",
            "## 1. Assessment Context",
            f"{assessment_context}\n",
            "## 2. Technical Evidence Summary"
        ]

        # Section 2: Technical
        if not technical_evidence:
            content.append("No technical evidence provided.")
        else:
            for ev in technical_evidence:
                content.append(f"- {ev}")
        content.append("")

        # Section 3: AI Usage Patterns
        content.append("## 3. Identified AI Usage Patterns")
        if not ai_usage_claims:
            content.append("No AI usage claims identified.")
        else:
            for claim in ai_usage_claims:
                content.append(f"- {claim}")
        content.append("")

        # Section 4: Legal Rules
        content.append("## 4. Legal Rule Applicability")
        if not applicable_rules:
            content.append("No applicable legal rules.")
        else:
            for rule in applicable_rules:
                content.append(f"- {rule}")
        content.append("")

        # Section 5: Missing Evidence
        content.append("## 5. Missing Evidence / Coverage Gaps")
        if not missing_evidence:
            content.append("No coverage gaps identified.")
        else:
            for gap in missing_evidence:
                content.append(f"- {gap}")
        content.append("")

        # Section 6: Next Steps
        content.append("## 6. Recommended Next Steps")
        if not recommendations:
            content.append("No recommendations.")
        else:
            for rec in recommendations:
                content.append(f"- {rec}")

        return "\n".join(content)
