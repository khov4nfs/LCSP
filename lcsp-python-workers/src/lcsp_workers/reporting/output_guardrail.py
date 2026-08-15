"""Detect prohibited overclaim language before generated reports are published."""

import re

OVERCLAIM_WORDS = [
    r"certified",
    r"validated",
    r"compliant",
    r"non-compliant",
    r"approved",
    r"production\s+ready"
]


class OutputGuardrail:
    """Stateless reporting guardrail for certainty/compliance overclaims."""

    @staticmethod
    def check(content: str) -> bool:
        """Return whether generated content contains prohibited overclaim phrases.

        Args:
            content: Generated report/document text to validate.

        Returns:
            ``True`` when an overclaim is detected; ``False`` when the content
            passes this guardrail.
        """
        if not content:
            return False

        text_lower = content.lower()
        for pattern in OVERCLAIM_WORDS:
            if re.search(pattern, text_lower):
                return True

        return False
