"""Stable immutable cache fingerprints for EngineeringRule compilation."""
from __future__ import annotations
import hashlib, json
from typing import Any

def engineering_rule_fingerprint(*, legal_rule: dict[str, Any], legal_corpus_version_id: str, chunk_hashes: dict[str, str], schema_version: str, prompt_version: str, compiler_version: str) -> str:
    body = {"legalRule": legal_rule, "legalCorpusVersionId": legal_corpus_version_id, "chunkHashes": {k: chunk_hashes[k] for k in sorted(chunk_hashes)}, "schemaVersion": schema_version, "promptVersion": prompt_version, "compilerVersion": compiler_version}
    return "sha256:" + hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()
