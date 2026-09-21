"""Deterministic redaction guardrails for model and non-model data boundaries."""

import logging
import re
from collections.abc import Mapping, Sequence
from typing import Any

LOGGER = logging.getLogger(__name__)

SENSITIVE_KEY_SEGMENTS = frozenset(
    {
        "apikey",
        "auth",
        "authorization",
        "credential",
        "credentials",
        "key",
        "keys",
        "nonce",
        "passwd",
        "password",
        "pwd",
        "secret",
        "secrets",
        "token",
        "tokens",
    }
)

SAFE_METADATA_KEY_NAMES = frozenset(
    {
        "author",
        "authorName",
        "authorized",
        "countryCode",
        "decoded",
        "encoded",
        "errorCode",
        "finish_reason",
        "keyword",
        "messageKey",
        "input_tokens",
        "output_tokens",
        "reasonCode",
        "sourceCode",
        "statusCode",
        "tokenCount",
        "total_tokens",
        "usage_metadata",
    }
)

FIELD_NAME_SEGMENT_PATTERN = re.compile(
    r"[A-Z]+(?=[A-Z][a-z]|[0-9]|$)|[A-Z]?[a-z]+|[0-9]+"
)

GITHUB_TOKEN_PATTERN = re.compile(r"ghp_[A-Za-z0-9]{36}")
BEARER_TOKEN_PATTERN = re.compile(r"\bBearer\s+[A-Za-z0-9._-]+")
GENERIC_ASSIGNMENT_PATTERN = re.compile(
    r"(?P<key_quote>['\"]?)"
    r"(?P<key>\b(?:api_key|key|token|secret|password|credential|auth)\b)"
    r"(?P=key_quote)"
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
    redacted_keys: set[str] = set()
    copied = _redact_mapping(obj, max(depth, 0), set(), redacted_keys)
    if redacted_keys:
        redacted_key_names = sorted(redacted_keys)
        LOGGER.info(
            "REDACTION_KEYS_STRIPPED redacted_keys=%s",
            ",".join(redacted_key_names),
            extra={"redacted_keys": redacted_key_names},
        )
    return copied


def is_sensitive_key_name(key_text: str) -> bool:
    """Return whether a structured field name has a secret-denoting segment.

    The check is segment-based: authToken, auth_token, and x-api-key are
    sensitive, while author and statusCode are not substring-matched.
    """
    return _is_sensitive_key(key_text, None)


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


def _redact_mapping(
    obj: Mapping[Any, Any],
    depth: int,
    seen: set[int],
    redacted_keys: set[str],
) -> Any:
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
                if _is_sensitive_key(key_text, redacted_keys)
                else _redact_value(value, depth - 1, seen, redacted_keys)
            )
    finally:
        seen.remove(obj_id)

    return copied


def _is_sensitive_key(key_text: str, redacted_keys: set[str] | None) -> bool:
    """Return whether a structured field name has a secret-denoting segment."""
    if key_text in SAFE_METADATA_KEY_NAMES:
        return False
    segments = _field_name_segments(key_text)
    if not any(segment in SENSITIVE_KEY_SEGMENTS for segment in segments):
        return False
    if redacted_keys is not None:
        redacted_keys.add(key_text)
    return True


def _field_name_segments(key_text: str) -> tuple[str, ...]:
    """Split snake/kebab/camel field names without substring-matching words."""
    normalized = re.sub(r"[^0-9A-Za-z]+", " ", key_text)
    return tuple(
        segment.group(0).lower()
        for word in normalized.split()
        for segment in FIELD_NAME_SEGMENT_PATTERN.finditer(word)
    )


def _redact_value(
    value: Any,
    depth: int,
    seen: set[int],
    redacted_keys: set[str],
) -> Any:
    """Redact one nested value according to its runtime container type."""
    if isinstance(value, str):
        return redact_string(value)

    if isinstance(value, Mapping):
        return _redact_mapping(value, depth, seen, redacted_keys)

    if isinstance(value, tuple):
        return tuple(_redact_value(item, depth, seen, redacted_keys) for item in value)

    if isinstance(value, list):
        if depth <= 0:
            return {"truncated": "max_depth"}
        return [_redact_value(item, depth - 1, seen, redacted_keys) for item in value]

    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        if depth <= 0:
            return {"truncated": "max_depth"}
        return [_redact_value(item, depth - 1, seen, redacted_keys) for item in value]

    return value


def _redact_assignment(match: re.Match[str]) -> str:
    """Render a matched secret assignment while removing its value."""
    key_quote = match.group("key_quote")
    value_quote = match.group("quote")
    return (
        f"{key_quote}{match.group('key')}{key_quote}{match.group('sep')}"
        f"{value_quote}{value_quote}"
    )


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
