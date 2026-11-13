"""Shared durable budget kernel for LCSP agent workloads.

Enforces cumulative model call, token bucket, and no-progress boundaries
across Assessment Root and Rule Set Preparation.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

ASSESSMENT_ROOT_SCOPE = "ASSESSMENT_ROOT"
RULE_SET_PREPARATION_SCOPE = "RULE_SET_PREPARATION"

REASON_CALL_LIMIT = "CALL_LIMIT_EXCEEDED"
REASON_TOKEN_LIMIT = "TOKEN_LIMIT_EXCEEDED"
REASON_NO_PROGRESS = "NO_PROGRESS_LIMIT_EXCEEDED"
REASON_BUDGET_REACHED = "AGENT_BUDGET_REACHED"

CALL_LIMIT_EXCEEDED = REASON_CALL_LIMIT
TOKEN_LIMIT_EXCEEDED = REASON_TOKEN_LIMIT
NO_PROGRESS_LIMIT_EXCEEDED = REASON_NO_PROGRESS
AGENT_BUDGET_REACHED = REASON_BUDGET_REACHED

DEFAULT_ASSESSMENT_MAX_CALLS = 100
DEFAULT_ASSESSMENT_MAX_INPUT_TOKENS = 4_000_000
DEFAULT_ASSESSMENT_MAX_OUTPUT_TOKENS = 200_000
DEFAULT_ASSESSMENT_MAX_TOTAL_TOKENS = 4_200_000
DEFAULT_ASSESSMENT_NO_PROGRESS_LIMIT = 15


def _parse_positive_int(env_name: str, fallback: int | None) -> int | None:
    """Business purpose: Parse a positive integer limit from an environment variable.

    Business rules:
    - Return positive integer when set and valid, otherwise fallback.
    - Zero or negative values return fallback.

    Execution flow:
    1. Check presence of environment variable.
    2. Convert to integer.
    3. Return valid value or fallback.

    Failure cases:
    - ValueError or TypeError falls back to the default.

    Side effects:
    - Pure function reading os.environ; no filesystem or network mutation.
    """
    raw = os.environ.get(env_name)
    if not raw:
        return fallback
    try:
        val = int(raw.strip())
        return val if val > 0 else fallback
    except (ValueError, TypeError):
        return fallback


@dataclass(frozen=True)
class WorkloadBudgetLimits:
    max_model_calls: int | None
    max_input_tokens: int | None
    max_output_tokens: int | None
    max_total_tokens: int | None
    no_progress_limit: int | None


@dataclass
class WorkloadCumulativeUsage:
    model_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    consecutive_turns_without_progress: int = 0


def resolve_workload_limits(scope: str) -> WorkloadBudgetLimits:
    """Business purpose: Resolve authoritative budget limits for a canonical workload scope.

    Business rules:
    - Assessment Root limits are drawn from LCSP_ASSESSMENT_MAX_* environment variables.
    - Rule Set Preparation limits are drawn from LCSP_RSP_MAX_* environment variables.
    - Missing environment variables fall back to safe canonical defaults.

    Execution flow:
    1. Determine workload scope.
    2. Read configured limits from environment with fallback defaults.
    3. Return immutable WorkloadBudgetLimits.

    Failure cases:
    - Unrecognized workload scope identifiers fall back safely to standard Assessment Root limits.

    Side effects:
    - Pure function; reads process environment without state changes.
    """
    if scope == RULE_SET_PREPARATION_SCOPE:
        return WorkloadBudgetLimits(
            max_model_calls=_parse_positive_int("LCSP_RSP_MAX_MODEL_CALLS", 50),
            max_input_tokens=_parse_positive_int("LCSP_RSP_MAX_INPUT_TOKENS", 2_000_000),
            max_output_tokens=_parse_positive_int("LCSP_RSP_MAX_OUTPUT_TOKENS", 100_000),
            max_total_tokens=_parse_positive_int("LCSP_RSP_MAX_TOTAL_TOKENS", 2_100_000),
            no_progress_limit=_parse_positive_int("LCSP_RSP_NO_PROGRESS_LIMIT", 10),
        )
    return WorkloadBudgetLimits(
        max_model_calls=_parse_positive_int("LCSP_ASSESSMENT_MAX_MODEL_CALLS", DEFAULT_ASSESSMENT_MAX_CALLS),
        max_input_tokens=_parse_positive_int("LCSP_ASSESSMENT_MAX_INPUT_TOKENS", DEFAULT_ASSESSMENT_MAX_INPUT_TOKENS),
        max_output_tokens=_parse_positive_int("LCSP_ASSESSMENT_MAX_OUTPUT_TOKENS", DEFAULT_ASSESSMENT_MAX_OUTPUT_TOKENS),
        max_total_tokens=_parse_positive_int("LCSP_ASSESSMENT_MAX_TOTAL_TOKENS", DEFAULT_ASSESSMENT_MAX_TOTAL_TOKENS),
        no_progress_limit=_parse_positive_int("LCSP_ASSESSMENT_NO_PROGRESS_LIMIT", DEFAULT_ASSESSMENT_NO_PROGRESS_LIMIT),
    )


def evaluate_workload_admission(
    limits: WorkloadBudgetLimits,
    usage: WorkloadCumulativeUsage,
) -> tuple[bool, str | None]:
    """Business purpose: Evaluate whether a physical model dispatch is admitted under cumulative limits.

    Business rules:
    - When cumulative model calls meet or exceed max_model_calls, deny dispatch.
    - When cumulative tokens meet or exceed token bounds, deny dispatch.
    - When consecutive turns without progress meet or exceed no_progress_limit, deny dispatch.
    - Missing limits are treated as unconstrained for that dimension.

    Execution flow:
    1. Check call count against max_model_calls.
    2. Check input, output, and total tokens against respective limits.
    3. Check consecutive turns without progress against no_progress_limit.
    4. Return admission boolean and specific denial reason.

    Failure cases:
    - Returns (False, reason) when any limit is reached.

    Side effects:
    - Pure function; does not mutate input records or perform network calls.
    """
    if limits.max_model_calls is not None and usage.model_calls >= limits.max_model_calls:
        return False, REASON_CALL_LIMIT
    if limits.max_input_tokens is not None and usage.input_tokens >= limits.max_input_tokens:
        return False, REASON_TOKEN_LIMIT
    if limits.max_output_tokens is not None and usage.output_tokens >= limits.max_output_tokens:
        return False, REASON_TOKEN_LIMIT
    if limits.max_total_tokens is not None and usage.total_tokens >= limits.max_total_tokens:
        return False, REASON_TOKEN_LIMIT
    if (
        limits.no_progress_limit is not None
        and usage.consecutive_turns_without_progress >= limits.no_progress_limit
    ):
        return False, REASON_NO_PROGRESS
    return True, None


def record_workload_progress(
    usage: WorkloadCumulativeUsage,
    *,
    made_progress: bool,
) -> None:
    """Business purpose: Update progress tracking for no-progress guard.

    Business rules:
    - If authoritative progress was made in the turn, reset consecutive turn counter to zero.
    - If no progress was made, increment the consecutive turn counter by one.

    Execution flow:
    1. Check made_progress flag.
    2. Reset or increment consecutive_turns_without_progress.

    Failure cases:
    - None: operates directly on the mutable usage object.

    Side effects:
    - Mutates consecutive_turns_without_progress on the supplied usage object.
    """
    if made_progress:
        usage.consecutive_turns_without_progress = 0
    else:
        usage.consecutive_turns_without_progress += 1
