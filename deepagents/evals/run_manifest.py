"""Immutable run-local fingerprints for actual LCSP model-facing prompts and tools.

No response bodies, secrets, source text, or guessed spend are stored here. This
receipt is evidence of *which configuration ran*, never legal acceptance.
"""
from __future__ import annotations

from hashlib import sha256
import json
import os
from pathlib import Path
from typing import Any, Mapping, Iterable


def digest(value: bytes | str) -> str:
    """Business purpose:
    Hash user-independent runtime material with SHA-256.

    Business rules:
    - Accept only exact bytes or UTF-8 text.

    Execution flow:
    1. Normalize inputs to bytes and compute the content hash.

    Failure cases:
    - Incorrect input types propagate an exception.

    Side effects:
    - Pure computation; no files or network access."""
    payload = value.encode("utf-8") if isinstance(value, str) else value
    return sha256(payload).hexdigest()


def stable_hash(value: Any) -> str:
    """Business purpose:
    Fingerprint structured manifests with stable JSON ordering.

    Business rules:
    - Preserve all semantic keys and values; exclude presentation whitespace.

    Execution flow:
    1. Serialize with sorted compact JSON then hash.

    Failure cases:
    - Unsupported JSON values raise; never coerce to repr.

    Side effects:
    - Pure computation without model calls."""
    return digest(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False))


def model_identity(model: Any) -> dict[str, str | None]:
    """Business purpose:
    Identify the configured adapter/model without exposing secrets.

    Business rules:
    - Never stringify a model object or read credential-bearing fields.

    Execution flow:
    1. Read known public model ID attributes, otherwise record unknown.

    Failure cases:
    - Absent model ID is explicit null, never guessed.

    Side effects:
    - Pure read of bounded model metadata."""
    for key in ("model_name", "model", "model_id", "deployment_name"):
        value = getattr(model, key, None)
        if isinstance(value, str) and value.strip():
            return {"configuredModelId": value.strip(), "adapterClass": type(model).__name__}
    return {"configuredModelId": None, "adapterClass": type(model).__name__}


def checked_in_skill_hashes(names: Iterable[str], locale: str, root: Path) -> dict[str, str]:
    """Business purpose:
    Pin the exact allowlisted skill instructions for the selected language.

    Business rules:
    - Reject unknown names, locale fallback and missing/blank skill bodies.

    Execution flow:
    1. Read named skill files and fingerprint their stripped bytes.

    Failure cases:
    - Missing or invalid skill sources fail closed.

    Side effects:
    - Reads trusted packaged files only."""
    if locale not in {"en", "vi"}:
        raise ValueError("UNSUPPORTED_MANIFEST_LOCALE")
    from runtime_instruction_bundle import production_runtime_bundle
    bundle = production_runtime_bundle()
    hashes: dict[str, str] = {}
    for name in sorted(set(names)):
        if not name or "/" in name or "\\" in name or ".." in name:
            raise ValueError("INVALID_MANIFEST_SKILL")
        payload = bundle.instruction("skill." + name).encode("utf-8")
        if not payload.strip():
            raise ValueError("EMPTY_MANIFEST_SKILL")
        hashes[name] = digest(payload)
    return hashes


def build_runtime_manifest(
    *,
    run_id: str,
    component: str,
    locale: str,
    model: Any,
    prompts: Mapping[str, str],
    tools: Iterable[Any],
    skill_hashes: Mapping[str, str],
    pins: Mapping[str, str],
    gold_revision: str | None = None,
) -> dict[str, Any]:
    """Business purpose:
    Record hashes for actually resolved model-facing configuration.

    Business rules:
    - Pins and prompt/tool/skill metadata are required and schema stable.

    Execution flow:
    1. Hash resolved prompt bodies, tool descriptions and checked-in skill text.

    Failure cases:
    - Missing pins, invalid locale or duplicate tools fail closed.

    Side effects:
    - Returns immutable metadata without writing inputs."""
    if not run_id or not component or locale not in {"en", "vi"}:
        raise ValueError("MANIFEST_IDENTITY_REQUIRED")
    if not prompts or not pins or any(not key or not value for key, value in pins.items()):
        raise ValueError("MANIFEST_MISSING_PIN_OR_PROMPT")
    prompt_hashes = {name: digest(content) for name, content in sorted(prompts.items())}
    tool_hashes: dict[str, str] = {}
    for tool in tools:
        name, description = getattr(tool, "name", None), getattr(tool, "description", None)
        if not isinstance(name, str) or not isinstance(description, str):
            raise ValueError("MANIFEST_TOOL_DESCRIPTION_MISSING")
        if name in tool_hashes:
            raise ValueError("MANIFEST_DUPLICATE_TOOL_NAME")
        tool_hashes[name] = digest(description)
    payload: dict[str, Any] = {
        "schemaVersion": "LCSP_MODEL_FACING_MANIFEST_V1",
        "runId": run_id,
        "component": component,
        "responseLanguage": locale,
        "model": model_identity(model),
        "promptsSha256": prompt_hashes,
        "toolDescriptionsSha256": dict(sorted(tool_hashes.items())),
        "availableSkillsSha256": dict(sorted(skill_hashes.items())),
        "sourcePins": dict(sorted(pins.items())),
        "goldReviewerRevision": gold_revision,
        "selectedSkillsSha256": {},
        "usage": {
            "physicalAttempts": None, "failedAttempts": None,
            "inputTokens": None, "cachedInputTokens": None,
            "outputTokens": None, "providerCost": None,
            "costCurrency": None,
        },
        "semanticAcceptance": "NOT_ESTABLISHED_BY_FINGERPRINT",
    }
    from runtime_instruction_bundle import production_runtime_bundle
    bundle = production_runtime_bundle()
    payload["instructionBundle"] = {
        "id": bundle.bundle_id,
        "viSourceInventoryDigest": bundle.vietnamese_inventory_sha256,
        "enRuntimeBundleDigest": bundle.english_bundle_sha256,
        "approvalRevision": bundle.approval_revision,
        "approvalIdentity": bundle.approval_identity,
        "viSourceRevisions": {key: entry.vietnamese_source_revision for key, entry in bundle.entries.items()},
    }
    return {**payload, "manifestSha256": stable_hash(payload)}


def settle_runtime_manifest(
    manifest: Mapping[str, Any], *,
    selected_skill_hashes: Mapping[str, str] | None = None,
    usage: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Business purpose:
    Attach selected skills and reported measured usage to a frozen configuration.

    Business rules:
    - Skill versions cannot change mid-run; cost must be supplied by a journal.

    Execution flow:
    1. Verify selected digests and merge only declared usage fields.

    Failure cases:
    - Drifted skill or unexpected usage fields reject settlement.

    Side effects:
    - Pure result generation; no billed usage is fabricated."""
    baseline = {k: v for k, v in manifest.items() if k != "manifestSha256"}
    skills = selected_skill_hashes or {}
    allowed = baseline["availableSkillsSha256"]
    if any(allowed.get(name) != value for name, value in skills.items()):
        raise ValueError("MANIFEST_SKILL_CHANGED_DURING_RUN")
    baseline["selectedSkillsSha256"] = dict(sorted(skills.items()))
    if usage is not None:
        valid = set(baseline["usage"])
        if set(usage) - valid:
            raise ValueError("MANIFEST_UNKNOWN_USAGE_FIELDS")
        baseline["usage"] = {**baseline["usage"], **usage}
    return {**baseline, "manifestSha256": stable_hash(baseline)}


def save_runtime_manifest(path: Path, manifest: Mapping[str, Any]) -> None:
    """Business purpose:
    Persist one replay-safe evaluation receipt on disk.

    Business rules:
    - Manifest digest must match; existing bytes cannot be overwritten.

    Execution flow:
    1. Validate integrity, create file exclusively and fsync contents.

    Failure cases:
    - Conflicting replay or invalid hash raises an exception.

    Side effects:
    - Writes one local immutable metadata file."""
    expected = manifest.get("manifestSha256")
    payload = {key: val for key, val in manifest.items() if key != "manifestSha256"}
    if not isinstance(expected, str) or expected != stable_hash(payload):
        raise ValueError("MANIFEST_DIGEST_MISMATCH")
    raw = (json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        handle = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        if path.read_bytes() != raw:
            raise ValueError("MANIFEST_REPLAY_CONFLICT")
        return
    try:
        with os.fdopen(handle, "wb") as out:
            out.write(raw)
            out.flush()
            os.fsync(out.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise
