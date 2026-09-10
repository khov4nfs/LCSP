import httpx
import pytest

from tools.common.capabilities.platform.api_client import (
    InterviewCoverageCallbackError, WorkerApiClient, WorkerCallbackError,
)


@pytest.mark.parametrize("code,expected", [
    ("INTERVIEW_PARTIAL_COVERAGE_LIMITATIONS_REQUIRED", InterviewCoverageCallbackError),
    ("INTERVIEW_TECHNICAL_COVERAGE_UNUSABLE", InterviewCoverageCallbackError),
    ("INTERVIEW_DECISION_STALE_REVISION", WorkerCallbackError),
])
def test_only_coverage_conflicts_are_classified_for_recovery(monkeypatch, code, expected):
    calls = []
    def post(*args, **kwargs):
        calls.append(args)
        return httpx.Response(409, json={"ok": False, "problem": {"code": code}})
    monkeypatch.setattr(httpx, "post", post)
    client = WorkerApiClient("http://api.test", "test-key")
    with pytest.raises(expected) as caught:
        client.post_interview_initial_question("assessment-1", {})
    assert type(caught.value) is expected
    assert len(calls) == 1
