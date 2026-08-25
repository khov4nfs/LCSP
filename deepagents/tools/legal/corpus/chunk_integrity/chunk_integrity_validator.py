from __future__ import annotations

import json
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Any

from .chunk_integrity_repository import ChunkIntegrityRecord
from tools.legal.corpus.legal_chunks.legal_chunk_builder import _sha256_text
from tools.legal.corpus.legal_chunks.legal_chunk_repository import LegalChunkRepository, LegalChunkSetRecord
from tools.legal.sources.extraction.official_text_extraction import _sha256_bytes
from tools.legal.corpus.relationships.relationship_manifest_repository import (
    RelationshipManifestRecord,
    RelationshipManifestRepository,
)

CHUNK_INTEGRITY_TOOL = {
    "name": "validate_chunk_integrity",
    "version": "1.0.0",
    "config_hash": "sha256:integrity-v1",
}

CHUNK_INTEGRITY_PROFILES = {
    "legal_integrity_v1": "LEGAL_INTEGRITY_V1",
}

CHUNK_INTEGRITY_STATUSES = {
    "ready": "READY",
    "needs_input": "NEEDS_INPUT",
    "conflict": "CONFLICT",
    "blocked": "BLOCKED",
    "failed": "FAILED",
}

CHUNK_INTEGRITY_COVERAGE_STATES = {
    "sufficient": "SUFFICIENT",
    "partial": "PARTIAL",
    "unavailable": "UNAVAILABLE",
}

CHUNK_INTEGRITY_DECISIONS = {
    "pass": "PASS",
    "fail": "FAIL",
    "blocked": "BLOCKED",
}

CHUNK_INTEGRITY_LIMITATION_CODES = {
    "chunk_set_missing": "CHUNK_SET_MISSING",
    "chunk_artifact_missing": "CHUNK_ARTIFACT_MISSING",
    "chunk_manifest_hash_mismatch": "CHUNK_MANIFEST_HASH_MISMATCH",
    "chunk_content_hash_mismatch": "CHUNK_CONTENT_HASH_MISMATCH",
    "duplicate_chunk_id": "DUPLICATE_CHUNK_ID",
    "duplicate_locator": "DUPLICATE_LOCATOR",
    "orphan_parent": "ORPHAN_PARENT",
    "locator_id_mismatch": "LOCATOR_ID_MISMATCH",
    "xref_target_missing": "XREF_TARGET_MISSING",
    "relationship_manifest_missing": "RELATIONSHIP_MANIFEST_MISSING",
    "relationship_chunk_set_mismatch": "RELATIONSHIP_CHUNK_SET_MISMATCH",
    "repeal_target_missing": "REPEAL_TARGET_MISSING",
    "repeal_status_mismatch": "REPEAL_STATUS_MISMATCH",
    "repeal_ref_mismatch": "REPEAL_REF_MISMATCH",
    "legal_effect_status_conflict": "LEGAL_EFFECT_STATUS_CONFLICT",
    "unsupported_source_effect_status": "UNSUPPORTED_SOURCE_EFFECT_STATUS",
}

CHUNK_INTEGRITY_RULES = [
    "HASHES",
    "HIERARCHY",
    "LOCATORS",
    "XREFS",
    "EFFECT_STATUS",
    "REPEAL_MAPPING",
]

SOURCE_EFFECT_STATUSES = {
    "CON_HIEU_LUC",
    "HET_HIEU_LUC_MOT_PHAN",
    "CHUA_CO_HIEU_LUC",
    "NGUNG_HIEU_LUC",
    "HET_HIEU_LUC_TOAN_BO",
    "KHONG_CON_PHU_HOP",
    "UNKNOWN",
}


@dataclass(frozen=True)
class ValidateChunkIntegrityRequest:
    chunk_set_ref: str
    relationship_manifest_ref: str
    validation_profile: str


@dataclass(frozen=True)
class ChunkIntegrityResult:
    status: str
    validation_manifest_ref: str
    validation_manifest_id: str
    chunk_set_ref: str
    relationship_manifest_ref: str
    validation_profile: str
    provenance_ref: str
    coverage_state: str
    evidence_refs: list[str]
    limitations: list[dict[str, Any]]
    decision: str
    checked_rules: list[str]
    finding_refs: list[str]
    manifest_path: Path
    findings_path: Path

    def to_tool_response(self, *, correlationId: str) -> dict[str, Any]:
        return {
            "status": self.status,
            "toolName": CHUNK_INTEGRITY_TOOL["name"],
            "toolVersion": CHUNK_INTEGRITY_TOOL["version"],
            "configHash": CHUNK_INTEGRITY_TOOL["config_hash"],
            "correlationId": correlationId,
            "artifactVersions": {
                "chunkSetId": self.chunk_set_ref.split(":", 1)[1],
                "integrityManifestId": self.validation_manifest_id,
            },
            "provenanceRef": self.provenance_ref,
            "coverageState": self.coverage_state,
            "evidenceRefs": self.evidence_refs,
            "limitations": self.limitations,
            "result": {
                "validationManifestRef": self.validation_manifest_ref,
                "decision": self.decision,
                "checkedRules": self.checked_rules,
                "findingRefs": self.finding_refs,
            },
        }

    def to_record(self) -> ChunkIntegrityRecord:
        return ChunkIntegrityRecord(
            validation_manifest_ref=self.validation_manifest_ref,
            provenance_ref=self.provenance_ref,
            chunk_set_ref=self.chunk_set_ref,
            relationship_manifest_ref=self.relationship_manifest_ref,
            validation_profile=self.validation_profile,
            status=self.status,
            coverage_state=self.coverage_state,
            decision=self.decision,
            checked_rules=self.checked_rules,
            finding_refs=self.finding_refs,
            evidence_refs=self.evidence_refs,
            limitations=self.limitations,
            manifest_path=str(self.manifest_path),
            findings_path=str(self.findings_path),
        )


class ChunkIntegrityValidator:
    def __init__(
        self,
        *,
        storage_root: Path,
        chunk_repository: LegalChunkRepository,
        relationship_repository: RelationshipManifestRepository,
    ) -> None:
        self._storage_root = storage_root
        self._chunk_repository = chunk_repository
        self._relationship_repository = relationship_repository

    def validate(self, request: ValidateChunkIntegrityRequest) -> ChunkIntegrityResult:
        profile = self._normalize_profile(request.validation_profile)
        validation_manifest_id = _validation_manifest_id(
            chunk_set_ref=request.chunk_set_ref,
            relationship_manifest_ref=request.relationship_manifest_ref,
            validation_profile=profile,
        )
        validation_manifest_ref = f"integrity-manifest:{validation_manifest_id}"
        provenance_ref = f"prov:integrity:{validation_manifest_id}"

        chunk_record = self._chunk_repository.get_by_chunk_set_ref(request.chunk_set_ref)
        if chunk_record is None:
            return self._finalize(
                status=CHUNK_INTEGRITY_STATUSES["needs_input"],
                decision=CHUNK_INTEGRITY_DECISIONS["fail"],
                coverage_state=CHUNK_INTEGRITY_COVERAGE_STATES["partial"],
                validation_manifest_id=validation_manifest_id,
                validation_manifest_ref=validation_manifest_ref,
                provenance_ref=provenance_ref,
                request=request,
                findings=[],
                limitations=[
                    _limitation(
                        code=CHUNK_INTEGRITY_LIMITATION_CODES["chunk_set_missing"],
                        scope_ref=request.chunk_set_ref,
                        reason="chunk set record was not found",
                    )
                ],
            )

        relationship_record = self._relationship_repository.get_by_relationship_manifest_ref(
            request.relationship_manifest_ref
        )
        if relationship_record is None:
            return self._finalize(
                status=CHUNK_INTEGRITY_STATUSES["needs_input"],
                decision=CHUNK_INTEGRITY_DECISIONS["fail"],
                coverage_state=CHUNK_INTEGRITY_COVERAGE_STATES["partial"],
                validation_manifest_id=validation_manifest_id,
                validation_manifest_ref=validation_manifest_ref,
                provenance_ref=provenance_ref,
                request=request,
                findings=[],
                limitations=[
                    _limitation(
                        code=CHUNK_INTEGRITY_LIMITATION_CODES[
                            "relationship_manifest_missing"
                        ],
                        scope_ref=request.relationship_manifest_ref,
                        reason="relationship manifest record was not found",
                    )
                ],
            )

        if (
            relationship_record.chunk_set_ref is not None
            and relationship_record.chunk_set_ref != request.chunk_set_ref
        ):
            return self._finalize(
                status=CHUNK_INTEGRITY_STATUSES["needs_input"],
                decision=CHUNK_INTEGRITY_DECISIONS["fail"],
                coverage_state=CHUNK_INTEGRITY_COVERAGE_STATES["partial"],
                validation_manifest_id=validation_manifest_id,
                validation_manifest_ref=validation_manifest_ref,
                provenance_ref=provenance_ref,
                request=request,
                findings=[],
                limitations=[
                    _limitation(
                        code=CHUNK_INTEGRITY_LIMITATION_CODES[
                            "relationship_chunk_set_mismatch"
                        ],
                        scope_ref=request.relationship_manifest_ref,
                        reason="relationship manifest does not belong to the requested chunk set",
                    )
                ],
            )

        chunks, issue = self._load_chunks(chunk_record)
        if issue is not None:
            return self._finalize(
                status=issue["status"],
                decision=issue["decision"],
                coverage_state=issue["coverageState"],
                validation_manifest_id=validation_manifest_id,
                validation_manifest_ref=validation_manifest_ref,
                provenance_ref=provenance_ref,
                request=request,
                findings=[],
                limitations=[issue["limitation"]],
            )

        findings: list[dict[str, Any]] = []
        limitations: list[dict[str, Any]] = []
        chunk_ids = {str(chunk.get("id", "")) for chunk in chunks}
        locator_to_chunk = {str(chunk.get("locator", "")): chunk for chunk in chunks}
        repealed_chunk_ids: set[str] = set()
        seen_chunk_ids: set[str] = set()
        seen_locators: set[str] = set()

        for chunk in chunks:
            chunk_id = str(chunk.get("id", "")).strip()
            locator = str(chunk.get("locator", "")).strip()
            if not chunk_id.endswith(f":{locator}") or str(chunk.get("chunkRef", "")) != f"legal-chunk:{chunk_id}":
                findings.append(
                    _finding(
                        code=CHUNK_INTEGRITY_LIMITATION_CODES["locator_id_mismatch"],
                        reason="chunk id/chunkRef is not consistent with locator",
                        chunk_id=chunk_id or None,
                        locator=locator or None,
                    )
                )
            if chunk_id in seen_chunk_ids:
                findings.append(
                    _finding(
                        code=CHUNK_INTEGRITY_LIMITATION_CODES["duplicate_chunk_id"],
                        reason="duplicate chunk id detected in chunk set artifact",
                        chunk_id=chunk_id or None,
                        locator=locator or None,
                    )
                )
            else:
                seen_chunk_ids.add(chunk_id)
            if locator in seen_locators:
                findings.append(
                    _finding(
                        code=CHUNK_INTEGRITY_LIMITATION_CODES["duplicate_locator"],
                        reason="duplicate locator detected in chunk set artifact",
                        chunk_id=chunk_id or None,
                        locator=locator or None,
                    )
                )
            else:
                seen_locators.add(locator)
            if _sha256_text(str(chunk.get("content", ""))) != str(
                chunk.get("contentSha256", "")
            ):
                findings.append(
                    _finding(
                        code=CHUNK_INTEGRITY_LIMITATION_CODES["chunk_content_hash_mismatch"],
                        reason="chunk content hash does not match stored content",
                        chunk_id=chunk_id or None,
                        locator=locator or None,
                    )
                )
            hierarchy = chunk.get("hierarchy", {})
            parent_chunk_id = hierarchy.get("parentChunkId") if isinstance(hierarchy, dict) else None
            if parent_chunk_id is not None and str(parent_chunk_id) not in chunk_ids:
                findings.append(
                    _finding(
                        code=CHUNK_INTEGRITY_LIMITATION_CODES["orphan_parent"],
                        reason="parent chunk id does not exist in chunk set",
                        chunk_id=chunk_id or None,
                        locator=locator or None,
                    )
                )
            for ref_group in ("outgoingRefIds", "incomingRefIds"):
                refs = chunk.get(ref_group, [])
                if isinstance(refs, list):
                    for ref in refs:
                        ref_value = str(ref)
                        if ref_value not in chunk_ids:
                            findings.append(
                                _finding(
                                    code=CHUNK_INTEGRITY_LIMITATION_CODES[
                                        "xref_target_missing"
                                    ],
                                    reason=f"{ref_group} references a missing chunk id",
                                    chunk_id=chunk_id or None,
                                    locator=locator or None,
                                    target_ref=ref_value,
                                )
                            )
            if str(chunk.get("legalStatus", "ACTIVE")) == "REPEALED":
                repealed_chunk_ids.add(chunk_id)

        status_issue = self._validate_effect_status(
            relationship_record=relationship_record,
            repealed_chunk_ids=repealed_chunk_ids,
        )
        if status_issue is not None:
            limitations.append(status_issue)

        findings.extend(
            self._validate_relationships(
                relationship_record=relationship_record,
                locator_to_chunk=locator_to_chunk,
                chunk_ids=chunk_ids,
            )
        )

        status = CHUNK_INTEGRITY_STATUSES["ready"]
        decision = CHUNK_INTEGRITY_DECISIONS["pass"]
        coverage_state = CHUNK_INTEGRITY_COVERAGE_STATES["sufficient"]
        if limitations:
            status = CHUNK_INTEGRITY_STATUSES["blocked"]
            decision = CHUNK_INTEGRITY_DECISIONS["blocked"]
            coverage_state = CHUNK_INTEGRITY_COVERAGE_STATES["unavailable"]
        elif findings:
            status = CHUNK_INTEGRITY_STATUSES["conflict"]
            decision = CHUNK_INTEGRITY_DECISIONS["fail"]
            coverage_state = CHUNK_INTEGRITY_COVERAGE_STATES["unavailable"]
            limitations = [
                _limitation(
                    code=str(findings[0]["code"]),
                    scope_ref=request.chunk_set_ref,
                    reason=str(findings[0]["reason"]),
                )
            ]

        return self._finalize(
            status=status,
            decision=decision,
            coverage_state=coverage_state,
            validation_manifest_id=validation_manifest_id,
            validation_manifest_ref=validation_manifest_ref,
            provenance_ref=provenance_ref,
            request=request,
            findings=findings,
            limitations=limitations,
        )

    def _normalize_profile(self, profile: str) -> str:
        normalized = profile.strip().upper()
        if normalized != CHUNK_INTEGRITY_PROFILES["legal_integrity_v1"]:
            raise ValueError("unsupported validation profile")
        return normalized

    def _load_chunks(
        self, chunk_record: LegalChunkSetRecord
    ) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        chunks_path = Path(chunk_record.chunks_path)
        manifest_path = Path(chunk_record.manifest_path)
        if not chunks_path.is_file() or not manifest_path.is_file():
            return [], {
                "status": CHUNK_INTEGRITY_STATUSES["needs_input"],
                "decision": CHUNK_INTEGRITY_DECISIONS["fail"],
                "coverageState": CHUNK_INTEGRITY_COVERAGE_STATES["partial"],
                "limitation": _limitation(
                    code=CHUNK_INTEGRITY_LIMITATION_CODES["chunk_artifact_missing"],
                    scope_ref=chunk_record.chunk_set_ref,
                    reason="chunk manifest or chunk payload file is missing from storage",
                ),
            }
        chunks_raw = chunks_path.read_text(encoding="utf-8")
        manifest_raw = manifest_path.read_text(encoding="utf-8")
        if _sha256_bytes(chunks_raw.encode("utf-8")) != chunk_record.chunk_manifest_sha256:
            return [], {
                "status": CHUNK_INTEGRITY_STATUSES["conflict"],
                "decision": CHUNK_INTEGRITY_DECISIONS["fail"],
                "coverageState": CHUNK_INTEGRITY_COVERAGE_STATES["unavailable"],
                "limitation": _limitation(
                    code=CHUNK_INTEGRITY_LIMITATION_CODES["chunk_manifest_hash_mismatch"],
                    scope_ref=chunk_record.chunk_set_ref,
                    reason="chunk payload hash does not match recorded manifest hash",
                ),
            }
        manifest = json.loads(manifest_raw)
        if str(manifest.get("chunkManifestSha256", "")) != chunk_record.chunk_manifest_sha256:
            return [], {
                "status": CHUNK_INTEGRITY_STATUSES["conflict"],
                "decision": CHUNK_INTEGRITY_DECISIONS["fail"],
                "coverageState": CHUNK_INTEGRITY_COVERAGE_STATES["unavailable"],
                "limitation": _limitation(
                    code=CHUNK_INTEGRITY_LIMITATION_CODES["chunk_manifest_hash_mismatch"],
                    scope_ref=chunk_record.chunk_set_ref,
                    reason="chunk manifest metadata does not match recorded payload hash",
                ),
            }
        payload = json.loads(chunks_raw)
        if not isinstance(payload, list):
            raise RuntimeError("chunk payload must be a JSON list")
        return [item for item in payload if isinstance(item, dict)], None

    def _validate_effect_status(
        self,
        *,
        relationship_record: RelationshipManifestRecord,
        repealed_chunk_ids: set[str],
    ) -> dict[str, Any] | None:
        status = relationship_record.source_effect_status.strip().upper()
        if status not in SOURCE_EFFECT_STATUSES:
            return _limitation(
                code=CHUNK_INTEGRITY_LIMITATION_CODES["unsupported_source_effect_status"],
                scope_ref=relationship_record.relationship_manifest_ref,
                reason="relationship manifest contains an unsupported source effect status",
            )
        if status == "UNKNOWN":
            return _limitation(
                code=CHUNK_INTEGRITY_LIMITATION_CODES["legal_effect_status_conflict"],
                scope_ref=relationship_record.relationship_manifest_ref,
                reason="source effect status is UNKNOWN and cannot be activated",
            )
        if status in {"HET_HIEU_LUC_TOAN_BO", "HET_HIEU_LUC_MOT_PHAN"}:
            if not relationship_record.materialized_relationships and not repealed_chunk_ids:
                return _limitation(
                    code=CHUNK_INTEGRITY_LIMITATION_CODES["legal_effect_status_conflict"],
                    scope_ref=relationship_record.relationship_manifest_ref,
                    reason="source effect status conflicts with derived repeal state",
                )
        return None

    def _validate_relationships(
        self,
        *,
        relationship_record: RelationshipManifestRecord,
        locator_to_chunk: dict[str, dict[str, Any]],
        chunk_ids: set[str],
    ) -> list[dict[str, Any]]:
        findings: list[dict[str, Any]] = []
        for relationship in relationship_record.materialized_relationships:
            chunk_ids_in_relationship = relationship.get("materializedChunkIds", [])
            if not isinstance(chunk_ids_in_relationship, list):
                chunk_ids_in_relationship = []
            for chunk_id in chunk_ids_in_relationship:
                chunk_id_value = str(chunk_id)
                if chunk_id_value not in chunk_ids:
                    findings.append(
                        _finding(
                            code=CHUNK_INTEGRITY_LIMITATION_CODES["repeal_target_missing"],
                            reason="materialized relationship references a missing chunk id",
                            chunk_id=chunk_id_value,
                        )
                    )
            for locator, expectation in (
                relationship.get("boundaryAssertions", {}) or {}
            ).items():
                chunk = locator_to_chunk.get(str(locator))
                if chunk is None:
                    findings.append(
                        _finding(
                            code=CHUNK_INTEGRITY_LIMITATION_CODES["repeal_target_missing"],
                            reason="boundary assertion locator is missing from chunk set",
                            locator=str(locator),
                        )
                    )
                    continue
                if (
                    expectation == "ACTIVE_OUTSIDE_REPEAL_RANGE"
                    and str(chunk.get("legalStatus", "ACTIVE")) == "REPEALED"
                ):
                    findings.append(
                        _finding(
                            code=CHUNK_INTEGRITY_LIMITATION_CODES["repeal_status_mismatch"],
                            reason="boundary assertion locator is marked repealed",
                            chunk_id=str(chunk.get("id", "")) or None,
                            locator=str(locator),
                        )
                    )
            ref = {
                "documentId": relationship.get("amendingDocumentId"),
                "locator": relationship.get("amendingLocator"),
            }
            for chunk in locator_to_chunk.values():
                hierarchy = chunk.get("hierarchy", {})
                repealed_by_ref = hierarchy.get("repealedByRef") if isinstance(hierarchy, dict) else None
                if (
                    isinstance(repealed_by_ref, dict)
                    and repealed_by_ref.get("documentId") == ref["documentId"]
                    and repealed_by_ref.get("locator") == ref["locator"]
                    and str(chunk.get("id", "")) not in chunk_ids_in_relationship
                ):
                    findings.append(
                        _finding(
                            code=CHUNK_INTEGRITY_LIMITATION_CODES["repeal_ref_mismatch"],
                            reason="chunk contains repealedByRef but is absent from materialized relationship ids",
                            chunk_id=str(chunk.get("id", "")) or None,
                            locator=str(chunk.get("locator", "")) or None,
                        )
                    )
        return findings

    def _finalize(
        self,
        *,
        status: str,
        decision: str,
        coverage_state: str,
        validation_manifest_id: str,
        validation_manifest_ref: str,
        provenance_ref: str,
        request: ValidateChunkIntegrityRequest,
        findings: list[dict[str, Any]],
        limitations: list[dict[str, Any]],
    ) -> ChunkIntegrityResult:
        output_dir = self._storage_root / "chunk-integrity-manifests" / validation_manifest_id
        output_dir.mkdir(parents=True, exist_ok=True)
        findings_path = output_dir / "findings.json"
        manifest_path = output_dir / "manifest.json"

        finding_refs: list[str] = []
        serialized_findings: list[dict[str, Any]] = []
        for index, finding in enumerate(findings, start=1):
            finding_ref = f"{validation_manifest_ref}:finding:{index}"
            finding_refs.append(finding_ref)
            serialized_findings.append({**finding, "findingRef": finding_ref})

        findings_path.write_text(
            json.dumps(serialized_findings, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        manifest_path.write_text(
            json.dumps(
                {
                    "validationManifestRef": validation_manifest_ref,
                    "provenanceRef": provenance_ref,
                    "chunkSetRef": request.chunk_set_ref,
                    "relationshipManifestRef": request.relationship_manifest_ref,
                    "validationProfile": request.validation_profile,
                    "status": status,
                    "coverageState": coverage_state,
                    "decision": decision,
                    "checkedRules": CHUNK_INTEGRITY_RULES,
                    "findingRefs": finding_refs,
                    "limitations": limitations,
                    "findingsFile": findings_path.name,
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        return ChunkIntegrityResult(
            status=status,
            validation_manifest_ref=validation_manifest_ref,
            validation_manifest_id=validation_manifest_id,
            chunk_set_ref=request.chunk_set_ref,
            relationship_manifest_ref=request.relationship_manifest_ref,
            validation_profile=request.validation_profile,
            provenance_ref=provenance_ref,
            coverage_state=coverage_state,
            evidence_refs=[validation_manifest_ref],
            limitations=limitations,
            decision=decision,
            checked_rules=list(CHUNK_INTEGRITY_RULES),
            finding_refs=finding_refs,
            manifest_path=manifest_path,
            findings_path=findings_path,
        )


def _validation_manifest_id(
    *,
    chunk_set_ref: str,
    relationship_manifest_ref: str,
    validation_profile: str,
) -> str:
    return sha256(
        f"{chunk_set_ref}|{relationship_manifest_ref}|{validation_profile}".encode(
            "utf-8"
        )
    ).hexdigest()[:24]


def _limitation(*, code: str, scope_ref: str | None, reason: str) -> dict[str, Any]:
    return {
        "code": code,
        "affectedScopeRef": scope_ref,
        "reason": reason,
        "retryable": False,
    }


def _finding(
    *,
    code: str,
    reason: str,
    chunk_id: str | None = None,
    locator: str | None = None,
    target_ref: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "code": code,
        "reason": reason,
    }
    if chunk_id is not None:
        payload["chunkId"] = chunk_id
    if locator is not None:
        payload["locator"] = locator
    if target_ref is not None:
        payload["targetRef"] = target_ref
    return payload
