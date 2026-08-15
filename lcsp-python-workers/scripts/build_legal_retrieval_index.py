#!/usr/bin/env python3
"""Build a deterministic ChromaDB structure-first legal retrieval index."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from lcsp_workers.legal.chunk_integrity_repository import ChunkIntegrityRepository
from lcsp_workers.legal.legal_chunk_repository import LegalChunkRepository
from lcsp_workers.legal.legal_retrieval_index_builder import (
    BuildLegalRetrievalIndexRequest,
    LegalRetrievalIndexBuilder,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--storage-root", required=True, type=Path)
    parser.add_argument("--chunk-set-ref", required=True)
    parser.add_argument("--integrity-manifest-ref", required=True)
    parser.add_argument("--index-profile", required=True)
    parser.add_argument("--correlation-id", default="local-cli")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    builder = LegalRetrievalIndexBuilder(
        storage_root=args.storage_root,
        chunk_repository=LegalChunkRepository(storage_root=args.storage_root),
        integrity_repository=ChunkIntegrityRepository(storage_root=args.storage_root),
    )
    result = builder.build(
        BuildLegalRetrievalIndexRequest(
            chunk_set_ref=args.chunk_set_ref,
            integrity_manifest_ref=args.integrity_manifest_ref,
            index_profile=args.index_profile,
        )
    )
    print(
        json.dumps(
            result.to_tool_response(correlationId=args.correlation_id),
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
