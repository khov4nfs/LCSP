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
REASON_BUDGET_UNAVAILABLE = "BUDGET_UNAVAILABLE"

CALL_LIMIT_EXCEEDED = REASON_CALL_LIMIT
TOKEN_LIMIT_EXCEEDED = REASON_TOKEN_LIMIT
NO_PROGRESS_LIMIT_EXCEEDED = REASON_NO_PROGRESS
AGENT_BUDGET_REACHED = REASON_BUDGET_REACHED
BUDGET_UNAVAILABLE = REASON_BUDGET_UNAVAILABLE

LEGACY_BUDGET_EXTENSION_ALLOWANCE: dict[str, Any] = {
    "version": 1,
    "authorizedBy": "system:legacy_budget_extended_migration",
    "auditReason": "Legacy budgetExtended flag migration to fixed effective ceiling",
    "additionalModelCalls": 50,
    "additionalInputTokens": 1_000_000,
    "additionalOutputTokens": 50_000,
    "additionalTotalTokens": 1_050_000,
    "overrideNoProgress": False,
}


def _parse_positive_int(env_name: str, fallback: int | None = None) -> int | None:
    """Business purpose: Parse and validate an optional positive integer budget limit from environment.

    Business rules:
    - If unset, None, or empty whitespace, return fallback (default None, representing unconstrained limit).
    - If present and a valid positive integer string, return the integer.
    - If present but malformed (non-integer, <= 0), raise ValueError to fail closed.

    Execution flow:
    1. Check presence of environment variable.
    2. If missing or empty whitespace, return fallback.
    3. Trim and parse as integer.
    4. If parsing fails or value <= 0, raise ValueError.
    5. Return parsed integer.

    Failure cases:
    - Raises ValueError if the configured variable is not a valid positive integer.

    Side effects:
    - Pure function reading os.environ; no filesystem or network mutation.
    """
    raw = os.environ.get(env_name)
    if raw is None or not raw.strip():
        return fallback
    trimmed = raw.strip()
    try:
        val = int(trimmed)
    except (ValueError, TypeError) as exc:
        raise ValueError(
            f"Invalid configuration for {env_name}: expected a positive integer, got {raw!r}"
        ) from exc
    if val <= 0:
        raise ValueError(
            f"Invalid configuration for {env_name}: expected a positive integer, got {val}"
        )
    return val


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
    unmeasured_model_calls: int = 0


def resolve_workload_limits(scope: str) -> WorkloadBudgetLimits:
    """Business purpose: Resolve authoritative budget limits for a canonical workload scope.

    Business rules:
    - Assessment Root limits are drawn from LCSP_ASSESSMENT_MAX_* and LCSP_ASSESSMENT_NO_PROGRESS_LIMIT.
    - Rule Set Preparation limits are drawn from LCSP_RSP_MAX_* (calls, input, total) and LCSP_RSP_NO_PROGRESS_LIMIT.
    - Rule Set Preparation has no cumulative output-token quota; max_output_tokens is permanently None for RULE_SET_PREPARATION.
    - Assessment Root preserves support for its explicitly configured LCSP_ASSESSMENT_MAX_OUTPUT_TOKENS ceiling.
    - Unconfigured limits resolve to None (unconstrained cumulative quota), eliminating arbitrary default pauses.
    - Malformed configurations raise ValueError to prevent silent permissive or restrictive execution.

    Execution flow:
    1. Determine workload scope prefix (LCSP_RSP for RULE_SET_PREPARATION, LCSP_ASSESSMENT otherwise).
    2. Read configured limits from environment with None fallback; max_output_tokens is permanently None for RULE_SET_PREPARATION.
    3. Return immutable WorkloadBudgetLimits.

    Failure cases:
    - Raises ValueError if any configured variable contains non-integer or non-positive value.

    Side effects:
    - Pure function; reads process environment without state changes.
    """
    prefix = "LCSP_RSP" if scope == RULE_SET_PREPARATION_SCOPE else "LCSP_ASSESSMENT"
    return WorkloadBudgetLimits(
        max_model_calls=_parse_positive_int(f"{prefix}_MAX_MODEL_CALLS", None),
        max_input_tokens=_parse_positive_int(f"{prefix}_MAX_INPUT_TOKENS", None),
        max_output_tokens=None
        if scope == RULE_SET_PREPARATION_SCOPE
        else _parse_positive_int("LCSP_ASSESSMENT_MAX_OUTPUT_TOKENS", None),
        max_total_tokens=_parse_positive_int(f"{prefix}_MAX_TOTAL_TOKENS", None),
        no_progress_limit=_parse_positive_int(f"{prefix}_NO_PROGRESS_LIMIT", None),
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


def apply_budget_extension(
    base_limits: WorkloadBudgetLimits,
    extension: dict[str, Any] | None,
) -> WorkloadBudgetLimits:
    """Business purpose: Calculate effective budget limits by applying an authoritative versioned extension to base limits.

    Business rules:
    - If no extension is present, returns base limits unmodified.
    - Additional model calls and tokens are added to configured base limits; unconfigured (None) base limits remain None.
    - When override_no_progress is true in the extension, no_progress_limit is cleared to None.

    Execution flow:
    1. Check if extension exists; if not, return base limits.
    2. Calculate effective call and token limits by summing base and additional amounts where configured.
    3. Clear no_progress_limit if override_no_progress is true; otherwise keep base limit.
    4. Return new WorkloadBudgetLimits object.

    Failure cases:
    - Pure calculation; does not throw.

    Side effects:
    - Pure function without external mutations.
    """
    if not extension:
        return base_limits

    add_calls = extension.get("additionalModelCalls") or extension.get("additional_model_calls") or 0
    add_in = extension.get("additionalInputTokens") or extension.get("additional_input_tokens") or 0
    add_out = extension.get("additionalOutputTokens") or extension.get("additional_output_tokens") or 0
    add_tot = extension.get("additionalTotalTokens") or extension.get("additional_total_tokens") or 0
    override_prog = extension.get("overrideNoProgress") or extension.get("override_no_progress")

    return WorkloadBudgetLimits(
        max_model_calls=base_limits.max_model_calls + add_calls if base_limits.max_model_calls is not None else None,
        max_input_tokens=base_limits.max_input_tokens + add_in if base_limits.max_input_tokens is not None else None,
        max_output_tokens=base_limits.max_output_tokens + add_out if base_limits.max_output_tokens is not None else None,
        max_total_tokens=base_limits.max_total_tokens + add_tot if base_limits.max_total_tokens is not None else None,
        no_progress_limit=None if override_prog else base_limits.no_progress_limit,
    )

