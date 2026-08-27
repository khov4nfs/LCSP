"""Restore EngineeringRule cache entries from .corpus recovery artifacts."""

from __future__ import annotations

import json
from typing import Any

from tools.legal.corpus.engineering_rules.contract.models import EngineeringRule
from tools.legal.corpus.engineering_rules.registry.cache import EngineeringRuleCache
from tools.legal.sources.recovery.artifact_store import recovery_artifact_root


def main() -> None:
    artifact_dir = recovery_artifact_root() / "engineering-rules"
    if not artifact_dir.is_dir():
        print("restore complete: engineeringRuleBundles=0")
        return

    cache = EngineeringRuleCache()
    restored = 0
    skipped = 0
    for path in sorted(artifact_dir.glob("*.json")):
        if path.name == "latest.json":
            continue
        artifact = json.loads(path.read_text(encoding="utf-8"))
        payload = _record(artifact.get("payload"))
        if payload is None:
            continue
        fingerprint = _string(payload.get("sourceFingerprint"))
        rules = [
            EngineeringRule.from_dict(rule)
            for rule in payload.get("engineeringRules") or []
            if isinstance(rule, dict)
        ]
        if not fingerprint or not rules:
            skipped += 1
            continue
        try:
            cache.put(fingerprint, rules)
        except Exception as error:
            skipped += 1
            print(f"skipping invalid engineering rule artifact {path}: {error}")
            continue
        restored += 1
    print(
        "restore complete: "
        f"engineeringRuleBundles={restored}, skipped={skipped}"
    )


def _record(value: Any) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def _string(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


if __name__ == "__main__":
    main()
