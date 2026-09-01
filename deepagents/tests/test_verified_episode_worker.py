from __future__ import annotations

from memory_policy import worker


def test_verified_episode_worker_uses_api_gateway_when_configured(monkeypatch) -> None:
    calls = []

    class Gateway:
        def consolidate(self, **kwargs):
            calls.append(kwargs)
            return {"status": "READY"}

    monkeypatch.setenv("LCSP_VERIFIED_EPISODE_BACKEND", "api")
    monkeypatch.setenv("LCSP_VERIFIED_EPISODE_ASSESSMENT_ID", "assessment-1")
    monkeypatch.setenv("LCSP_VERIFIED_EPISODE_USER_ID", "user-1")
    monkeypatch.setattr(worker, "ApiVerifiedEpisodeGateway", Gateway)

    assert worker.run_verified_episode_consolidation_from_env() == {"status": "READY"}
    assert calls == [
        {
            "assessment_id": "assessment-1",
            "user_id": "user-1",
            "workflow_run_id": None,
        }
    ]
