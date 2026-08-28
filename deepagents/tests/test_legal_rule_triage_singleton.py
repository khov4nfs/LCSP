from __future__ import annotations

from pathlib import Path

from tools.triage.legal_rule_triage.singleton import TriageSingletonCoordinator


def _coordinator(tmp_path: Path) -> TriageSingletonCoordinator:
    return TriageSingletonCoordinator(storage_root=tmp_path)


def _finish_owner(
    owner: TriageSingletonCoordinator,
    execution_id: str,
    legal_rule_ids: list[str],
) -> None:
    owner.set_batch_work(
        execution_id=execution_id,
        legal_rule_ids=legal_rule_ids,
    )
    for legal_rule_id in legal_rule_ids:
        owner.mark_rule_completed(
            execution_id=execution_id,
            legal_rule_id=legal_rule_id,
        )
    assert owner.finish_or_drain(execution_id=execution_id).status == "COMPLETE"


def test_second_request_is_ignored_while_singleton_is_running(tmp_path: Path) -> None:
    owner = _coordinator(tmp_path)
    observer = _coordinator(tmp_path)

    first = owner.submit_or_continue(
        affected_rule_ids=["RULE-1"],
        idempotency_key="manual:assessment-1",
        trigger="MANUAL_ENGINEERING_RULE_NOT_READY",
    )
    assert first.status == "OWNER"
    assert first.affected_rule_ids == ("RULE-1",)
    assert first.execution_id

    owner.set_batch_work(
        execution_id=first.execution_id,
        legal_rule_ids=["RULE-1"],
    )
    state_before = owner.active_status()

    second = observer.submit_or_continue(
        affected_rule_ids=["RULE-2"],
        idempotency_key="manual:assessment-2",
        trigger="MANUAL_ENGINEERING_RULE_NOT_READY",
    )
    state_after = owner.active_status()

    assert second.status == "ALREADY_RUNNING"
    assert second.execution_id == first.execution_id
    assert second.affected_rule_ids == ()
    assert second.full_backlog is False
    assert state_after == state_before
    assert state_after["activeBatchLegalRuleIds"] == ["RULE-1"]
    assert not (tmp_path / "triage-runtime" / "pending").exists()

    owner.mark_rule_completed(
        execution_id=first.execution_id,
        legal_rule_id="RULE-1",
    )
    assert owner.finish_or_drain(execution_id=first.execution_id).status == "COMPLETE"
    assert owner.active_status()["active"] is False


def test_same_rule_request_does_not_modify_active_execution(tmp_path: Path) -> None:
    owner = _coordinator(tmp_path)
    duplicate = _coordinator(tmp_path)

    first = owner.submit_or_continue(
        affected_rule_ids=["RULE-1"],
        idempotency_key="manual:assessment-1",
        trigger="MANUAL_ENGINEERING_RULE_NOT_READY",
    )
    assert first.execution_id
    owner.set_batch_work(
        execution_id=first.execution_id,
        legal_rule_ids=["RULE-1"],
    )
    state_before = owner.active_status()

    repeated = duplicate.submit_or_continue(
        affected_rule_ids=["RULE-1"],
        idempotency_key="manual:assessment-2",
        trigger="MANUAL_ENGINEERING_RULE_NOT_READY",
    )

    assert repeated.status == "ALREADY_RUNNING"
    assert repeated.execution_id == first.execution_id
    assert owner.active_status() == state_before

    owner.mark_rule_completed(
        execution_id=first.execution_id,
        legal_rule_id="RULE-1",
    )
    assert owner.finish_or_drain(execution_id=first.execution_id).status == "COMPLETE"


def test_duplicate_idempotency_key_is_not_persisted_while_running(tmp_path: Path) -> None:
    owner = _coordinator(tmp_path)
    duplicate = _coordinator(tmp_path)

    first = owner.submit_or_continue(
        affected_rule_ids=["RULE-1"],
        idempotency_key="same-key",
        trigger="MANUAL_ENGINEERING_RULE_NOT_READY",
    )
    assert first.execution_id
    owner.set_batch_work(
        execution_id=first.execution_id,
        legal_rule_ids=["RULE-1"],
    )
    active_path = tmp_path / "triage-runtime" / "active.json"
    active_before = active_path.read_text(encoding="utf-8")

    repeated = duplicate.submit_or_continue(
        affected_rule_ids=["RULE-2"],
        idempotency_key="same-key",
        trigger="MANUAL_ENGINEERING_RULE_NOT_READY",
    )
    active_after = active_path.read_text(encoding="utf-8")

    assert repeated.status == "ALREADY_RUNNING"
    assert repeated.execution_id == first.execution_id
    assert active_after == active_before
    assert "RULE-2" not in active_after

    owner.mark_rule_completed(
        execution_id=first.execution_id,
        legal_rule_id="RULE-1",
    )
    assert owner.finish_or_drain(execution_id=first.execution_id).status == "COMPLETE"


def test_scheduled_full_backlog_request_does_not_broaden_running_manual_scope(
    tmp_path: Path,
) -> None:
    owner = _coordinator(tmp_path)
    scheduled = _coordinator(tmp_path)

    first = owner.submit_or_continue(
        affected_rule_ids=["RULE-1"],
        idempotency_key="manual:assessment-1",
        trigger="MANUAL_ENGINEERING_RULE_NOT_READY",
    )
    assert first.execution_id
    owner.set_batch_work(
        execution_id=first.execution_id,
        legal_rule_ids=["RULE-1"],
    )
    state_before = owner.active_status()

    scheduled_attempt = scheduled.submit_or_continue(
        affected_rule_ids=[],
        idempotency_key="scheduled:daily",
        trigger="SCHEDULED",
    )

    assert scheduled_attempt.status == "ALREADY_RUNNING"
    assert scheduled_attempt.execution_id == first.execution_id
    assert scheduled_attempt.full_backlog is False
    assert scheduled_attempt.affected_rule_ids == ()
    assert owner.active_status() == state_before

    owner.mark_rule_completed(
        execution_id=first.execution_id,
        legal_rule_id="RULE-1",
    )
    assert owner.finish_or_drain(execution_id=first.execution_id).status == "COMPLETE"


def test_next_request_may_claim_only_after_current_execution_finishes(tmp_path: Path) -> None:
    coordinator = _coordinator(tmp_path)

    first = coordinator.submit_or_continue(
        affected_rule_ids=["RULE-1"],
        idempotency_key="request-1",
        trigger="MANUAL_ENGINEERING_RULE_NOT_READY",
    )
    assert first.execution_id
    _finish_owner(coordinator, first.execution_id, ["RULE-1"])

    second = coordinator.submit_or_continue(
        affected_rule_ids=["RULE-2"],
        idempotency_key="request-2",
        trigger="MANUAL_ENGINEERING_RULE_NOT_READY",
    )
    try:
        assert second.status == "OWNER"
        assert second.execution_id
        assert second.execution_id != first.execution_id
        assert second.affected_rule_ids == ("RULE-2",)
    finally:
        if second.execution_id:
            coordinator.abandon_execution(execution_id=second.execution_id)
