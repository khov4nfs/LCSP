#!/usr/bin/env python3
"""Validate legal chunk-set integrity against a pinned relationship manifest."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from tools.legal.legal.chunk_integrity_validator import (
    ChunkIntegrityValidator,
    ValidateChunkIntegrityRequest,
)
from tools.legal.legal.legal_chunk_repository import LegalChunkRepository
from tools.legal.legal.chunk_integrity_repository import ChunkIntegrityRepository
from tools.legal.legal.relationship_manifest_repository import (
    RelationshipManifestRepository,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--storage-root", required=True, type=Path)
    parser.add_argument("--chunk-set-ref", required=True)
    parser.add_argument("--relationship-manifest-ref", required=True)
    parser.add_argument("--validation-profile", required=True)
    parser.add_argument("--correlation-id", default="local-cli")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    validator = ChunkIntegrityValidator(
        storage_root=args.storage_root,
        chunk_repository=LegalChunkRepository(storage_root=args.storage_root),
        relationship_repository=RelationshipManifestRepository(
            storage_root=args.storage_root
        ),
    )
    result = validator.validate(
        ValidateChunkIntegrityRequest(
            chunk_set_ref=args.chunk_set_ref,
            relationship_manifest_ref=args.relationship_manifest_ref,
            validation_profile=args.validation_profile,
        )
    )
    if result.status == 'READY':
        ChunkIntegrityRepository(storage_root=args.storage_root).save(result.to_record())
    print(
        json.dumps(
            result.to_tool_response(correlationId=args.correlation_id),
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
