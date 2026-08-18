"""Detect narrative legal overclaims while allowing canonical engineering statuses."""

import re

# These patterns intentionally target claims of legal/regulatory certainty rather than
# generic words such as "compliant", "validated", or "approved". Direct assessment
# documents legitimately contain EngineeringRule status fields and provenance metadata
# whose keys may include those words.
OVERCLAIM_PATTERNS = (
    r"\bcertified\b",
    r"\blegally\s+compliant\b",
    r"\bfully\s+compliant\b",
    r"\bcompliant\s+with\s+(?:the\s+)?(?:law|laws|regulation|regulations)\b",
    r"\bnon[-\s]?compliant\s+with\s+(?:the\s+)?(?:law|laws|regulation|regulations)\b",
    r"\blegal(?:ly)?\s+approved\b",
    r"\bapproved\s+by\s+(?:a\s+|the\s+)?(?:regulator|regulatory\s+authority)\b",
    r"\bvalidated\s+as\s+(?:legally\s+)?compliant\b",
    r"\bproduction\s+ready\b",
)

CANONICAL_STATUS_TOKENS = (
    "NON_COMPLIANT",
    "COMPLIANT",
    "UNKNOWN",
)


class OutputGuardrail:
    """Stateless reporting guardrail for legal-certainty overclaims."""

    @staticmethod
    def check(content: str) -> bool:
        if not content:
            return False

        normalized = content
        for token in CANONICAL_STATUS_TOKENS:
            normalized = normalized.replace(token, "ENGINEERING_RULE_STATUS")

        text_lower = normalized.lower()
        return any(re.search(pattern, text_lower) for pattern in OVERCLAIM_PATTERNS)
