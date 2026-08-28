from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from tools.triage.legal_rule_triage.service import LegalRuleTriageService
from tools.triage.legal_rule_triage.singleton import TriageSingletonCoordinator


class FakeCoordinator:
    def __init__(self) -> None:
        self.execution_id = "triage:test"
        self.batch_rule_ids: list[str] = []
        self.completed_rule_ids: list[str] = []

    def submit_or_continue(
        self,
        *,
        affected_rule_ids=None,
        idempotency_key=None,
        trigger="LEGAL_MAINTENANCE",
        include_completed=False,
        execution_id=None,
    ):
        _ = idempotency_key, trigger
        values = tuple(str(value) for value in (affected_rule_ids or []))
        return SimpleNamespace(
            status="OWNER",
            execution_id=execution_id or self.execution_id,
            affected_rule_ids=values,
            full_backlog=not bool(values),
            include_completed=include_completed,
        )

    def set_batch_work(self, *, execution_id: str, legal_rule_ids: list[str]) -> None:
        assert execution_id == self.execution_id
        self.batch_rule_ids = list(legal_rule_ids)

    def assert_owner(self, execution_id: str) -> None:
        if execution_id != self.execution_id:
            raise RuntimeError("not singleton owner")

    def mark_rule_completed(self, *, execution_id: str, legal_rule_id: str) -> None:
        self.assert_owner(execution_id)
        self.completed_rule_ids.append(legal_rule_id)
        self.batch_rule_ids = [
            value for value in self.batch_rule_ids if value != legal_rule_id
        ]

    def finish_or_drain(self, *, execution_id: str):
        self.assert_owner(execution_id)
        if self.batch_rule_ids:
            raise RuntimeError("work remains")
        return SimpleNamespace(
            to_dict=lambda: {
                "status": "COMPLETE",
                "triageExecutionId": self.execution_id,
            }
        )


def _api_client() -> MagicMock:
    api = MagicMock()
    api.get_active_legal_rule_catalog.return_value = {
        "versionId": "catalog-v1",
        "rules": [
            {
                "legalRuleId": "RULE-1",
                "status": "APPROVED",
                "citationLocatorRefs": [{"chunkId": "LAW:A1"}],
            },
            {
                "legalRuleId": "RULE-2",
                "status": "APPROVED",
                "citationLocatorRefs": [{"chunkId": "LAW:A2"}],
            },
            {
                "legalRuleId": "RULE-DRAFT",
                "status": "DRAFT",
                "citationLocatorRefs": [{"chunkId": "LAW:A3"}],
            },
        ],
    }
    api.get_active_legal_corpus.return_value = {"versionId": "corpus-v1"}
    api.get_legal_corpus_chunks.return_value = {
        "chunks": [
            {"id": "LAW:A1", "content": "Provider shall maintain human review."},
            {"id": "LAW:A2", "content": "Definition of AI system."},
            {"id": "LAW:A3", "content": "Draft-only text."},
        ]
    }
    return api


def _rule_service() -> MagicMock:
    service = MagicMock()

    def resolve_source_identity(*, legal_rule, legal_corpus_version_id):
        rule_id = str(legal_rule["legalRuleId"])
        chunk_id = str(legal_rule["citationLocatorRefs"][0]["chunkId"])
        return (
            [{"id": chunk_id}],
            f"sha256:{legal_corpus_version_id}:{rule_id}",
        )

    service.resolve_source_identity.side_effect = resolve_source_identity
    return service


def _service(**kwargs) -> LegalRuleTriageService:
    return LegalRuleTriageService(
        coordinator=kwargs.pop("coordinator", FakeCoordinator()),
        **kwargs,
    )


def test_work_items_include_only_approved_rules_and_exact_chunks() -> None:
    service = _service(
        api_client=_api_client(),
        retriever=MagicMock(),
        rule_service=_rule_service(),
        triage_completion_lookup=lambda _fingerprint: False,
    )

    result = service.get_work_items()

    assert result["triageExecutionId"] == "triage:test"
    assert result["legalRuleCatalogVersionId"] == "catalog-v1"
    assert result["legalCorpusVersionId"] == "corpus-v1"
    assert [item["legalRuleId"] for item in result["workItems"]] == [
        "RULE-1",
        "RULE-2",
    ]
    assert result["workItems"][0]["legalContext"] == [
        {"id": "LAW:A1", "content": "Provider shall maintain human review."}
    ]
    assert all(item["readyForTriage"] for item in result["workItems"])
    assert result["pendingRuleCount"] == 2
    assert result["completedRuleCount"] == 0


def test_work_items_can_be_bounded_to_affected_rule_ids() -> None:
    service = _service(
        api_client=_api_client(),
        retriever=MagicMock(),
        rule_service=_rule_service(),
        triage_completion_lookup=lambda _fingerprint: False,
    )

    result = service.get_work_items(affected_rule_ids=["RULE-2"])

    assert [item["legalRuleId"] for item in result["workItems"]] == ["RULE-2"]
    assert result["workItems"][0]["sourceChunkIds"] == ["LAW:A2"]


def test_completed_work_items_are_skipped_by_default() -> None:
    service = _service(
        api_client=_api_client(),
        retriever=MagicMock(),
        rule_service=_rule_service(),
        triage_completion_lookup=lambda fingerprint: fingerprint.endswith(":RULE-1"),
    )

    result = service.get_work_items()

    assert [item["legalRuleId"] for item in result["workItems"]] == ["RULE-2"]
    assert result["completedRuleCount"] == 1
    assert result["pendingRuleCount"] == 1


def test_completed_work_items_can_be_included_for_explicit_review() -> None:
    service = _service(
        api_client=_api_client(),
        retriever=MagicMock(),
        rule_service=_rule_service(),
        triage_completion_lookup=lambda fingerprint: fingerprint.endswith(":RULE-1"),
    )

    result = service.get_work_items(include_completed=True)

    assert [item["legalRuleId"] for item in result["workItems"]] == [
        "RULE-1",
        "RULE-2",
    ]
    assert result["workItems"][0]["triageCompleted"] is True
    assert result["workItems"][1]["triageCompleted"] is False
    assert result["completedRuleCount"] == 1


def test_work_item_marks_missing_citation_chunk_not_ready() -> None:
    api = _api_client()
    api.get_active_legal_rule_catalog.return_value["rules"] = [
        {
            "legalRuleId": "RULE-MISSING",
            "status": "APPROVED",
            "citationLocatorRefs": [{"chunkId": "LAW:UNKNOWN"}],
        }
    ]
    service = _service(
        api_client=api,
        retriever=MagicMock(),
        rule_service=MagicMock(),
    )

    result = service.get_work_items()

    assert result["workItems"][0]["readyForTriage"] is False
    assert result["workItems"][0]["missingChunkIds"] == ["LAW:UNKNOWN"]


def test_running_singleton_returns_without_loading_legal_sources() -> None:
    coordinator = FakeCoordinator()
    coordinator.submit_or_continue = MagicMock(
        return_value=SimpleNamespace(
            status="ALREADY_RUNNING",
            execution_id="triage:active",
            affected_rule_ids=(),
            full_backlog=False,
            include_completed=False,
        )
    )
    api = _api_client()
    service = _service(
        api_client=api,
        retriever=MagicMock(),
        rule_service=_rule_service(),
        coordinator=coordinator,
    )

    result = service.get_work_items(
        affected_rule_ids=["RULE-2"],
        idempotency_key="manual:assessment-2",
    )

    assert result == {
        "status": "ALREADY_RUNNING",
        "triageExecutionId": "triage:active",
        "workItems": [],
        "limitations": ["TRIAGE_SINGLETON_ACTIVE"],
    }
    api.get_active_legal_rule_catalog.assert_not_called()


def test_real_singleton_does_not_queue_or_merge_requests_while_running(tmp_path) -> None:
    owner = TriageSingletonCoordinator(storage_root=tmp_path)
    observer = TriageSingletonCoordinator(storage_root=tmp_path)

    first = owner.claim_or_observe(
        affected_rule_ids=["RULE-1"],
        idempotency_key="request-1",
        trigger="MANUAL_ENGINEERING_RULE_NOT_READY",
    )
    assert first.status == "OWNER"
    assert first.execution_id

    state_before = observer.active_status()
    second = observer.claim_or_observe(
        affected_rule_ids=["RULE-2"],
        idempotency_key="request-2",
        trigger="MANUAL_ENGINEERING_RULE_NOT_READY",
    )
    state_after = observer.active_status()

    assert second.status == "ALREADY_RUNNING"
    assert second.execution_id == first.execution_id
    assert second.affected_rule_ids == ()
    assert state_after == state_before
    assert not (tmp_path / "triage-runtime" / "pending").exists()

    owner.set_batch_work(execution_id=first.execution_id, legal_rule_ids=[])
    completed = owner.finish_or_drain(execution_id=first.execution_id)
    assert completed.status == "COMPLETE"
    assert observer.active_status()["status"] == "IDLE"


def test_next_request_can_claim_after_active_singleton_finishes(tmp_path) -> None:
    coordinator = TriageSingletonCoordinator(storage_root=tmp_path)
    first = coordinator.claim_or_observe(
        affected_rule_ids=["RULE-1"],
        idempotency_key="request-1",
        trigger="LEGAL_MAINTENANCE",
    )
    assert first.execution_id
    coordinator.set_batch_work(execution_id=first.execution_id, legal_rule_ids=[])
    coordinator.finish_or_drain(execution_id=first.execution_id)

    second = coordinator.claim_or_observe(
        affected_rule_ids=["RULE-2"],
        idempotency_key="request-2",
        trigger="MANUAL_ENGINEERING_RULE_NOT_READY",
    )
    try:
        assert second.status == "OWNER"
        assert second.execution_id != first.execution_id
        assert second.affected_rule_ids == ("RULE-2",)
    finally:
        if second.execution_id:
            coordinator.abandon_execution(execution_id=second.execution_id)


def test_persist_rejects_stale_catalog_or_corpus_version() -> None:
    service = _service(
        api_client=_api_client(),
        retriever=MagicMock(),
        rule_service=MagicMock(),
    )

    with pytest.raises(ValueError, match="stale LegalRule catalog"):
        service.persist_result(
            triage_execution_id="triage:test",
            legal_rule_id="RULE-1",
            legal_rule_catalog_version_id="catalog-old",
            legal_corpus_version_id="corpus-v1",
            chunk_analyses=[{"chunkId": "LAW:A1"}],
            engineering_rules=[],
            workflow_run_id="triage-run-1",
        )

    with pytest.raises(ValueError, match="stale legal corpus"):
        service.persist_result(
            triage_execution_id="triage:test",
            legal_rule_id="RULE-1",
            legal_rule_catalog_version_id="catalog-v1",
            legal_corpus_version_id="corpus-old",
            chunk_analyses=[{"chunkId": "LAW:A1"}],
            engineering_rules=[],
            workflow_run_id="triage-run-1",
        )


def test_persist_routes_agent_decisions_through_preparation_gate() -> None:
    api = _api_client()
    retriever = MagicMock()
    rule_service = MagicMock()
    coordinator = FakeCoordinator()
    prepared_rule = MagicMock(engineering_rule_id="RULE-1::ENG::1")
    rule_service.prepare_from_triage.return_value = ([prepared_rule], False)
    service = _service(
        api_client=api,
        retriever=retriever,
        rule_service=rule_service,
        coordinator=coordinator,
    )
    coordinator.batch_rule_ids = ["RULE-1"]
    analyses = [
        {
            "chunkId": "LAW:A1",
            "verdict": "ENGINEERING_RULE_CANDIDATE",
            "reason": "Concrete human-review obligation.",
            "engineeringObligation": "Maintain human review.",
            "verificationTargets": ["human review"],
        }
    ]
    proposals = [{"concept": "HUMAN_OVERSIGHT"}]

    result = service.persist_result(
        triage_execution_id="triage:test",
        legal_rule_id="RULE-1",
        legal_rule_catalog_version_id="catalog-v1",
        legal_corpus_version_id="corpus-v1",
        chunk_analyses=analyses,
        engineering_rules=proposals,
        workflow_run_id="triage-run-1",
        correlation_id="corr-1",
    )

    retriever.index_corpus.assert_called_once()
    rule_service.prepare_from_triage.assert_called_once()
    call = rule_service.prepare_from_triage.call_args.kwargs
    assert call["legal_rule"]["legalRuleId"] == "RULE-1"
    assert call["chunk_analyses"] == analyses
    assert call["engineering_rule_rows"] == proposals
    assert result["engineeringRuleIds"] == ["RULE-1::ENG::1"]
    assert coordinator.completed_rule_ids == ["RULE-1"]
