"""Stable immutable cache fingerprints for EngineeringRule compilation."""
from __future__ import annotations

import hashlib
import json
from typing import Any


def engineering_rule_fingerprint(
    *,
    legal_rule: dict[str, Any],
    legal_corpus_version_id: str,
    chunk_hashes: dict[str, str],
    schema_version: str,
    prompt_version: str,
    compiler_version: str,
) -> str:
    _ = legal_corpus_version_id
    body = {
        "legalRule": legal_rule,
        "chunkHashes": {key: chunk_hashes[key] for key in sorted(chunk_hashes)},
        "schemaVersion": schema_version,
        "promptVersion": prompt_version,
        "compilerVersion": compiler_version,
    }
    payload = json.dumps(
        body,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode()
    return "sha256:" + hashlib.sha256(payload).hexdigest()
