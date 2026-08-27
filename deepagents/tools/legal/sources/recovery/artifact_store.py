"""File-backed recovery artifacts for legal corpus and EngineeringRule data."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from tools.common.capabilities.platform.config import default_legal_source_storage_root


RECOVERY_ARTIFACT_ROOT = "recovery-artifacts"


def recovery_artifact_root(storage_root: Path | None = None) -> Path:
    """Resolve the durable .corpus recovery artifact directory."""
    root = storage_root
    if root is None:
        raw_env = os.getenv("LEGAL_SOURCE_STORAGE_ROOT")
        root = (
            Path(raw_env.strip())
            if raw_env and raw_env.strip()
            else Path(default_legal_source_storage_root())
        )
    return root.resolve() / RECOVERY_ARTIFACT_ROOT


def write_recovery_artifact(
    category: str,
    name: str,
    payload: dict[str, Any],
    *,
    storage_root: Path | None = None,
) -> Path:
    """Persist one recovery artifact and update the category latest pointer."""
    directory = recovery_artifact_root(storage_root) / _safe_part(category)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{_safe_part(name)}.json"
    enriched = {
        "schemaVersion": "1.0.0",
        "category": category,
        "writtenAt": datetime.now(UTC).isoformat(),
        "payload": payload,
    }
    temporary_path = path.with_suffix(f".{os.getpid()}.tmp")
    encoded = json.dumps(enriched, ensure_ascii=False, sort_keys=True, indent=2)
    temporary_path.write_text(f"{encoded}\n", encoding="utf-8")
    temporary_path.replace(path)
    latest_path = directory / "latest.json"
    latest_path.write_text(f"{encoded}\n", encoding="utf-8")
    return path


def _safe_part(value: str) -> str:
    cleaned = "".join(
        character if character.isalnum() or character in "._:-" else "-"
        for character in value
    ).strip(".")
    return (cleaned or "artifact")[:180]
