"""Tests for working-context policy resolution, role calibration, and authority preservation."""
from __future__ import annotations

import pytest
from deepagents.backends import StateBackend
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_openai import ChatOpenAI

from middleware.model_governance import governed_summarization_middleware
from middleware.working_context_policy import (
    ROLE_ASSESSMENT_ROOT,
    ROLE_DEFAULT,
    ROLE_REPOSITORY_RESEARCHER,
    ROLE_RULE_SET_PREPARATION,
    TRIGGER_MODE_FRACTION,
    TRIGGER_MODE_TOKENS,
    KEEP_MODE_MESSAGES,
    KEEP_MODE_FRACTION,
    WorkingContextPolicy,
    assert_working_context_authority_preservation,
    normalize_working_context_role,
    resolve_working_context_policy,
)


class DummyModelWithProfile:
    def __init__(self, max_input_tokens: int = 128_000, max_output_tokens: int | None = None):
        self.profile = {"max_input_tokens": max_input_tokens}
        self.options = {"max_output_tokens": max_output_tokens} if max_output_tokens else {}


class DummyModelWithoutProfile:
    def __init__(self):
        self.profile = None
        self.options = {}


def test_normalize_working_context_role():
    assert normalize_working_context_role("assessment-root") == ROLE_ASSESSMENT_ROOT
    assert normalize_working_context_role("assessment_root") == ROLE_ASSESSMENT_ROOT
    assert normalize_working_context_role("ROOT") == ROLE_ASSESSMENT_ROOT
    assert normalize_working_context_role("repository-researcher") == ROLE_REPOSITORY_RESEARCHER
    assert normalize_working_context_role("researcher") == ROLE_REPOSITORY_RESEARCHER
    assert normalize_working_context_role("rule-set-preparation") == ROLE_RULE_SET_PREPARATION
    assert normalize_working_context_role("preparation") == ROLE_RULE_SET_PREPARATION
    assert normalize_working_context_role("unknown-role") == ROLE_DEFAULT
    assert normalize_working_context_role("") == ROLE_DEFAULT


def test_resolve_working_context_policy_role_differences():
    model = DummyModelWithProfile(max_input_tokens=200_000)

    root_policy = resolve_working_context_policy(ROLE_ASSESSMENT_ROOT, model)
    researcher_policy = resolve_working_context_policy(ROLE_REPOSITORY_RESEARCHER, model)
    rsp_policy = resolve_working_context_policy(ROLE_RULE_SET_PREPARATION, model)
    default_policy = resolve_working_context_policy(ROLE_DEFAULT, model)

    # Assessment Root defaults
    assert root_policy.output_headroom_tokens == 8192
    assert root_policy.trigger == (TRIGGER_MODE_FRACTION, 0.80)
    assert root_policy.keep == (KEEP_MODE_MESSAGES, 10)
    assert root_policy.trim_tokens_to_summarize == 8192

    # Researcher defaults
    assert researcher_policy.output_headroom_tokens == 4096
    assert researcher_policy.trigger == (TRIGGER_MODE_FRACTION, 0.75)
    assert researcher_policy.keep == (KEEP_MODE_MESSAGES, 6)
    assert researcher_policy.trim_tokens_to_summarize == 4096

    # RSP defaults
    assert rsp_policy.output_headroom_tokens == 65536
    assert rsp_policy.trigger == (TRIGGER_MODE_FRACTION, 0.85)
    assert rsp_policy.keep == (KEEP_MODE_FRACTION, 0.10)
    assert rsp_policy.trim_tokens_to_summarize == 16384

    # Default
    assert default_policy.output_headroom_tokens == 4096
    assert default_policy.trigger == (TRIGGER_MODE_FRACTION, 0.80)
    assert default_policy.keep == (KEEP_MODE_MESSAGES, 10)


def test_resolve_working_context_policy_without_profile():
    model = DummyModelWithoutProfile()

    root_policy = resolve_working_context_policy(ROLE_ASSESSMENT_ROOT, model)
    assert root_policy.trigger == (TRIGGER_MODE_TOKENS, 140000)
    assert root_policy.keep == (KEEP_MODE_MESSAGES, 10)

    researcher_policy = resolve_working_context_policy(ROLE_REPOSITORY_RESEARCHER, model)
    assert researcher_policy.trigger == (TRIGGER_MODE_TOKENS, 70000)
    assert researcher_policy.keep == (KEEP_MODE_MESSAGES, 6)


def test_resolve_working_context_policy_adapts_output_headroom():
    model = DummyModelWithProfile(max_input_tokens=100_000, max_output_tokens=32768)

    policy = resolve_working_context_policy(ROLE_ASSESSMENT_ROOT, model)
    # Headroom expands to 32768
    assert policy.output_headroom_tokens == 32768


def test_resolve_working_context_policy_malformed_options_fail_closed():
    model = DummyModelWithProfile()

    with pytest.raises(ValueError, match="max_output_tokens must be a positive integer"):
        resolve_working_context_policy(ROLE_ASSESSMENT_ROOT, model, options={"max_output_tokens": -5})

    with pytest.raises(ValueError, match="context_window_tokens must be a positive integer"):
        resolve_working_context_policy(ROLE_ASSESSMENT_ROOT, model, options={"context_window_tokens": "unlimited"})


def test_resolve_working_context_policy_env_overrides(monkeypatch):
    monkeypatch.setenv("LCSP_WORKING_CONTEXT_TRIGGER_FRACTION", "0.65")
    monkeypatch.setenv("LCSP_WORKING_CONTEXT_KEEP_MESSAGES", "4")
    monkeypatch.setenv("LCSP_WORKING_CONTEXT_OUTPUT_HEADROOM", "12000")

    model = DummyModelWithProfile()
    policy = resolve_working_context_policy(ROLE_ASSESSMENT_ROOT, model)

    assert policy.trigger == (TRIGGER_MODE_FRACTION, 0.65)
    assert policy.keep == (KEEP_MODE_MESSAGES, 4)
    assert policy.output_headroom_tokens == 12000


def test_governed_summarization_middleware_integration():
    model = ChatOpenAI(model="gpt-4o", api_key="fake-test-key")
    backend = StateBackend()

    middleware = governed_summarization_middleware(
        model,
        backend=backend,
        role=ROLE_ASSESSMENT_ROOT,
    )

    assert hasattr(middleware, "working_context_policy")
    assert isinstance(middleware.working_context_policy, WorkingContextPolicy)
    assert middleware.working_context_policy.role == ROLE_ASSESSMENT_ROOT
    assert middleware._lc_helper.trigger == middleware.working_context_policy.trigger
    assert middleware._lc_helper.keep == middleware.working_context_policy.keep


def test_assert_working_context_authority_preservation():
    messages = [
        HumanMessage(content="Assess repository at commit a000000000000000000000000000000000000001"),
        AIMessage(content="Accepted fact fact-101 based on Evidence ev-202"),
    ]

    valid_summary = "Repository commit a000000000000000000000000000000000000001 was assessed. Fact fact-101 accepted."
    assert assert_working_context_authority_preservation(
        valid_summary,
        messages,
        required_pins={"commit": "a000000000000000000000000000000000000001"},
    ) is True

    # Empty summary fails
    with pytest.raises(AssertionError, match="summary text must be a non-empty string"):
        assert_working_context_authority_preservation("", messages)

    # Missing required pin fails
    missing_pin_summary = "Repository was assessed without details."
    with pytest.raises(AssertionError, match="required pin commit="):
        assert_working_context_authority_preservation(
            missing_pin_summary,
            messages,
            required_pins={"commit": "a000000000000000000000000000000000000001"},
        )

