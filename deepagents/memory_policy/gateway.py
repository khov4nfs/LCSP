"""Application-owned verified episode gateway."""

from __future__ import annotations

from hashlib import sha256
from pathlib import Path
from typing import Any
import json
import os

from tools.common.runtime_envelope import TrustedAgenticToolRequest, dispatch_agentic_tool

from .models import (
    BACKEND_ENV,
    CAPTURE_PATH_ENV,
    EPISODE_SCHEMA_VERSION,
    EpisodeStoreError,
    RETRIEVAL_ENABLED_ENV,
    STORE_PATH_ENV,
    VERIFIED_EPISODE_VALIDATION_STATUS,
    VerifiedEpisode,
    now,
)


def _stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def episode_backend() -> str:
    return (os.environ.get(BACKEND_ENV) or "local").strip().lower()


def episode_capture_path() -> Path | None:
    value = os.environ.get(CAPTURE_PATH_ENV) or os.environ.get(STORE_PATH_ENV)
    return Path(value).expanduser() if value else None


def episode_store_path() -> Path | None:
    value = os.environ.get(STORE_PATH_ENV) or os.environ.get(CAPTURE_PATH_ENV)
    return Path(value).expanduser() if value else None


def episode_retrieval_enabled() -> bool:
    return (os.environ.get(RETRIEVAL_ENABLED_ENV) or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


class JsonlVerifiedEpisodeStore:
    """Append-only local JSONL store for development and tests."""

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)

    def append(self, episode: VerifiedEpisode) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(_stable_json(episode.to_dict()) + "\n")

    def read_all(self) -> tuple[VerifiedEpisode, ...]:
        if not self.path.exists():
            return ()
        episodes: list[VerifiedEpisode] = []
        with self.path.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                text = line.strip()
                if not text:
                    continue
                try:
                    episodes.append(VerifiedEpisode.from_dict(json.loads(text)))
                except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
                    raise EpisodeStoreError(
                        f"invalid verified episode at {self.path}:{line_number}"
                    ) from exc
        return tuple(episodes)

    def retrieve(
        self,
        *,
        owner_agent: str,
        assessment_id: str | None = None,
        user_id: str | None = None,
        engineering_rule_ids: tuple[str, ...] = (),
        artifact_versions: dict[str, str] | None = None,
        limit: int = 5,
    ) -> tuple[VerifiedEpisode, ...]:
        expected_versions = artifact_versions or {}
        candidates: list[VerifiedEpisode] = []
        for episode in self.read_all():
            if episode.owner_agent != owner_agent or not episode.is_active:
                continue
            if assessment_id is not None and episode.assessment_id != assessment_id:
                continue
            if user_id is not None and episode.user_id != user_id:
                continue
            if engineering_rule_ids and not set(engineering_rule_ids).issubset(
                set(episode.engineering_rule_ids)
            ):
                continue
            if any(
                episode.artifact_versions.get(key) != value
                for key, value in expected_versions.items()
            ):
                continue
            candidates.append(episode)

        candidates.sort(key=lambda episode: (episode.created_at, episode.record_id))
        return tuple(candidates[: max(0, limit)])


class ApiVerifiedEpisodeGateway:
    """Governed API-backed episode gateway using the internal agentic-tool port."""

    def capture(
        self,
        *,
        episode: VerifiedEpisode,
        user_id: str,
    ) -> VerifiedEpisode:
        request = TrustedAgenticToolRequest(
            assessment_id=episode.assessment_id or "",
            user_id=user_id,
            workflow_run_id=episode.workflow_run_id,
            artifact_versions=episode.artifact_versions,
            input=episode.to_dict(),
        )
        dispatch_agentic_tool("capture_verified_episode", request)
        return episode

    def retrieve(
        self,
        *,
        assessment_id: str,
        user_id: str,
        workflow_run_id: str | None,
        owner_agent: str,
        engineering_rule_ids: tuple[str, ...] = (),
        artifact_versions: dict[str, str] | None = None,
        limit: int = 5,
    ) -> tuple[VerifiedEpisode, ...]:
        request = TrustedAgenticToolRequest(
            assessment_id=assessment_id,
            user_id=user_id,
            workflow_run_id=workflow_run_id,
            artifact_versions=artifact_versions or {},
            input={
                "ownerAgent": owner_agent,
                "engineeringRuleIds": list(engineering_rule_ids),
                "artifactVersions": artifact_versions or {},
                "limit": limit,
            },
        )
        response = dispatch_agentic_tool("retrieve_verified_episodes", request)
        values = response.get("episodes") if isinstance(response, dict) else None
        if not isinstance(values, list):
            return ()
        return tuple(
            VerifiedEpisode.from_dict(item) for item in values if isinstance(item, dict)
        )

    def consolidate(
        self,
        *,
        assessment_id: str,
        user_id: str,
        workflow_run_id: str | None,
        artifact_versions: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        request = TrustedAgenticToolRequest(
            assessment_id=assessment_id,
            user_id=user_id,
            workflow_run_id=workflow_run_id,
            artifact_versions=artifact_versions or {},
            input={},
        )
        return dispatch_agentic_tool("consolidate_verified_episodes", request)


def build_verified_episode(
    *,
    owner_agent: str,
    handoff: dict[str, Any],
    workflow_run_id: str | None = None,
    assessment_id: str | None = None,
    user_id: str | None = None,
    engineering_rule_ids: tuple[str, ...] = (),
    artifact_versions: dict[str, str] | None = None,
    expires_at: str | None = None,
    domain_key: str | None = None,
    input_signature: str | None = None,
    successful_strategy_summary: str | None = None,
    evidence_refs: tuple[str, ...] = (),
    prompt_version: str = "unknown",
    model_id: str = "unknown",
) -> VerifiedEpisode:
    versions = dict(artifact_versions or {})
    summary = _summary_from_handoff(handoff)
    refs = evidence_refs or _evidence_refs_from_handoff(handoff)
    resolved_domain_key = domain_key or _domain_key(owner_agent, engineering_rule_ids)
    hash_input = {
        "owner_agent": owner_agent,
        "engineering_rule_ids": list(engineering_rule_ids),
        "artifact_versions": versions,
        "domain_key": resolved_domain_key,
        "input_signature": input_signature,
        "handoff": handoff,
    }
    content_hash = "sha256:" + sha256(
        _stable_json(hash_input).encode("utf-8")
    ).hexdigest()
    return VerifiedEpisode(
        record_id=f"episode:{content_hash.removeprefix('sha256:')[:24]}",
        owner_agent=owner_agent,
        workflow_run_id=workflow_run_id,
        assessment_id=assessment_id,
        user_id=user_id,
        engineering_rule_ids=engineering_rule_ids,
        artifact_versions=versions,
        trust_level="VERIFIED_EXAMPLE",
        validation_status=VERIFIED_EPISODE_VALIDATION_STATUS,
        schema_version=EPISODE_SCHEMA_VERSION,
        content_hash=content_hash,
        domain_key=resolved_domain_key,
        input_signature=input_signature or content_hash,
        successful_strategy_summary=successful_strategy_summary or summary,
        evidence_refs=refs,
        prompt_version=prompt_version,
        model_id=model_id,
        summary=summary,
        handoff=handoff,
        created_at=now().isoformat().replace("+00:00", "Z"),
        expires_at=expires_at,
    )


def _summary_from_handoff(handoff: dict[str, Any]) -> str:
    status = str(handoff.get("status") or "UNKNOWN")
    if "next_step" in handoff:
        status = f"{status} -> {handoff['next_step']}"
    claims = handoff.get("claims")
    if isinstance(claims, list):
        return f"{status}; claims={len(claims)}"
    scope = handoff.get("selected_scope")
    if isinstance(scope, list):
        return f"{status}; selected_scope={len(scope)}"
    return status


def _domain_key(owner_agent: str, engineering_rule_ids: tuple[str, ...]) -> str:
    rules = ",".join(sorted(engineering_rule_ids))
    return f"{owner_agent}:{rules}" if rules else owner_agent


def _evidence_refs_from_handoff(handoff: dict[str, Any]) -> tuple[str, ...]:
    refs: list[str] = []
    direct = handoff.get("evidence_refs")
    if isinstance(direct, list):
        refs.extend(str(item) for item in direct if str(item).strip())
    claims = handoff.get("claims")
    if isinstance(claims, list):
        for claim in claims:
            if not isinstance(claim, dict):
                continue
            claim_refs = claim.get("evidence_refs")
            if isinstance(claim_refs, list):
                refs.extend(str(item) for item in claim_refs if str(item).strip())
    return tuple(dict.fromkeys(refs))


def capture_verified_episode(
    *,
    owner_agent: str,
    handoff: dict[str, Any],
    workflow_run_id: str | None = None,
    assessment_id: str | None = None,
    user_id: str | None = None,
    engineering_rule_ids: tuple[str, ...] = (),
    artifact_versions: dict[str, str] | None = None,
    domain_key: str | None = None,
    input_signature: str | None = None,
    successful_strategy_summary: str | None = None,
    evidence_refs: tuple[str, ...] = (),
    prompt_version: str | None = None,
    model_id: str | None = None,
) -> VerifiedEpisode | None:
    if not prompt_version:
        raise EpisodeStoreError("verified episode capture requires prompt_version.")
    if not model_id:
        raise EpisodeStoreError("verified episode capture requires model_id.")
    if not successful_strategy_summary:
        raise EpisodeStoreError(
            "verified episode capture requires successful_strategy_summary."
        )
    episode = build_verified_episode(
        owner_agent=owner_agent,
        handoff=handoff,
        workflow_run_id=workflow_run_id,
        assessment_id=assessment_id,
        user_id=user_id,
        engineering_rule_ids=engineering_rule_ids,
        artifact_versions=artifact_versions,
        domain_key=domain_key,
        input_signature=input_signature,
        successful_strategy_summary=successful_strategy_summary,
        evidence_refs=evidence_refs,
        prompt_version=prompt_version,
        model_id=model_id,
    )
    if episode_backend() == "api":
        if not user_id:
            raise EpisodeStoreError("API episode capture requires trusted user_id.")
        return ApiVerifiedEpisodeGateway().capture(episode=episode, user_id=user_id)

    path = episode_capture_path()
    if path is None:
        return None
    JsonlVerifiedEpisodeStore(path).append(episode)
    return episode


def retrieve_verified_episodes_from_gateway(
    *,
    assessment_id: str,
    user_id: str,
    workflow_run_id: str | None,
    owner_agent: str,
    engineering_rule_ids: tuple[str, ...] = (),
    artifact_versions: dict[str, str] | None = None,
    limit: int = 5,
) -> tuple[VerifiedEpisode, ...]:
    if episode_backend() == "api":
        return ApiVerifiedEpisodeGateway().retrieve(
            assessment_id=assessment_id,
            user_id=user_id,
            workflow_run_id=workflow_run_id,
            owner_agent=owner_agent,
            engineering_rule_ids=engineering_rule_ids,
            artifact_versions=artifact_versions,
            limit=limit,
        )

    path = episode_store_path()
    if path is None:
        return ()
    return JsonlVerifiedEpisodeStore(path).retrieve(
        owner_agent=owner_agent,
        assessment_id=assessment_id,
        user_id=user_id,
        engineering_rule_ids=engineering_rule_ids,
        artifact_versions=artifact_versions,
        limit=limit,
    )


def consolidate_verified_episodes(
    *,
    input_path: Path | str,
    output_path: Path | str,
) -> tuple[VerifiedEpisode, ...]:
    """Build a deduplicated active snapshot for background retrieval."""
    store = JsonlVerifiedEpisodeStore(input_path)
    deduped: dict[str, VerifiedEpisode] = {}
    for episode in store.read_all():
        if not episode.is_active:
            continue
        current = deduped.get(episode.content_hash)
        if current is None or episode.created_at > current.created_at:
            deduped[episode.content_hash] = episode
    result = tuple(
        sorted(deduped.values(), key=lambda item: (item.owner_agent, item.record_id))
    )
    snapshot = Path(output_path)
    snapshot.parent.mkdir(parents=True, exist_ok=True)
    with snapshot.open("w", encoding="utf-8") as handle:
        for episode in result:
            handle.write(_stable_json(episode.to_dict()) + "\n")
    return result


__all__ = [
    "ApiVerifiedEpisodeGateway",
    "JsonlVerifiedEpisodeStore",
    "build_verified_episode",
    "capture_verified_episode",
    "consolidate_verified_episodes",
    "episode_backend",
    "episode_capture_path",
    "episode_retrieval_enabled",
    "episode_store_path",
    "retrieve_verified_episodes_from_gateway",
]
