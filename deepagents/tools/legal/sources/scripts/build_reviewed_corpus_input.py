#!/usr/bin/env python3
"""Build a deterministic immutable reviewed corpus input from passing quality evidence."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from tools.legal.sources.extraction.official_text_extraction_repository import (
    OfficialTextExtractionRepository,
)
from tools.legal.sources.ocr_fallback.ocr_fallback_repository import OcrFallbackRepository
from tools.legal.sources.ocr_quality.ocr_quality_repository import OcrQualityRepository
from tools.legal.corpus.reviewed_input.reviewed_corpus_input_builder import (
    BuildReviewedCorpusInputRequest,
    ReviewedCorpusInputBuilder,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--storage-root", required=True, type=Path)
    parser.add_argument("--extraction-ref", required=True)
    parser.add_argument("--quality-manifest-ref", required=True)
    parser.add_argument("--correction-profile", required=True)
    parser.add_argument("--correlation-id", default="local-cli")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    builder = ReviewedCorpusInputBuilder(
        storage_root=args.storage_root,
        extraction_repository=OfficialTextExtractionRepository(
            storage_root=args.storage_root
        ),
        ocr_repository=OcrFallbackRepository(storage_root=args.storage_root),
        quality_repository=OcrQualityRepository(storage_root=args.storage_root),
    )
    from tools.legal.corpus.reviewed_input.reviewed_corpus_input_repository import ReviewedCorpusInputRepository
    result = builder.build(
        BuildReviewedCorpusInputRequest(
            extraction_ref=args.extraction_ref,
            quality_manifest_ref=args.quality_manifest_ref,
            correction_profile=args.correction_profile,
        )
    )
    if result.status == 'READY':
        ReviewedCorpusInputRepository(storage_root=args.storage_root).save(result.to_record())
    print(
        json.dumps(
            result.to_tool_response(correlationId=args.correlation_id),
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
