"""Detect prohibited certainty/compliance language in generated rationales."""

import re

OVERCLAIM_WORDS = [
    r"certified",
    r"validated",
    r"approved",
    r"compliant",
    r"non-compliant",
    r"production\s+ready",
    r"legally\s+approved"
]


def check_overclaim(rationale_text: str) -> bool:
    """Check whether rationale text makes a prohibited overclaim.

    Args:
        rationale_text: Human- or LLM-produced explanation to validate before
            it is exposed as classification rationale.

    Returns:
        ``True`` when a forbidden certainty/compliance phrase is detected;
        otherwise ``False``.
    """
    if not rationale_text:
        return False

    text_lower = rationale_text.lower()
    for pattern in OVERCLAIM_WORDS:
        if re.search(pattern, text_lower):
            return True

    return False
