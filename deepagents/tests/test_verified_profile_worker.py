from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from tools.engineer_rule.intelligence.verified_profile_boundary import (
    PendingConflictsExist,
    VerifiedProfileBoundary,
)
from tools.common.platform.api_client import WorkerCallbackError
from tools.common.platform.callback_schemas import VerifiedProfileCallbackPayload
from tools.common.platform.config import WorkerConfig


def _config() -> WorkerConfig:
    return WorkerConfig(
        nestjs_api_base_url="http://api.test",
        worker_api_key="worker-test-key",
        log_level="INFO",
        max_retries=3,
    )


def _context(*, conflict_status: str = "RESOLVED") -> dict:
    return {
        "ai_usage_flow": {
            "id": "auf-1",
            "ai_usage_flow_id": "auf-1",
            "assessment_id": "assessment-1",
            "organization_id": "org-1",
        },
        "conflicts": [
            {
                "conflict_id": "conflict-1",
                "conflict_type": "evidence_contradiction",
                "status": conflict_status,
                "evidence_refs": ["finding-invocation"],
            }
        ],
        "wizard_profile": {
            "id": "wizard-1",
            "assessment_id": "assessment-1",
            "version": 1,
        },
        "technical_evidence_report_id": "report-1",
    }


@pytest.mark.p0
def test_resolved_conflicts_submit_only_pinned_reconciliation_inputs() -> None:
    api_client = MagicMock()
    api_client.get_verified_profile_reconciliation_context.return_value = _context()
    boundary = VerifiedProfileBoundary(_config(), api_client=api_client)

    boundary.handle(
        {"assessmentId": "assessment-1", "aiUsageFlowId": "auf-1"},
        correlationId="corr-1",
    )

    api_client.get_verified_profile_reconciliation_context.assert_called_once_with(
        "assessment-1", "auf-1"
    )
    api_client.post_verified_profile_callback.assert_called_once()
    payload = api_client.post_verified_profile_callback.call_args.args[0]
    assert isinstance(payload, VerifiedProfileCallbackPayload)
    assert payload.ai_usage_flow_id == "auf-1"
    assert payload.assessment_id == "assessment-1"
    assert payload.organization_id == "org-1"
    assert payload.wizard_profile_id == "wizard-1"
    assert payload.technical_evidence_report_id == "report-1"
    assert payload.reconciliation_decision_refs == ["reconciliation:conflict-1"]
    assert payload.idempotency_key
    serialized = payload.model_dump()
    assert "profile_data" not in serialized
    assert "gates_passed_at" not in serialized
    assert "schema_version" not in serialized
    assert "provider_version" not in serialized


@pytest.mark.p0
def test_pending_conflict_is_requeued_before_persistence_callback() -> None:
    api_client = MagicMock()
    api_client.get_verified_profile_reconciliation_context.return_value = _context(
        conflict_status="PENDING"
    )
    boundary = VerifiedProfileBoundary(_config(), api_client=api_client)

    with pytest.raises(PendingConflictsExist):
        boundary.handle({"assessmentId": "assessment-1"}, correlationId="corr-1")

    api_client.post_verified_profile_callback.assert_not_called()


@pytest.mark.p0
def test_authoritative_command_pending_conflict_error_is_requeued() -> None:
    api_client = MagicMock()
    api_client.get_verified_profile_reconciliation_context.return_value = _context()
    api_client.post_verified_profile_callback.side_effect = WorkerCallbackError(
        "PENDING_CONFLICTS_EXIST"
    )
    boundary = VerifiedProfileBoundary(_config(), api_client=api_client)

    with pytest.raises(PendingConflictsExist):
        boundary.handle({"assessmentId": "assessment-1"}, correlationId="corr-1")


@pytest.mark.p0
def test_conflict_without_identity_fails_closed() -> None:
    api_client = MagicMock()
    context = _context()
    context["conflicts"] = [{"status": "RESOLVED"}]
    api_client.get_verified_profile_reconciliation_context.return_value = context
    boundary = VerifiedProfileBoundary(_config(), api_client=api_client)

    with pytest.raises(ValueError, match="conflict record missing id"):
        boundary.handle({"assessmentId": "assessment-1"}, correlationId="corr-1")

    api_client.post_verified_profile_callback.assert_not_called()
