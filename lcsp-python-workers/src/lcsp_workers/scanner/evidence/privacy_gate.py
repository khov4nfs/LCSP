from typing import Any


def _looks_like_source_code(text: str) -> bool:
    """Heuristically flag long text that resembles a persisted source-code body."""
    if len(text) < 50:
        return False
    code_markers = ["def ", "function ", "import ", "class ", "const ", "var ", "let "]
    brace_density = (text.count("{") + text.count("}")) / max(len(text), 1)
    return any(m in text for m in code_markers) or brace_density > 0.05


def assert_privacy_flags(payload: Any) -> None:
    """Fail closed when terminal evidence violates declared privacy guarantees.

    The gate accepts both object- and dictionary-shaped payloads because scanner
    stages may validate dataclasses before serialization or callback dictionaries
    afterward. In addition to the explicit flags, string finding fields are checked
    for source-like content so an incorrect flag cannot silently authorize leakage.

    Args:
        payload: Evidence payload exposing privacy flags and findings.

    Raises:
        AssertionError: If source retention, missing secret redaction, or source-like
            finding content violates the terminal persistence contract.
    """
    # Handle dict or object
    if hasattr(payload, 'privacy_flags'):
        flags = payload.privacy_flags
        has_source = flags.contains_source_code if hasattr(flags, 'contains_source_code') else flags.get('contains_source_code')
        redacted = flags.secrets_redacted if hasattr(flags, 'secrets_redacted') else flags.get('secrets_redacted')
    else:
        flags = payload.get('privacy_flags', {})
        has_source = flags.get('contains_source_code')
        redacted = flags.get('secrets_redacted')

    assert has_source is False, \
        "TERMINAL_PRIVACY_FAILURE: contains_source_code must be False"
        
    assert redacted is True, \
        "TERMINAL_PRIVACY_FAILURE: secrets_redacted must be True"
        
    findings = payload.findings if hasattr(payload, 'findings') else payload.get('findings', [])
    
    for finding in findings:
        finding_dict = finding.__dict__ if hasattr(finding, "__dict__") else finding
        for field_name, field_value in finding_dict.items():
            if isinstance(field_value, str):
                assert not _looks_like_source_code(field_value), \
                    f"TERMINAL_PRIVACY_FAILURE: source code in finding.{field_name}"
