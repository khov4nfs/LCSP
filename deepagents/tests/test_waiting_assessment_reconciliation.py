from __future__ import annotations

from orchestration.waiting_assessments import WaitingAssessmentRegistry


def test_waiting_registry_deduplicates_same_assessment_checkpoint(tmp_path) -> None:
    registry = WaitingAssessmentRegistry(storage_root=tmp_path)

    first = registry.register(
        evidence_report_id="ter-1",
        workflow_run_id="scan-1",
        source_correlation_id="corr-1",
    )
    second = registry.register(
        evidence_report_id="ter-1",
        workflow_run_id="scan-1",
        source_correlation_id="corr-2",
    )

    assert first == second
    pending = registry.pending()
    assert len(pending) == 1
    assert pending[0]["evidenceReportId"] == "ter-1"
    assert pending[0]["workflowRunId"] == "scan-1"
    assert pending[0]["sourceCorrelationId"] == "corr-2"


def test_reconcile_all_resumes_every_waiting_assessment_with_fresh_run_ids(tmp_path) -> None:
    registry = WaitingAssessmentRegistry(storage_root=tmp_path)
    registry.register(
        evidence_report_id="ter-1",
        workflow_run_id="scan-1",
        source_correlation_id="corr-1",
    )
    registry.register(
        evidence_report_id="ter-2",
        workflow_run_id="scan-2",
        source_correlation_id="corr-2",
    )

    calls = []
    ids = iter(["resume-run-1", "resume-run-2"])

    def invoke(name, message, correlation_id):
        calls.append((name, message, correlation_id))
        return {"status": "COMPLETED"}

    result = registry.reconcile_all(
        invoker=invoke,
        correlation_id_factory=lambda: next(ids),
    )

    assert result == {
        "status": "COMPLETE",
        "eligibleAssessmentCount": 2,
        "resumedAssessmentCount": 2,
        "deferredAssessmentCount": 0,
    }
    assert calls == [
        (
            "engineering_assessment_requested",
            {"evidenceReportId": "ter-1", "workflowRunId": "scan-1"},
            "resume-run-1",
        ),
        (
            "engineering_assessment_requested",
            {"evidenceReportId": "ter-2", "workflowRunId": "scan-2"},
            "resume-run-2",
        ),
    ]
    assert registry.pending() == []


def test_reconcile_all_requeues_only_failed_assessment_and_continues(tmp_path) -> None:
    registry = WaitingAssessmentRegistry(storage_root=tmp_path)
    registry.register(
        evidence_report_id="ter-fail",
        workflow_run_id="scan-fail",
        source_correlation_id="corr-fail",
    )
    registry.register(
        evidence_report_id="ter-ok",
        workflow_run_id="scan-ok",
        source_correlation_id="corr-ok",
    )

    calls = []

    def invoke(name, message, correlation_id):
        calls.append((name, message, correlation_id))
        if message["evidenceReportId"] == "ter-fail":
            raise RuntimeError("temporary assessment resume failure")
        return {"status": "COMPLETED"}

    result = registry.reconcile_all(
        invoker=invoke,
        correlation_id_factory=lambda: "fresh-resume-run",
    )

    assert result["eligibleAssessmentCount"] == 2
    assert result["resumedAssessmentCount"] == 1
    assert result["deferredAssessmentCount"] == 1
    assert len(calls) == 2
    pending = registry.pending()
    assert len(pending) == 1
    assert pending[0]["evidenceReportId"] == "ter-fail"
    assert pending[0]["workflowRunId"] == "scan-fail"
