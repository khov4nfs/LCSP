"""Verified episode data models.

Episodes are reusable examples only. They do not carry factual authority for a
current assessment run.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal


EPISODE_SCHEMA_VERSION = "lcsp.verified_episode.v1"
VERIFIED_EPISODE_VALIDATION_STATUS = "VERIFIED"
VERIFIED_EPISODE_TRUST_LEVEL = "VERIFIED_EXAMPLE"
CAPTURE_PATH_ENV = "LCSP_VERIFIED_EPISODE_CAPTURE_PATH"
RETRIEVAL_ENABLED_ENV = "LCSP_VERIFIED_EPISODE_RETRIEVAL_ENABLED"
STORE_PATH_ENV = "LCSP_VERIFIED_EPISODE_STORE_PATH"
BACKEND_ENV = "LCSP_VERIFIED_EPISODE_BACKEND"


class EpisodeStoreError(RuntimeError):
    """Raised when an episode store operation cannot complete safely."""


VerifiedEpisodeValidationStatus = Literal["VERIFIED"]


@dataclass(frozen=True)
class VerifiedEpisode:
    record_id: str
    owner_agent: str
    workflow_run_id: str | None
    assessment_id: str | None
    user_id: str | None
    engineering_rule_ids: tuple[str, ...]
    artifact_versions: dict[str, str]
    trust_level: str
    validation_status: VerifiedEpisodeValidationStatus
    schema_version: str
    content_hash: str
    domain_key: str
    input_signature: str
    successful_strategy_summary: str
    evidence_refs: tuple[str, ...]
    prompt_version: str
    model_id: str
    summary: str
    handoff: dict[str, Any]
    created_at: str
    expires_at: str | None = None
    status: str = "ACTIVE"

    def to_dict(self) -> dict[str, Any]:
        return {
            "record_id": self.record_id,
            "owner_agent": self.owner_agent,
            "workflow_run_id": self.workflow_run_id,
            "assessment_id": self.assessment_id,
            "user_id": self.user_id,
            "engineering_rule_ids": list(self.engineering_rule_ids),
            "artifact_versions": dict(self.artifact_versions),
            "trust_level": self.trust_level,
            "validation_status": self.validation_status,
            "schema_version": self.schema_version,
            "content_hash": self.content_hash,
            "domain_key": self.domain_key,
            "input_signature": self.input_signature,
            "successful_strategy_summary": self.successful_strategy_summary,
            "evidence_refs": list(self.evidence_refs),
            "prompt_version": self.prompt_version,
            "model_id": self.model_id,
            "summary": self.summary,
            "handoff": self.handoff,
            "created_at": self.created_at,
            "expires_at": self.expires_at,
            "status": self.status,
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "VerifiedEpisode":
        return cls(
            record_id=str(value["record_id"]),
            owner_agent=str(value["owner_agent"]),
            workflow_run_id=optional_str(value.get("workflow_run_id")),
            assessment_id=optional_str(value.get("assessment_id")),
            user_id=optional_str(value.get("user_id")),
            engineering_rule_ids=tuple(
                str(item) for item in value.get("engineering_rule_ids") or ()
            ),
            artifact_versions={
                str(key): str(item)
                for key, item in (value.get("artifact_versions") or {}).items()
            },
            trust_level=normalize_trust_level(value.get("trust_level")),
            validation_status=normalize_validation_status(
                value.get("validation_status")
            ),
            schema_version=str(value.get("schema_version") or EPISODE_SCHEMA_VERSION),
            content_hash=str(value["content_hash"]),
            domain_key=str(value.get("domain_key") or value.get("owner_agent") or ""),
            input_signature=str(value.get("input_signature") or value["content_hash"]),
            successful_strategy_summary=str(
                value.get("successful_strategy_summary")
                or value.get("summary")
                or ""
            ),
            evidence_refs=tuple(str(item) for item in value.get("evidence_refs") or ()),
            prompt_version=str(value.get("prompt_version") or "unknown"),
            model_id=str(value.get("model_id") or "unknown"),
            summary=str(value.get("summary") or ""),
            handoff=dict(value.get("handoff") or {}),
            created_at=str(value["created_at"]),
            expires_at=optional_str(value.get("expires_at")),
            status=str(value.get("status") or "ACTIVE"),
        )

    @property
    def is_active(self) -> bool:
        if self.status != "ACTIVE":
            return False
        if not self.expires_at:
            return True
        return parse_datetime(self.expires_at) > now()


def optional_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def normalize_validation_status(value: Any) -> VerifiedEpisodeValidationStatus:
    text = optional_str(value)
    if text is None:
        raise EpisodeStoreError("verified episode validation_status is required")
    if text == VERIFIED_EPISODE_VALIDATION_STATUS:
        return VERIFIED_EPISODE_VALIDATION_STATUS
    raise EpisodeStoreError("verified episode validation_status must be VERIFIED")


def normalize_trust_level(value: Any) -> str:
    text = optional_str(value)
    if text is None:
        raise EpisodeStoreError("verified episode trust_level is required")
    if text == VERIFIED_EPISODE_TRUST_LEVEL:
        return VERIFIED_EPISODE_TRUST_LEVEL
    raise EpisodeStoreError("verified episode trust_level must be VERIFIED_EXAMPLE")


def now() -> datetime:
    return datetime.now(tz=UTC)


def parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


__all__ = [
    "BACKEND_ENV",
    "CAPTURE_PATH_ENV",
    "EPISODE_SCHEMA_VERSION",
    "EpisodeStoreError",
    "RETRIEVAL_ENABLED_ENV",
    "STORE_PATH_ENV",
    "VERIFIED_EPISODE_VALIDATION_STATUS",
    "VERIFIED_EPISODE_TRUST_LEVEL",
    "VerifiedEpisode",
    "VerifiedEpisodeValidationStatus",
    "now",
    "normalize_validation_status",
    "normalize_trust_level",
    "optional_str",
    "parse_datetime",
]
