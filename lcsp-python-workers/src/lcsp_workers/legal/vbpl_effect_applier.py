from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any


STATUS_PRECEDENCE = {
    "UNKNOWN": 0,
    "ACTIVE": 1,
    "AMENDED": 2,
    "REPEALED": 3,
}


def apply_effect_observations(
    *,
    normalized_payload_path: Path,
    effect_observations_path: Path,
    output_path: Path,
    propagate_repealed_descendants: bool = True,
) -> Path:
    normalized_payload = json.loads(normalized_payload_path.read_text(encoding="utf-8"))
    effect_payload = json.loads(effect_observations_path.read_text(encoding="utf-8"))
    merged_payload = copy.deepcopy(normalized_payload)
    observations = effect_payload.get("observations")
    if not isinstance(observations, list):
        raise ValueError("Effect observations payload is missing observations")

    observations_by_document = group_observations_by_document(observations)
    summary: dict[str, Any] = {
        "appliedObservationCount": 0,
        "updatedChunkCount": 0,
        "byLegalStatus": {},
        "missingLocators": [],
        "skippedObservations": [],
    }

    for document in merged_payload.get("documents", []):
        if not isinstance(document, dict):
            continue
        document_id = str(document.get("documentId") or "")
        document_observations = observations_by_document.get(document_id, {})
        if not document_observations:
            continue
        chunks = document.get("chunks")
        if not isinstance(chunks, list):
            continue
        chunk_by_locator = {
            str(chunk.get("locator")): chunk
            for chunk in chunks
            if isinstance(chunk, dict) and chunk.get("locator")
        }
        for locator, locator_observations in document_observations.items():
            if not locator:
                summary["skippedObservations"].extend(locator_observations)
                continue
            target_chunks = chunks_for_locator(
                chunk_by_locator,
                locator=locator,
                propagate_repealed_descendants=propagate_repealed_descendants,
                observations=locator_observations,
            )
            if not target_chunks:
                summary["missingLocators"].append(locator)
                continue
            for chunk, inherited_from in target_chunks:
                apply_to_chunk(
                    chunk,
                    observations=locator_observations,
                    inherited_from_locator=inherited_from,
                )
                summary["updatedChunkCount"] += 1
                status = str(chunk.get("legalStatus") or "UNKNOWN")
                summary["byLegalStatus"][status] = (
                    int(summary["byLegalStatus"].get(status, 0)) + 1
                )
            summary["appliedObservationCount"] += len(locator_observations)

    source_manifest = merged_payload.setdefault("sourceManifest", {})
    warnings = source_manifest.setdefault("normalizationWarnings", [])
    if isinstance(warnings, list):
        warnings.append("vbpl_effect_observations_applied")
    source_manifest["effectObservationFile"] = str(effect_observations_path)
    source_manifest["effectObservationSha256"] = file_sha256(effect_observations_path)
    source_manifest["effectObservationSummary"] = effect_payload.get("summary", {})
    source_manifest["effectMergeSummary"] = summary
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(merged_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return output_path


def group_observations_by_document(
    observations: list[Any],
) -> dict[str, dict[str, list[dict[str, Any]]]]:
    grouped: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for observation in observations:
        if not isinstance(observation, dict):
            continue
        document_id = str(observation.get("documentId") or "")
        locator = str(observation.get("locator") or "")
        grouped.setdefault(document_id, {}).setdefault(locator, []).append(observation)
    return grouped


def chunks_for_locator(
    chunk_by_locator: dict[str, dict[str, Any]],
    *,
    locator: str,
    propagate_repealed_descendants: bool,
    observations: list[dict[str, Any]],
) -> list[tuple[dict[str, Any], str | None]]:
    direct = chunk_by_locator.get(locator)
    if direct is None:
        return []
    targets: list[tuple[dict[str, Any], str | None]] = [(direct, None)]
    if not propagate_repealed_descendants:
        return targets
    if strongest_status(observations) != "REPEALED":
        return targets
    descendant_prefix = f"{locator}::"
    for descendant_locator, chunk in chunk_by_locator.items():
        if descendant_locator.startswith(descendant_prefix):
            targets.append((chunk, locator))
    return targets


def apply_to_chunk(
    chunk: dict[str, Any],
    *,
    observations: list[dict[str, Any]],
    inherited_from_locator: str | None,
) -> None:
    status = strongest_status(observations)
    current_status = str(chunk.get("legalStatus") or "ACTIVE")
    if STATUS_PRECEDENCE.get(status, 0) >= STATUS_PRECEDENCE.get(current_status, 0):
        chunk["legalStatus"] = status
    hierarchy = chunk.setdefault("hierarchy", {})
    if not isinstance(hierarchy, dict):
        hierarchy = {}
        chunk["hierarchy"] = hierarchy
    effects = hierarchy.setdefault("legalEffectObservations", [])
    if not isinstance(effects, list):
        effects = []
        hierarchy["legalEffectObservations"] = effects
    for observation in observations:
        effects.append(observation_ref(observation, inherited_from_locator))


def strongest_status(observations: list[dict[str, Any]]) -> str:
    status = "UNKNOWN"
    for observation in observations:
        candidate = str(observation.get("legalStatusCandidate") or "UNKNOWN")
        if STATUS_PRECEDENCE.get(candidate, 0) > STATUS_PRECEDENCE.get(status, 0):
            status = candidate
    return status


def observation_ref(
    observation: dict[str, Any], inherited_from_locator: str | None
) -> dict[str, Any]:
    ref = {
        "locator": observation.get("locator"),
        "effectKind": observation.get("effectKind"),
        "legalStatusCandidate": observation.get("legalStatusCandidate"),
        "htmlId": observation.get("htmlId"),
        "htmlParagraphIndex": observation.get("htmlParagraphIndex"),
        "type": observation.get("type"),
        "newType": observation.get("newType"),
        "textSha256": observation.get("textSha256"),
        "reviewRequired": observation.get("reviewRequired", True),
    }
    if inherited_from_locator is not None:
        ref["inheritedFromLocator"] = inherited_from_locator
    return ref


def file_sha256(path: Path) -> str:
    return f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}"
