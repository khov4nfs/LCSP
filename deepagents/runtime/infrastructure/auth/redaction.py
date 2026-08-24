"""Redact credentials and raw source fragments before worker data leaves trust boundaries."""

import re
from collections.abc import Mapping, Sequence
from typing import Any

SENSITIVE_KEY_PATTERN = re.compile(
    r"password|token|secret|key|nonce|code|credential|auth|api_key",
    re.IGNORECASE,
)

GITHUB_TOKEN_PATTERN = re.compile(r"ghp_[A-Za-z0-9]{36}")
BEARER_TOKEN_PATTERN = re.compile(r"\bBearer\s+[A-Za-z0-9._-]+")
GENERIC_ASSIGNMENT_PATTERN = re.compile(
    r"\b(?P<key>api_key|key|token|secret|password|credential|auth)"
    r"(?P<sep>\s*[:=]\s*)"
    r"(?P<quote>['\"]?)"
    r"(?P<value>[A-Za-z0-9._~+/=-]{12,})"
    r"(?P=quote)",
    re.IGNORECASE,
)
AWS_ACCESS_KEY_PATTERN = re.compile(r"\bAKIA[0-9A-Z]{16}\b")
ANTHROPIC_KEY_PATTERN = re.compile(r"\bsk-ant-[A-Za-z0-9._-]+\b")


def redact_dict(obj: dict, depth: int = 10) -> dict:
    """Recursively redact sensitive keys and string values in a mapping.

    Args:
        obj: Mapping payload that may contain credentials or secret-like text.
        depth: Maximum recursive depth inspected before failing closed.

    Returns:
        A bounded copy that preserves values while guarding against recursion.
    """
    return _redact_mapping(obj, max(depth, 0), set())


def redact_string(text: str) -> str:
    """Strip known credential values in free-form text.

    Args:
        text: Text that may contain tokens, API keys, or credential assignments.

    Returns:
        Text with supported secret values removed without adding replacement markers.
    """
    stripped = GITHUB_TOKEN_PATTERN.sub("", text)
    stripped = BEARER_TOKEN_PATTERN.sub("Bearer", stripped)
    stripped = AWS_ACCESS_KEY_PATTERN.sub("", stripped)
    stripped = ANTHROPIC_KEY_PATTERN.sub("", stripped)
    return GENERIC_ASSIGNMENT_PATTERN.sub(_redact_assignment, stripped)


def redact_source_code(findings: list[dict]) -> list[dict]:
    """Remove findings that appear to contain raw source code.

    Findings retained by the heuristic are still passed through secret
    redaction. This keeps worker callbacks focused on evidence metadata rather
    than transmitting repository source content.

    Args:
        findings: Finding payloads produced by scanners or analyzers.

    Returns:
        Sanitized findings with source-like payloads omitted.
    """
    redacted_findings: list[dict] = []
    for finding in findings:
        if _contains_source_code(finding):
            continue
        redacted_findings.append(redact_dict(finding))
    return redacted_findings


def _redact_mapping(obj: Mapping[Any, Any], depth: int, seen: set[int]) -> Any:
    """Copy a mapping while guarding against cycles and excessive depth."""
    if depth <= 0:
        return {"truncated": "max_depth"}

    obj_id = id(obj)
    if obj_id in seen:
        return {"truncated": "cycle"}

    seen.add(obj_id)
    copied: dict[Any, Any] = {}
    try:
        for key, value in obj.items():
            key_text = str(key)
            copied[key] = (
                ""
                if SENSITIVE_KEY_PATTERN.search(key_text)
                else _redact_value(value, depth - 1, seen)
            )
    finally:
        seen.remove(obj_id)

    return copied


def _redact_value(value: Any, depth: int, seen: set[int]) -> Any:
    """Redact one nested value according to its runtime container type."""
    if isinstance(value, str):
        return redact_string(value)

    if isinstance(value, Mapping):
        return _redact_mapping(value, depth, seen)

    if isinstance(value, tuple):
        return tuple(_redact_value(item, depth, seen) for item in value)

    if isinstance(value, list):
        if depth <= 0:
            return {"truncated": "max_depth"}
        return [_redact_value(item, depth - 1, seen) for item in value]

    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        if depth <= 0:
            return {"truncated": "max_depth"}
        return [_redact_value(item, depth - 1, seen) for item in value]

    return value


def _redact_assignment(match: re.Match[str]) -> str:
    """Render a matched secret assignment while removing its value."""
    return f"{match.group('key')}{match.group('sep')}"


def _contains_source_code(value: Any) -> bool:
    """Recursively determine whether a payload contains source-like text."""
    if isinstance(value, str):
        return _looks_like_source_code(value)

    if isinstance(value, Mapping):
        return any(_contains_source_code(item) for item in value.values())

    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray, str)):
        return any(_contains_source_code(item) for item in value)

    return False


def _looks_like_source_code(text: str) -> bool:
    """Score text against a conservative multi-language source-code heuristic."""
    normalized = text.strip()
    if not normalized:
        return False

    score = 0
    if re.search(r"\bdef\s+\w+\s*\(", normalized):
        score += 2
    if re.search(r"\bfunction\s+\w*\s*\(", normalized):
        score += 2
    if re.search(r"\bimport\s+[\w{*]", normalized):
        score += 1
    if re.search(r"\b(from\s+\w+(?:\.\w+)*\s+import|class\s+\w+)", normalized):
        score += 1
    if re.search(r"\b(const|let|var)\s+\w+\s*=", normalized):
        score += 1
    if "=>" in normalized:
        score += 1
    if normalized.count("{") + normalized.count("}") >= 2:
        score += 1
    if ";" in normalized and ("\n" in normalized or "{" in normalized):
        score += 1

    return score >= 2
