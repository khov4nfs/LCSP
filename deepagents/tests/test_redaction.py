from middleware.redaction import (
    is_sensitive_key_name,
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


def test_t08_safe_metadata_field_names_survive_key_redaction() -> None:
    payload = {
        "author": "alice",
        "authorName": "Alice Example",
        "total_tokens": 123,
        "tokenCount": 456,
        "statusCode": 200,
        "errorCode": "NONE",
        "countryCode": "VN",
        "sourceCode": "SRC-1",
        "encoded": "abc123",
        "decoded": "abc123",
        "keyword": "planner",
        "messageKey": "ENGINEERING_RULE_PLANNER_DECISION",
        "reasonCode": "SOURCE_SCOPE_MATCH",
        "finish_reason": "stop",
        "usage_metadata": {"total_tokens": 321},
    }

    assert redact_dict(payload) == payload


def test_t09_secret_field_names_are_redacted_and_logged(caplog) -> None:
    caplog.set_level("INFO")
    secret_field_names = (
        "api_key",
        "apiKey",
        "access_token",
        "client_secret",
        "private_key",
        "password",
        "GEMINI_API_KEY",
        "WORKER_API_KEY",
        "authToken",
        "auth_token",
        "bearerToken",
        "bearer_token",
        "secretKey",
        "secret_key",
        "githubToken",
        "github_token",
        "dbPassword",
        "db_password",
        "passwd",
        "pwd",
        "webhookSecret",
        "encryptionKey",
        "signingKey",
        "privateToken",
        "openaiKey",
        "gcpServiceAccountKey",
        "x-api-key",
        "token",
        "key",
        "auth",
    )
    payload = {
        field_name: f"secret-{index}"
        for index, field_name in enumerate(secret_field_names)
    }
    payload["nested"] = {"session_token": "secret-nested"}

    copied = redact_dict(payload)

    assert copied == {
        **{field_name: "" for field_name in secret_field_names},
        "nested": {"session_token": ""},
    }
    redaction_records = [
        record
        for record in caplog.records
        if record.message.startswith("REDACTION_KEYS_STRIPPED redacted_keys=")
    ]
    assert len(redaction_records) == 1
    assert set(redaction_records[0].redacted_keys) == {
        *secret_field_names,
        "session_token",
    }
    assert "redacted_keys=" in caplog.text
    for field_name in (*secret_field_names, "session_token"):
        assert field_name in caplog.text
    assert "secret-" not in caplog.text


def test_t10_code_fields_are_not_secret_key_names() -> None:
    payload = {
        "code": "VALIDATION_FAILED",
        "status_code": 400,
        "reason_code": "SOURCE_SCOPE_MATCH",
        "error_code": "NONE",
    }

    assert redact_dict(payload) == payload

def test_t11_public_sensitive_key_name_api_uses_segment_matching() -> None:
    assert is_sensitive_key_name("authToken") is True
    assert is_sensitive_key_name("x-api-key") is True
    assert is_sensitive_key_name("dbPassword") is True
    assert is_sensitive_key_name("author") is False
    assert is_sensitive_key_name("statusCode") is False
    assert is_sensitive_key_name("reasonCode") is False
