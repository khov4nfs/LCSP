"""The canonical Legal Preparation trigger and command boundary."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from legal_preparation.boundary import LEGAL_PREPARATION_COMMAND, LegalPreparationBoundary
from tools.common.capabilities.agent_runtime.boundary import NonRetryableAgentBoundaryError
from tools.common.capabilities.agent_runtime.invocation import AGENT_INVOCATION_BOUNDARIES
from tools.common.capabilities.platform import api_client as api_client_module
from tools.common.capabilities.platform.api_client import WorkerApiClient
from tools.legal.sources.recovery import legal_corpus_recovery_driver as driver_module

CONFIG = SimpleNamespace(nestjs_api_base_url="http://api.invalid", worker_api_key="k" * 40)


def test_command_boundary_is_registered_once_and_bound_to_the_api_event() -> None:
    entries = [b for b in AGENT_INVOCATION_BOUNDARIES if b.source_event == LEGAL_PREPARATION_COMMAND]
    assert [e.name for e in entries] == ["legal_portfolio_preparation_requested"]
    assert LegalPreparationBoundary.source_event == LEGAL_PREPARATION_COMMAND


def test_boundary_runs_one_run_per_message_and_passes_only_the_run_id() -> None:
    calls: list[tuple[Any, str]] = []
    boundary = LegalPreparationBoundary(
        CONFIG,
        api_client="api",
        runner=lambda api, run_id: calls.append((api, run_id)) or {"state": "SUCCEEDED"},
    )
    result = boundary.handle(
        {"preparationRunId": " run-1 ", "legalCorpusVersionId": "ignored", "idempotencyKey": "x"}, "corr"
    )
    assert result == {"state": "SUCCEEDED"} and calls == [("api", "run-1")]


@pytest.mark.parametrize("message", [{}, {"preparationRunId": ""}, {"preparationRunId": 7}])
def test_malformed_command_is_terminal_not_retried(message: dict[str, Any]) -> None:
    boundary = LegalPreparationBoundary(CONFIG, api_client="api", runner=lambda *_: pytest.fail("must not run"))
    with pytest.raises(NonRetryableAgentBoundaryError):
        boundary.handle(message, "corr")


def test_client_posts_unredacted_idempotent_start_to_the_portfolio_route(monkeypatch: pytest.MonkeyPatch) -> None:
    client = WorkerApiClient("http://api.invalid", "k" * 40)
    seen: dict[str, Any] = {}

    def fake_post(path: str, payload: dict, *, redact: bool = True, method: str = "POST") -> dict:
        seen.update(path=str(path), payload=payload, redact=redact)
        return {"preparationRunId": "run-1"}

    monkeypatch.setattr(client, "_post_with_retry", fake_post)
    assert client.start_legal_preparation("corpus-1", "key-1") == {"preparationRunId": "run-1"}
    assert seen == {
        "path": "/internal/legal-portfolio/preparations",
        "payload": {"legalCorpusVersionId": "corpus-1", "idempotencyKey": "key-1"},
        "redact": False,  # hashes/keys inside legal payloads must not be stripped
    }


def test_recovery_driver_starts_preparation_exactly_at_the_validated_index_point() -> None:
    source = (
        __import__("pathlib").Path(driver_module.__file__).read_text(encoding="utf-8")
    )
    index_register = source.index("self._api_client.register_validated_retrieval_index(")
    trigger = source.index("self._api_client.start_legal_preparation(")
    activation = source.index('"activate_validated_corpus_version"', trigger)
    assert source.count("self._api_client.start_legal_preparation(") == 1
    assert index_register < trigger < activation  # after the index is valid, before activation
    assert 'f"{idempotency_key}:legal-preparation:{version}"' in source
