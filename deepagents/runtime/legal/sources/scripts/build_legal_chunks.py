#!/usr/bin/env python3
"""Build deterministic legal chunks from an immutable reviewed-input artifact."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from tools.legal.legal.legal_chunk_builder import (
    BuildLegalChunksRequest,
    LegalChunkBuilder,
)
from tools.legal.legal.reviewed_corpus_input_repository import (
    ReviewedCorpusInputRepository,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--storage-root", required=True, type=Path)
    parser.add_argument("--reviewed-input-ref", required=True)
    parser.add_argument("--document-identity-ref", required=True)
    parser.add_argument("--chunk-schema-version", required=True)
    parser.add_argument("--correlation-id", default="local-cli")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    builder = LegalChunkBuilder(
        storage_root=args.storage_root,
        reviewed_input_repository=ReviewedCorpusInputRepository(
            storage_root=args.storage_root
        ),
    )
    from tools.legal.legal.legal_chunk_repository import LegalChunkRepository
    result = builder.build(
        BuildLegalChunksRequest(
            reviewed_input_ref=args.reviewed_input_ref,
            document_identity_ref=args.document_identity_ref,
            chunk_schema_version=args.chunk_schema_version,
        )
    )
    if result.status == 'READY':
        LegalChunkRepository(storage_root=args.storage_root).save(result.to_record())
    print(
        json.dumps(
            result.to_tool_response(correlationId=args.correlation_id),
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
