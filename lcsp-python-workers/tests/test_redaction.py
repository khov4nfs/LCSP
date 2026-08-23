from lcsp_workers.platform.redaction import (
    redact_dict,
    redact_source_code,
    redact_string,
)


def test_t01_dict_with_password_key_is_stripped() -> None:
    payload = {"username": "alice", "password": "super-secret"}

    assert redact_dict(payload) == {"username": "alice", "password": ""}


def test_t02_nested_api_key_is_stripped_at_all_levels() -> None:
    payload = {"a": {"b": {"c": {"api_key": "key-1234567890abcd"}}}}

    copied = redact_dict(payload)

    assert copied["a"]["b"]["c"]["api_key"] == ""


def test_t03_github_token_in_string_is_stripped() -> None:
    token = "ghp_1234567890abcdefABCDEF1234567890abcd"

    assert redact_string(f"token={token}") == "token="


def test_t04_bearer_token_in_dict_value_is_stripped() -> None:
    payload = {"message": "Authorization failed for Bearer abc.def-ghi_123"}

    copied = redact_dict(payload)

    assert copied["message"] == "Authorization failed for Bearer"


def test_t05_deeply_nested_dict_stops_at_max_depth() -> None:
    payload: dict = {"level": 0}
    cursor = payload
    for level in range(1, 13):
        cursor["child"] = {"level": level}
        cursor = cursor["child"]

    copied = redact_dict(payload, depth=10)

    cursor = copied
    for _ in range(9):
        cursor = cursor["child"]
    assert cursor["child"] == {"truncated": "max_depth"}


def test_t06_source_code_finding_is_removed() -> None:
    findings = [
        {"finding_type": "AI_MODEL_INVOCATION", "description": "safe metadata"},
        {
            "finding_type": "RAW_CODE",
            "snippet": "def run():\n    import os\n    return os.getenv('TOKEN')",
        },
    ]

    assert redact_source_code(findings) == [
        {"finding_type": "AI_MODEL_INVOCATION", "description": "safe metadata"}
    ]


def test_t07_clean_dict_is_unchanged() -> None:
    payload = {
        "finding_type": "AI_MODEL_INVOCATION",
        "confidence": 0.91,
        "evidence": [{"file_path": "src/ai.py", "line": 12}],
    }

    assert redact_dict(payload) == payload
