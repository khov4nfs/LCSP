"""Working-context compaction and retention policy for LCSP agent workloads.

Governs working-context window bounds, trigger/keep thresholds, tool-argument
truncation, and output headroom per agent role (Assessment Root, Researcher,
Rule Set Preparation, Default) independently of cumulative execution budgets.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Mapping

ROLE_ASSESSMENT_ROOT = "assessment-root"
ROLE_REPOSITORY_RESEARCHER = "repository-researcher"
ROLE_RULE_SET_PREPARATION = "rule-set-preparation"
ROLE_DEFAULT = "default"

TRIGGER_MODE_FRACTION = "fraction"
TRIGGER_MODE_TOKENS = "tokens"
TRIGGER_MODE_MESSAGES = "messages"

KEEP_MODE_FRACTION = "fraction"
KEEP_MODE_TOKENS = "tokens"
KEEP_MODE_MESSAGES = "messages"


@dataclass(frozen=True)
class WorkingContextPolicy:
    """Immutable working-context policy configuration for an agent role."""

    role: str
    trigger: tuple[str, float | int]
    keep: tuple[str, float | int]
    truncate_args_settings: dict[str, tuple[str, int]]
    output_headroom_tokens: int
    trim_tokens_to_summarize: int
    max_working_context_tokens: int | None = None


def normalize_working_context_role(role: str) -> str:
    """Business purpose: Normalize arbitrary agent role strings to canonical working-context roles.

    Business rules:
    - Hyphenated and underscored names are handled uniformly in case-insensitive fashion.
    - Known roles for assessment-root, repository-researcher, and rule-set-preparation map to their canonical strings.
    - Unrecognized or empty role strings safely fall back to the default role.

    Execution flow:
    1. Strip whitespace, convert to lowercase, and normalize hyphens to underscores.
    2. Check against known role patterns.
    3. Return the matching canonical role or default.

    Failure cases:
    - Empty, none, or non-matching role strings return the canonical default role.

    Side effects:
    - Pure function; performs string matching without external side effects.
    """
    if not role or not isinstance(role, str):
        return ROLE_DEFAULT
    clean = role.strip().lower().replace("-", "_")
    if clean in ("assessment_root", "root"):
        return ROLE_ASSESSMENT_ROOT
    if clean in ("repository_researcher", "researcher"):
        return ROLE_REPOSITORY_RESEARCHER
    if clean in ("rule_set_preparation", "preparation"):
        return ROLE_RULE_SET_PREPARATION
    return ROLE_DEFAULT


def _parse_positive_int_env(env_name: str, fallback: int) -> int:
    """Business purpose: Read an optional positive integer override from the environment.

    Business rules:
    - Only positive integers (> 0) are accepted.
    - Missing or non-numeric values return the supplied fallback.

    Execution flow:
    1. Check presence of environment variable.
    2. Convert to int and verify positivity.
    3. Return valid value or fallback.

    Failure cases:
    - Non-numeric or non-positive values safely return the fallback value.

    Side effects:
    - Pure function reading process environment without mutation.
    """
    raw = os.environ.get(env_name)
    if not raw:
        return fallback
    try:
        val = int(raw.strip())
        return val if val > 0 else fallback
    except (ValueError, TypeError):
        return fallback


def _parse_float_env(env_name: str, fallback: float) -> float:
    """Business purpose: Read an optional float fraction override from the environment.

    Business rules:
    - Only fractions strictly between 0.0 and 1.0 are accepted.
    - Missing or out-of-bounds values return the fallback.

    Execution flow:
    1. Check presence of environment variable.
    2. Convert to float and verify 0.0 < val < 1.0.
    3. Return valid fraction or fallback.

    Failure cases:
    - Values <= 0.0, >= 1.0, or non-float strings return the fallback.

    Side effects:
    - Pure function reading process environment without mutation.
    """
    raw = os.environ.get(env_name)
    if not raw:
        return fallback
    try:
        val = float(raw.strip())
        return val if 0.0 < val < 1.0 else fallback
    except (ValueError, TypeError):
        return fallback


def resolve_working_context_policy(
    role: str,
    model: Any | None = None,
    options: Mapping[str, Any] | None = None,
) -> WorkingContextPolicy:
    """Business purpose: Resolve the authoritative working-context policy for an agent role and model.

    Business rules:
    - Enforce explicit role-tailored compaction thresholds, retention policies, and output headroom.
    - Ensure output headroom is preserved so model generations never trigger context-overflow errors.
    - If a model profile exposes max_input_tokens, fraction-based compaction is calibrated against that capacity.
    - If a model lacks profile metadata, safe fixed-token thresholds bound the working context.
    - Dynamic max_output_tokens in model options expands headroom to prevent truncated responses.

    Execution flow:
    1. Normalize role to its canonical representation.
    2. Inspect model profile and options for context window and max output tokens.
    3. Determine role-specific base defaults for trigger, keep, argument truncation, and headroom.
    4. Apply environment overrides where configured.
    5. Return an immutable WorkingContextPolicy instance.

    Failure cases:
    - Negative or malformed options raise ValueError to fail closed.

    Side effects:
    - Pure calculation; does not mutate the model instance or execute inference calls.
    """
    canonical_role = normalize_working_context_role(role)

    # 1. Inspect model capacity from profile
    profile = getattr(model, "profile", None)
    has_profile = (
        profile is not None
        and isinstance(profile, Mapping)
        and isinstance(profile.get("max_input_tokens"), int)
        and profile["max_input_tokens"] > 0
    )
    max_input_tokens: int | None = profile.get("max_input_tokens") if has_profile else None

    # 2. Inspect options for max_output_tokens and context_window_tokens
    opts = options or getattr(model, "options", None) or {}
    if not isinstance(opts, (dict, Mapping)):
        opts = {}

    configured_output_tokens = opts.get("max_output_tokens")
    if configured_output_tokens is not None and (not isinstance(configured_output_tokens, int) or configured_output_tokens <= 0):
        raise ValueError(f"max_output_tokens must be a positive integer, got {configured_output_tokens!r}")

    context_window_tokens = opts.get("context_window_tokens")
    if context_window_tokens is not None and (not isinstance(context_window_tokens, int) or context_window_tokens <= 0):
        raise ValueError(f"context_window_tokens must be a positive integer, got {context_window_tokens!r}")

    effective_context_window = context_window_tokens or max_input_tokens

    # 3. Base defaults by role
    if canonical_role == ROLE_ASSESSMENT_ROOT:
        base_headroom = 8192
        base_trim = 8192
        base_keep = (KEEP_MODE_MESSAGES, 10)
        base_truncate = {"trigger": ("messages", 20), "keep": ("messages", 10)}
        if has_profile:
            base_trigger = (TRIGGER_MODE_FRACTION, 0.80)
        else:
            base_trigger = (TRIGGER_MODE_TOKENS, 140000)

    elif canonical_role == ROLE_REPOSITORY_RESEARCHER:
        base_headroom = 4096
        base_trim = 4096
        base_keep = (KEEP_MODE_MESSAGES, 6)
        base_truncate = {"trigger": ("messages", 15), "keep": ("messages", 6)}
        if has_profile:
            base_trigger = (TRIGGER_MODE_FRACTION, 0.75)
        else:
            base_trigger = (TRIGGER_MODE_TOKENS, 70000)

    elif canonical_role == ROLE_RULE_SET_PREPARATION:
        base_headroom = 65536
        base_trim = 16384
        base_truncate = {"trigger": ("messages", 30), "keep": ("messages", 15)}
        if has_profile:
            base_trigger = (TRIGGER_MODE_FRACTION, 0.85)
            base_keep = (KEEP_MODE_FRACTION, 0.10)
        else:
            base_trigger = (TRIGGER_MODE_TOKENS, 850000)
            base_keep = (KEEP_MODE_MESSAGES, 15)

    else:  # DEFAULT
        base_headroom = 4096
        base_trim = 4096
        base_keep = (KEEP_MODE_MESSAGES, 10)
        base_truncate = {"trigger": ("messages", 20), "keep": ("messages", 10)}
        if has_profile:
            base_trigger = (TRIGGER_MODE_FRACTION, 0.80)
        else:
            base_trigger = (TRIGGER_MODE_TOKENS, 140000)

    # 4. Adapt output headroom
    output_headroom = base_headroom
    if configured_output_tokens and configured_output_tokens > output_headroom:
        output_headroom = configured_output_tokens

    output_headroom = _parse_positive_int_env("LCSP_WORKING_CONTEXT_OUTPUT_HEADROOM", output_headroom)

    # 5. Environment overrides for trigger/keep
    if base_trigger[0] == TRIGGER_MODE_FRACTION:
        trigger_val = _parse_float_env("LCSP_WORKING_CONTEXT_TRIGGER_FRACTION", float(base_trigger[1]))
        trigger = (TRIGGER_MODE_FRACTION, trigger_val)
    else:
        trigger_val = _parse_positive_int_env("LCSP_WORKING_CONTEXT_TRIGGER_TOKENS", int(base_trigger[1]))
        trigger = (TRIGGER_MODE_TOKENS, trigger_val)

    if base_keep[0] == KEEP_MODE_MESSAGES:
        keep_val = _parse_positive_int_env("LCSP_WORKING_CONTEXT_KEEP_MESSAGES", int(base_keep[1]))
        keep = (KEEP_MODE_MESSAGES, keep_val)
    else:
        keep_val = _parse_float_env("LCSP_WORKING_CONTEXT_KEEP_FRACTION", float(base_keep[1]))
        keep = (KEEP_MODE_FRACTION, keep_val)

    return WorkingContextPolicy(
        role=role,
        trigger=trigger,
        keep=keep,
        truncate_args_settings=base_truncate,
        output_headroom_tokens=output_headroom,
        trim_tokens_to_summarize=base_trim,
        max_working_context_tokens=effective_context_window,
    )


def assert_working_context_authority_preservation(
    summary_text: str,
    original_messages: list[Any],
    *,
    required_pins: Mapping[str, str] | None = None,
) -> bool:
    """Business purpose: Verify that conversation summarization preserves canonical pins and does not fabricate authority.

    Business rules:
    - Summaries are supporting context only; accepted decisions, facts, and repository pins must not be altered.
    - If required pins (such as repository commit SHA or assessment ID) are specified, they must remain uncontradicted.
    - Summary text must be non-empty.

    Execution flow:
    1. Validate that summary_text is a non-empty string.
    2. Check that required canonical pins are preserved when present in original messages.
    3. Return True when authority invariants hold.

    Failure cases:
    - Empty summary text or missing/contradicted pins raise AssertionError.

    Side effects:
    - Read-only inspection; raises AssertionError on invariant violation.
    """
    if not summary_text or not isinstance(summary_text, str) or not summary_text.strip():
        raise AssertionError("summary text must be a non-empty string")

    if required_pins:
        for pin_key, pin_val in required_pins.items():
            # If the pin value appeared in the original messages, verify it didn't get corrupted
            original_has_pin = any(pin_val in getattr(m, "content", "") for m in original_messages if hasattr(m, "content"))
            if original_has_pin and pin_val not in summary_text:
                raise AssertionError(f"required pin {pin_key}={pin_val!r} was evicted or omitted from summary")

    return True
