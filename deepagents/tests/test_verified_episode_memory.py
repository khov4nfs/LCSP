from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from memory_policy.episodes import (
    EpisodeStoreError,
    JsonlVerifiedEpisodeStore,
    build_verified_episode,
    capture_verified_episode,
    consolidate_verified_episodes,
)
from memory_policy.models import VerifiedEpisode
from orchestration.context import LCSPRunContext
from tools.common.retrieve_verified_episodes.code import retrieve_verified_episodes


def _episode(
    owner: str,
    rule: str,
    *,
    summary: str,
    report: str = "report-1",
    assessment_id: str = "assessment-1",
    user_id: str = "user-1",
):
    return build_verified_episode(
        owner_agent=owner,
        handoff={
            "status": "READY",
            "next_step": "GATE",
            "claims": [],
            "summary": summary,
        },
        workflow_run_id="workflow-1",
        assessment_id=assessment_id,
        user_id=user_id,
        engineering_rule_ids=(rule,),
        artifact_versions={"technicalEvidenceReportId": report},
    )


def test_verified_episode_store_uses_exact_filters(tmp_path) -> None:
    path = tmp_path / "episodes.jsonl"
    store = JsonlVerifiedEpisodeStore(path)
    store.append(_episode("investigator", "ENG-1", summary="human review approval path"))
    store.append(_episode("investigator", "ENG-2", summary="provider invocation path"))
    store.append(_episode("planner", "ENG-1", summary="human review planning seed"))

    result = store.retrieve(
        owner_agent="investigator",
        engineering_rule_ids=("ENG-1",),
        artifact_versions={"technicalEvidenceReportId": "report-1"},
    )

    assert [episode.owner_agent for episode in result] == ["investigator"]
    assert [episode.engineering_rule_ids for episode in result] == [("ENG-1",)]


def test_verified_episode_validation_status_is_literal_verified() -> None:
    episode = _episode("planner", "ENG-1", summary="human review planning seed")
    payload = episode.to_dict()
    payload["validation_status"] = "VALIDATED"

    with pytest.raises(EpisodeStoreError, match="validation_status must be VERIFIED"):
        VerifiedEpisode.from_dict(payload)


def test_verified_episode_missing_trust_metadata_fails_closed() -> None:
    episode = _episode("planner", "ENG-1", summary="human review planning seed")

    missing_status = episode.to_dict()
    missing_status.pop("validation_status")
    with pytest.raises(EpisodeStoreError, match="validation_status is required"):
        VerifiedEpisode.from_dict(missing_status)

    missing_trust = episode.to_dict()
    missing_trust.pop("trust_level")
    with pytest.raises(EpisodeStoreError, match="trust_level is required"):
        VerifiedEpisode.from_dict(missing_trust)


def test_capture_verified_episode_requires_auditable_provenance_metadata() -> None:
    with pytest.raises(EpisodeStoreError, match="requires prompt_version"):
        capture_verified_episode(
            owner_agent="investigator",
            handoff={"status": "DETERMINISTIC_OUTCOME_READY", "claims": []},
            assessment_id="assessment-1",
            user_id="user-1",
        )


def test_retrieve_verified_episodes_tool_is_disabled_by_default(monkeypatch) -> None:
    monkeypatch.delenv("LCSP_VERIFIED_EPISODE_RETRIEVAL_ENABLED", raising=False)

    result = retrieve_verified_episodes.invoke(
        {"owner_agent": "planner"}
    )

    assert result == {
        "status": "DISABLED",
        "episodes": [],
        "limitations": ["RETRIEVAL_DISABLED"],
    }


def test_retrieve_verified_episodes_tool_uses_runtime_exact_filters(
    tmp_path,
    monkeypatch,
) -> None:
    path = tmp_path / "episodes.jsonl"
    store = JsonlVerifiedEpisodeStore(path)
    store.append(_episode("planner", "ENG-1", summary="human review planning seed"))
    store.append(_episode("planner", "ENG-2", summary="provider seed", report="report-2"))
    monkeypatch.setenv("LCSP_VERIFIED_EPISODE_RETRIEVAL_ENABLED", "1")
    monkeypatch.setenv("LCSP_VERIFIED_EPISODE_STORE_PATH", str(path))
    runtime = SimpleNamespace(
        context=LCSPRunContext(
            assessment_id="assessment-1",
            user_id="user-1",
            workflow_run_id="workflow-1",
            engineering_rule_ids=("ENG-1",),
            artifact_versions={"technicalEvidenceReportId": "report-1"},
        )
    )

    result = retrieve_verified_episodes.func(
        runtime,
        owner_agent="planner",
    )

    assert result["status"] == "READY"
    assert [episode["engineering_rule_ids"] for episode in result["episodes"]] == [["ENG-1"]]


def test_retrieve_verified_episodes_tool_does_not_cross_assessment_or_user_scope(
    tmp_path,
    monkeypatch,
) -> None:
    path = tmp_path / "episodes.jsonl"
    store = JsonlVerifiedEpisodeStore(path)
    store.append(
        _episode(
            "planner",
            "ENG-1",
            summary="matching assessment seed",
            assessment_id="assessment-1",
            user_id="user-1",
        )
    )
    store.append(
        _episode(
            "planner",
            "ENG-1",
            summary="other assessment seed",
            assessment_id="assessment-2",
            user_id="user-1",
        )
    )
    store.append(
        _episode(
            "planner",
            "ENG-1",
            summary="other user seed",
            assessment_id="assessment-1",
            user_id="user-2",
        )
    )
    monkeypatch.setenv("LCSP_VERIFIED_EPISODE_RETRIEVAL_ENABLED", "1")
    monkeypatch.setenv("LCSP_VERIFIED_EPISODE_STORE_PATH", str(path))
    runtime = SimpleNamespace(
        context=LCSPRunContext(
            assessment_id="assessment-1",
            user_id="user-1",
            workflow_run_id="workflow-1",
            engineering_rule_ids=("ENG-1",),
            artifact_versions={"technicalEvidenceReportId": "report-1"},
        )
    )

    result = retrieve_verified_episodes.func(runtime, owner_agent="planner")

    assert result["status"] == "READY"
    assert [episode["summary"] for episode in result["episodes"]] == [
        "READY -> GATE; claims=0"
    ]
    assert result["episodes"][0]["handoff"]["summary"] == "matching assessment seed"


def test_consolidator_deduplicates_and_expires_verified_episodes(tmp_path) -> None:
    path = tmp_path / "episodes.jsonl"
    snapshot = tmp_path / "active.jsonl"
    store = JsonlVerifiedEpisodeStore(path)
    active = _episode("investigator", "ENG-1", summary="human review")
    duplicate = _episode("investigator", "ENG-1", summary="human review")
    expired = build_verified_episode(
        owner_agent="investigator",
        handoff={"status": "READY", "claims": [], "summary": "old"},
        engineering_rule_ids=("ENG-2",),
        expires_at=(datetime.now(tz=UTC) - timedelta(days=1)).isoformat(),
    )
    store.append(active)
    store.append(duplicate)
    store.append(expired)

    result = consolidate_verified_episodes(input_path=path, output_path=snapshot)

    assert len(result) == 1
    assert result[0].content_hash == active.content_hash
    assert len(JsonlVerifiedEpisodeStore(snapshot).read_all()) == 1
