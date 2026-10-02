"""Small structured result for the bounded scan-time AI discovery task."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SourceAnchor(BaseModel):
    model_config = ConfigDict(extra="forbid")
    anchor_id: str = Field(max_length=120)
    file_path: str = Field(max_length=1024)
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    symbol_ref: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def validate_anchor(self) -> "SourceAnchor":
        normalized = self.file_path.replace("\\", "/")
        if normalized.startswith("/") or ".." in normalized.split("/"):
            raise ValueError("source anchor file_path must stay inside repository root")
        if self.end_line < self.start_line:
            raise ValueError("source anchor end_line must be >= start_line")
        return self


class AiFinding(BaseModel):
    model_config = ConfigDict(extra="forbid")
    evidence_id: str = Field(max_length=120)
    state: Literal[
        "CONFIRMED_AI_CALL",
        "POSSIBLE_AI_CALL",
        "AI_PROVIDER_REFERENCE",
        "NO_AI_SIGNAL",
        "UNRESOLVED_DYNAMIC",
    ]
    resolution_state: Literal["OBSERVED", "CORROBORATED", "INFERRED", "UNRESOLVED"]
    kind: Literal["SDK_INVOCATION", "OUTBOUND_API", "PROVIDER_REFERENCE", "DYNAMIC_TARGET"]
    provider: str | None = Field(default=None, max_length=120)
    host: str | None = Field(default=None, max_length=240)
    path: str | None = Field(default=None, max_length=1024)
    method: str | None = Field(default=None, max_length=32)
    endpoint_source: str | None = Field(default=None, max_length=240)
    payload_hints: list[str] = Field(default_factory=list, max_length=8)
    runtime_guard: str | None = Field(default=None, max_length=300)
    clarification_owner: Literal["CUSTOMER", "TECHNICAL"] | None = None
    clarification_kind: Literal[
        "AI_PURPOSE_FEATURE_MAPPING",
        "AI_RUNTIME_REACHABILITY",
        "OUTBOUND_AI_CONFIRMATION",
        "TARGETED_TECHNICAL_REANALYSIS",
    ] | None = None
    evidence_refs: list[str] = Field(default_factory=list, max_length=8)
    anchor_id: str | None = Field(default=None, max_length=120)


class AiDiscovery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    gate: Literal["AI_CONFIRMED", "AI_ABSENT_CONFIRMED", "AI_UNKNOWN"]
    coverage_state: Literal["READY", "PARTIAL", "UNAVAILABLE"]
    findings: list[AiFinding] = Field(default_factory=list, max_length=32)
    material_unresolved_frontiers: list[str] = Field(default_factory=list, max_length=16)

    @model_validator(mode="after")
    def validate_absence_gate(self) -> "AiDiscovery":
        if self.gate == "AI_ABSENT_CONFIRMED":
            if self.coverage_state != "READY":
                raise ValueError("AI_ABSENT_CONFIRMED requires READY AI coverage")
            if self.material_unresolved_frontiers:
                raise ValueError(
                    "AI_ABSENT_CONFIRMED cannot carry material unresolved frontiers"
                )
            if any(finding.state != "NO_AI_SIGNAL" for finding in self.findings):
                raise ValueError(
                    "AI_ABSENT_CONFIRMED cannot coexist with positive or unresolved AI signals"
                )
        return self


class RepositoryAnalysisResult(BaseModel):
    """Only the scan contracts still consumed after rule analysis moved per-rule."""

    model_config = ConfigDict(extra="forbid")
    summary: str = Field(max_length=600)
    coverage_state: Literal["READY", "PARTIAL", "UNAVAILABLE"]
    coverage_notes: list[str] = Field(default_factory=list, max_length=16)
    languages: list[str] = Field(default_factory=list, max_length=32)
    frameworks: list[str] = Field(default_factory=list, max_length=32)
    source_anchors: list[SourceAnchor] = Field(default_factory=list, max_length=32)
    ai_discovery: AiDiscovery

    @model_validator(mode="after")
    def validate_result(self) -> "RepositoryAnalysisResult":
        if self.ai_discovery.gate == "AI_ABSENT_CONFIRMED" and self.coverage_state != "READY":
            raise ValueError("AI_ABSENT_CONFIRMED requires READY repository coverage")
        anchor_ids = [anchor.anchor_id for anchor in self.source_anchors]
        if len(anchor_ids) != len(set(anchor_ids)):
            raise ValueError("source anchor ids must be unique")
        known_anchors = set(anchor_ids)
        for finding in self.ai_discovery.findings:
            if finding.anchor_id is not None and finding.anchor_id not in known_anchors:
                raise ValueError(f"AI finding references unknown anchor: {finding.anchor_id}")
        return self


__all__ = ["AiDiscovery", "AiFinding", "RepositoryAnalysisResult", "SourceAnchor"]
