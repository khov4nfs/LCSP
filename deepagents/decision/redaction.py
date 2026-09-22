"""Fail-closed outbound privacy checks for Jev decision payloads."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

from jsonschema import SchemaError as JsonSchemaSchemaError
from jsonschema.validators import validator_for

from .contracts import DECISION_TYPES, DecisionRequest


class DecisionRedactionError(ValueError):
    """Raised when a decision payload is unsafe to send to a remote provider."""

    def __init__(self, reason_code: str, message: str) -> None:
        super().__init__(message)
        self.reason_code = reason_code


FORBIDDEN_KEY_SEGMENTS = frozenset(
    {
        "apikey",
        "api",
        "auth",
        "authorization",
        "chain",
        "credential",
        "credentials",
        "developer",
        "env",
        "environment",
        "key",
        "password",
        "private",
        "prompt",
        "reasoning",
        "secret",
        "source",
        "system",
        "token",
    }
)
SAFE_KEY_NAMES = frozenset(
    {
        "artifact_versions",
        "base_sha",
        "acceptance_criteria_ids",
        "active_question_id",
        "active_topic_key",
        "addition_count",
        "assessment_status",
        "bounded_summary",
        "change_categories",
        "changed_filenames",
        "changed_file_count",
        "changed_file_exts",
        "ci_state_codes",
        "confidence",
        "confirmed_topic_keys",
        "context_revision",
        "coverage_state",
        "decision_id",
        "decision_type",
        "deletion_count",
        "deterministic_transition_available",
        "diff_stat_keys",
        "edge_id",
        "edge_type",
        "evidence_ref",
        "evidence_refs",
        "head_sha",
        "is_replay",
        "jira_issue_ids",
        "node_id",
        "node_type",
        "owned_topic_candidates",
        "pending_stage_candidates",
        "policy_version",
        "pr_number",
        "question_id",
        "question_type",
        "questions",
        "resolution_criteria_keys",
        "resolution_state",
        "route_candidates",
        "score_max",
        "score_min",
        "score_rubric",
        "scanner_change_metadata",
        "status",
        "state_payload",
        "topic_key",
        "version",
        "choices",
        "customer_safe_topic_keys",
        "noul_schema",
        "unresolved_topic_keys",
    }
)
FORBIDDEN_EXACT_KEYS = frozenset(
    {
        "api_key",
        "authorization",
        "chain_of_thought",
        "code",
        "code_snippet",
        "credentials",
        "developer_prompt",
        "env",
        "environment",
        "hidden_reasoning",
        "password",
        "private_context",
        "private_customer_context",
        "raw_legal_corpus",
        "raw_prompt",
        "raw_source",
        "repository_source",
        "secret",
        "source_code",
        "source_file",
        "system_prompt",
        "token",
    }
)
FIELD_SEGMENT_PATTERN = re.compile(
    r"[A-Z]+(?=[A-Z][a-z]|[0-9]|$)|[A-Z]?[a-z]+|[0-9]+"
)
SECRET_VALUE_PATTERNS = (
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/-]+=*\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bsk-(?:ant-|proj-)?[A-Za-z0-9._-]{20,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(
        r"\b(?:api[_-]?key|token|secret|password|credential)\s*[:=]\s*['\"]?[A-Za-z0-9._~+/-]{12,}",
        re.IGNORECASE,
    ),
)
PROMPT_VALUE_PATTERNS = (
    re.compile(r"\b(system|developer)\s+prompt\b", re.IGNORECASE),
    re.compile(r"\bchain[- ]of[- ]thought\b", re.IGNORECASE),
    re.compile(r"\bhidden reasoning\b", re.IGNORECASE),
)
SOURCE_LIKE_PATTERNS = (
    re.compile(r"^\s*(?:def|class|import|from)\s+\w+", re.MULTILINE),
    re.compile(r"^\s*(?:export\s+)?(?:async\s+)?function\s+\w+", re.MULTILINE),
    re.compile(r"^\s*(?:const|let|var)\s+\w+\s*=", re.MULTILINE),
    re.compile(r"\b(?:SELECT|INSERT|UPDATE|DELETE)\s+.+\s+FROM\s+", re.IGNORECASE),
)
COMMON_STATE_KEYS = frozenset(
    {
        "action_candidates",
        "allowed_actions",
        "allowed_choices",
        "artifact_refs",
        "candidate_ids",
        "change_categories",
        "ci_state_codes",
        "confidence_prior",
        "coverage_state",
        "current_stage",
        "edge_id",
        "edge_ids",
        "edge_type",
        "edge_types",
        "evidence_ref",
        "evidence_refs",
        "is_replay",
        "limitation_codes",
        "node_id",
        "node_ids",
        "node_type",
        "node_types",
        "reason_code",
        "resolution_state",
        "route_candidates",
        "status",
        "topic_key",
        "topic_keys",
        "transition_reason_code",
    }
)
STATE_KEYS_BY_DECISION_TYPE = {
    DECISION_TYPES["pr_review_triage"]: COMMON_STATE_KEYS
    | {
        "acceptance_criteria_ids",
        "addition_count",
        "base_sha",
        "bounded_summary",
        "changed_filenames",
        "changed_file_count",
        "changed_file_exts",
        "deletion_count",
        "diff_stat_keys",
        "head_sha",
        "jira_issue_ids",
        "label_ids",
        "pr_number",
        "review_domain",
        "reviewer_role",
        "sanitized_diff_metadata",
        "scanner_change_metadata",
    },
    DECISION_TYPES["root_non_deterministic_next_stage"]: COMMON_STATE_KEYS
    | {
        "assessment_status",
        "deterministic_transition_available",
        "pending_stage_candidates",
        "run_status",
    },
    DECISION_TYPES["interview_topic_routing"]: COMMON_STATE_KEYS
    | {
        "active_question_id",
        "active_topic_key",
        "confirmed_topic_keys",
        "context_revision",
        "customer_safe_topic_keys",
        "owned_topic_candidates",
        "question_ids",
        "resolution_criteria_keys",
        "unresolved_topic_keys",
    },
    DECISION_TYPES["planner_candidate_ranking"]: COMMON_STATE_KEYS
    | {
        "candidate_count",
        "engineering_rule_ids",
        "graph_seed_refs",
        "rule_ids",
        "scope_ids",
    },
    DECISION_TYPES["investigator_next_action"]: COMMON_STATE_KEYS
    | {
        "engineering_rule_ids",
        "frontier_state",
        "last_tool_name",
        "rule_ids",
        "tool_names",
    },
}
APPROVED_QUESTION_PROMPTS_BY_DECISION_TYPE = {
    DECISION_TYPES["pr_review_triage"]: {
        "route": "Choose a bounded review route.",
        "risk_score": "Score bounded routing risk.",
        "topic": "Return a normalized topic object.",
        "affected_domain": "Choose the bounded affected review domain.",
        "security_sensitive_change": "Return whether bounded metadata suggests security sensitivity.",
        "exact_head_lifecycle_risk": "Return whether exact-head lifecycle handling needs attention.",
        "needs_deep_review": "Return whether bounded metadata suggests deep review is needed.",
        "likely_missing_regression_tests": "Return whether bounded metadata suggests missing regression tests.",
        "requires_managed_sandbox_attention": "Return whether bounded metadata suggests managed sandbox attention.",
        "change_complexity": "Score bounded change complexity.",
        "operational_risk": "Score bounded operational risk.",
        "review_depth": "Score bounded review depth.",
    },
    DECISION_TYPES["root_non_deterministic_next_stage"]: {
        "route": "Choose the bounded root orchestration route.",
        "needs_reasoning_escalation": "Return whether bounded routing state needs reasoning escalation.",
        "ambiguity_score": "Score bounded routing ambiguity.",
        "next_stage": "Choose a bounded next-stage route.",
        "transition_confidence": "Score bounded transition confidence.",
        "topic": "Return a normalized routing topic object.",
    },
    DECISION_TYPES["interview_topic_routing"]: {
        "material_customer_fact_unresolved": "Return whether a material Customer-owned fact remains unresolved.",
        "missing_topic": "Choose the server-owned Interview topic category.",
        "current_context_sufficient": "Return whether current confirmed context is sufficient to resume.",
        "clarification_ambiguity": "Score bounded Interview clarification ambiguity.",
        "route": "Choose a bounded Interview route.",
        "confidence": "Score bounded Interview routing confidence.",
        "topic": "Return a normalized Interview topic object.",
    },
    DECISION_TYPES["planner_candidate_ranking"]: {
        "candidate": "Choose a bounded Planner candidate.",
        "priority_score": "Score bounded Planner candidate priority.",
        "rank_metadata": "Return normalized Planner ranking metadata.",
    },
    DECISION_TYPES["investigator_next_action"]: {
        "next_action": "Choose a bounded Investigator action.",
        "confidence": "Score bounded Investigator action confidence.",
        "action_metadata": "Return normalized Investigator action metadata.",
    },
}


def validate_outbound_request(request: DecisionRequest) -> dict[str, Any]:
    """Return a provider payload only if it passes the outbound privacy policy."""

    _validate_questions(request)
    _validate_state_payload(
        request.state_payload,
        allowed_keys=STATE_KEYS_BY_DECISION_TYPE.get(request.decision_type, frozenset()),
        path=("decision_request", "state_payload"),
        depth=0,
    )
    payload = request.model_dump(mode="json", exclude_none=True)
    _validate_value(payload, path=("decision_request",), depth=0)
    return payload


def _validate_questions(request: DecisionRequest) -> None:
    approved_prompts = APPROVED_QUESTION_PROMPTS_BY_DECISION_TYPE.get(request.decision_type)
    if approved_prompts is None:
        raise DecisionRedactionError(
            "QUESTION_PROMPT_DECISION_TYPE_UNSUPPORTED",
            "decision questions have no prompt allowlist for this decision type",
        )
    for question in request.questions:
        approved_prompt = approved_prompts.get(question.question_id)
        if approved_prompt is None or question.prompt != approved_prompt:
            raise DecisionRedactionError(
                "QUESTION_PROMPT_NOT_ALLOWLISTED",
                f"decision question prompt is not allowlisted: {question.question_id}",
            )
        _validate_string(
            question.prompt,
            path=("decision_request", "questions", question.question_id, "prompt"),
        )
        if question.question_type == "NOUL":
            _validate_local_noul_schema(question.noul_schema, question_id=question.question_id)


def _validate_local_noul_schema(schema: dict[str, Any], *, question_id: str) -> None:
    try:
        validator = validator_for(schema)
        validator.check_schema(schema)
    except JsonSchemaSchemaError as exc:
        raise DecisionRedactionError(
            "PROVIDER_SCHEMA_INVALID",
            f"decision question NOUL schema is invalid: {question_id}",
        ) from exc


def _validate_state_payload(
    value: Any,
    *,
    allowed_keys: frozenset[str],
    path: tuple[str, ...],
    depth: int,
) -> None:
    if not allowed_keys:
        raise DecisionRedactionError(
            "STATE_PAYLOAD_DECISION_TYPE_UNSUPPORTED",
            "decision state payload has no allowlist for this decision type",
        )
    if depth > 8:
        raise DecisionRedactionError(
            "STATE_PAYLOAD_TOO_DEEP",
            f"decision state payload is too deeply nested at {_format_path(path)}",
        )
    if isinstance(value, Mapping):
        for raw_key, item in value.items():
            key = str(raw_key)
            _validate_key(key, path=path)
            if key not in allowed_keys:
                raise DecisionRedactionError(
                    "STATE_PAYLOAD_KEY_NOT_ALLOWLISTED",
                    f"decision state payload key is not allowlisted: {_format_path((*path, key))}",
                )
            _validate_state_payload(
                item,
                allowed_keys=allowed_keys,
                path=(*path, key),
                depth=depth + 1,
            )
        return
    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray, str)):
        if len(value) > 100:
            raise DecisionRedactionError(
                "STATE_PAYLOAD_SEQUENCE_TOO_LARGE",
                f"decision state payload sequence is too large at {_format_path(path)}",
            )
        for index, item in enumerate(value):
            _validate_state_payload(
                item,
                allowed_keys=allowed_keys,
                path=(*path, str(index)),
                depth=depth + 1,
            )
        return
    if isinstance(value, str):
        if len(value) > 1_000:
            raise DecisionRedactionError(
                "STATE_PAYLOAD_STRING_TOO_LARGE",
                f"decision state payload string is too large at {_format_path(path)}",
            )
        _validate_string(value, path=path)
        return
    if isinstance(value, (bytes, bytearray)):
        raise DecisionRedactionError(
            "BINARY_PAYLOAD_FORBIDDEN",
            f"binary decision payload is forbidden at {_format_path(path)}",
        )


def _validate_value(value: Any, *, path: tuple[str, ...], depth: int) -> None:
    if depth > 12:
        raise DecisionRedactionError(
            "PAYLOAD_TOO_DEEP",
            f"decision payload is too deeply nested at {_format_path(path)}",
        )
    if isinstance(value, Mapping):
        for raw_key, item in value.items():
            key = str(raw_key)
            _validate_key(key, path=path)
            _validate_value(item, path=(*path, key), depth=depth + 1)
        return
    if isinstance(value, str):
        _validate_string(value, path=path)
        return
    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray, str)):
        if len(value) > 500:
            raise DecisionRedactionError(
                "PAYLOAD_SEQUENCE_TOO_LARGE",
                f"decision payload sequence is too large at {_format_path(path)}",
            )
        for index, item in enumerate(value):
            _validate_value(item, path=(*path, str(index)), depth=depth + 1)
        return
    if isinstance(value, (bytes, bytearray)):
        raise DecisionRedactionError(
            "BINARY_PAYLOAD_FORBIDDEN",
            f"binary decision payload is forbidden at {_format_path(path)}",
        )


def _validate_key(key: str, *, path: tuple[str, ...]) -> None:
    normalized = key.strip()
    if not normalized:
        raise DecisionRedactionError(
            "EMPTY_PAYLOAD_KEY",
            f"decision payload key is empty at {_format_path(path)}",
        )
    key_lower = normalized.lower()
    if key_lower == "prompt" and "questions" in path:
        return
    if key_lower == "prompt":
        raise DecisionRedactionError(
            "FORBIDDEN_PAYLOAD_KEY",
            f"decision payload key is forbidden: {_format_path((*path, key))}",
        )
    if key_lower in SAFE_KEY_NAMES:
        return
    if key_lower in FORBIDDEN_EXACT_KEYS:
        raise DecisionRedactionError(
            "FORBIDDEN_PAYLOAD_KEY",
            f"decision payload key is forbidden: {_format_path((*path, key))}",
        )
    segments = _segments(normalized)
    if "source" in segments and {"id", "ids", "ref", "refs", "kind"} & set(segments):
        return
    if "prompt" in segments or "reasoning" in segments or "private" in segments:
        raise DecisionRedactionError(
            "FORBIDDEN_PAYLOAD_KEY",
            f"decision payload key is forbidden: {_format_path((*path, key))}",
        )
    if any(segment in FORBIDDEN_KEY_SEGMENTS for segment in segments):
        raise DecisionRedactionError(
            "SECRET_LIKE_PAYLOAD_KEY",
            f"decision payload key is secret-like: {_format_path((*path, key))}",
        )


def _validate_string(value: str, *, path: tuple[str, ...]) -> None:
    if len(value) > 8_000:
        raise DecisionRedactionError(
            "STRING_PAYLOAD_TOO_LARGE",
            f"decision payload string is too large at {_format_path(path)}",
        )
    if any(pattern.search(value) for pattern in SECRET_VALUE_PATTERNS):
        raise DecisionRedactionError(
            "SECRET_LIKE_PAYLOAD_VALUE",
            f"decision payload contains secret-like text at {_format_path(path)}",
        )
    if any(pattern.search(value) for pattern in PROMPT_VALUE_PATTERNS):
        raise DecisionRedactionError(
            "PROMPT_PAYLOAD_FORBIDDEN",
            f"decision payload contains prompt or hidden reasoning text at {_format_path(path)}",
        )
    if "\n" in value and any(pattern.search(value) for pattern in SOURCE_LIKE_PATTERNS):
        raise DecisionRedactionError(
            "RAW_SOURCE_PAYLOAD_FORBIDDEN",
            f"decision payload contains source-like text at {_format_path(path)}",
        )


def _segments(value: str) -> tuple[str, ...]:
    normalized = re.sub(r"[^0-9A-Za-z]+", " ", value)
    return tuple(
        segment.group(0).lower()
        for word in normalized.split()
        for segment in FIELD_SEGMENT_PATTERN.finditer(word)
    )


def _format_path(path: tuple[str, ...]) -> str:
    return ".".join(path)


__all__ = ["DecisionRedactionError", "validate_outbound_request"]
