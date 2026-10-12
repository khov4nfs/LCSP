"""The canonical Rule Set Preparation trigger and command boundary."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from rule_set_preparation import runner as runner_module
from rule_set_preparation.boundary import RULE_SET_PREPARATION_COMMAND, RuleSetPreparationBoundary
from tools.common.capabilities.agent_runtime.boundary import NonRetryableAgentBoundaryError
from tools.common.capabilities.agent_runtime.invocation import AGENT_INVOCATION_BOUNDARIES
from tools.common.capabilities.package.contract.api_client_contracts import InternalPath
from tools.common.capabilities.platform.api_client import WorkerApiClient, WorkerCallbackError
from tools.legal.sources.ingest import official_legal_source_acquisition as driver_module

CONFIG = SimpleNamespace(nestjs_api_base_url="http://api.invalid", worker_api_key="k" * 40)


def test_command_boundary_is_registered_once_and_bound_to_the_api_event() -> None:
    entries = [b for b in AGENT_INVOCATION_BOUNDARIES if b.source_event == RULE_SET_PREPARATION_COMMAND]
    assert [e.name for e in entries] == ["rule_set_preparation_requested"]
    assert RuleSetPreparationBoundary.source_event == RULE_SET_PREPARATION_COMMAND


def test_boundary_runs_one_run_per_message_and_passes_only_the_run_id() -> None:
    calls: list[tuple[Any, str]] = []
    boundary = RuleSetPreparationBoundary(
        CONFIG,
        api_client="api",
        runner=lambda api, run_id: calls.append((api, run_id)) or {"state": "SUCCEEDED"},
    )
    result = boundary.handle(
        {"preparationRunId": " run-1 ", "legalSourceVersionId": "ignored", "idempotencyKey": "x"}, "corr"
    )
    assert result == {"state": "SUCCEEDED"} and calls == [("api", "run-1")]


@pytest.mark.parametrize("message", [{}, {"preparationRunId": ""}, {"preparationRunId": 7}])
def test_malformed_command_is_terminal_not_retried(message: dict[str, Any]) -> None:
    boundary = RuleSetPreparationBoundary(CONFIG, api_client="api", runner=lambda *_: pytest.fail("must not run"))
    with pytest.raises(NonRetryableAgentBoundaryError):
        boundary.handle(message, "corr")


def test_worker_has_no_way_to_start_a_preparation() -> None:
    """Only the API's Legal Source activation consumer starts a run; the worker only claims one."""
    assert not hasattr(WorkerApiClient, "start_rule_set_preparation")
    assert not [member for member in InternalPath if "PREPARATIONS" in member.name]
    source = Path(driver_module.__file__).read_text(encoding="utf-8")
    assert "start_rule_set_preparation" not in source
    assert "rule-set-preparation" not in source


class _Api:
    def __init__(self, claim: Any) -> None:
        self._claim = claim
        self.failed: list[tuple[str, str]] = []

    def claim_rule_set_preparation(self, run_id: str) -> dict:
        if isinstance(self._claim, Exception):
            raise self._claim
        return self._claim

    def fail_rule_set_preparation(self, run_id: str, reason: str) -> dict:
        self.failed.append((run_id, reason))
        return {}


def test_a_duplicated_command_is_refused_at_the_claim_and_never_runs_the_agent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A second delivery finds the run claimed (409): no second paid model run, no failure recorded."""
    api = _Api(WorkerCallbackError("conflict", status_code=409))
    monkeypatch.setattr(runner_module, "materialize_legal_source", lambda *_: pytest.fail("must not read the legal_source"))
    monkeypatch.setattr(runner_module, "create_rule_set_preparation_agent", lambda **_: pytest.fail("must not build the agent"))

    result = runner_module.run_rule_set_preparation(api, "run-1")

    assert result == {"state": "ALREADY_CLAIMED", "submission": None, "failureReason": None}
    assert api.failed == []  # the legitimately running claim must not be marked failed


def test_a_claim_that_cannot_reach_the_source_still_fails_the_run() -> None:
    api = _Api(WorkerCallbackError("not found", status_code=404))
    result = runner_module.run_rule_set_preparation(api, "run-1")
    assert result["state"] == "FAILED"
    assert api.failed == [("run-1", "SOURCE_VERSION_UNAVAILABLE")]
