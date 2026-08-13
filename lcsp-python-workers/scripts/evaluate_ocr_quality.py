#!/usr/bin/env python3
"""Evaluate deterministic OCR/canonical extraction quality for legal corpus recovery."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from lcsp_workers.legal.official_text_extraction_repository import (
    OfficialTextExtractionRepository,
)
from lcsp_workers.legal.ocr_fallback_repository import OcrFallbackRepository
from lcsp_workers.legal.ocr_quality_validator import (
    EvaluateOcrQualityRequest,
    OcrQualityValidator,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--storage-root", required=True, type=Path)
    parser.add_argument("--extraction-ref", required=True)
    parser.add_argument("--expected-identity-ref", required=True)
    parser.add_argument("--quality-profile", required=True)
    parser.add_argument("--correlation-id", default="local-cli")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    validator = OcrQualityValidator(
        storage_root=args.storage_root,
        extraction_repository=OfficialTextExtractionRepository(
            storage_root=args.storage_root
        ),
        ocr_repository=OcrFallbackRepository(storage_root=args.storage_root),
    )
    result = validator.evaluate(
        EvaluateOcrQualityRequest(
            extraction_ref=args.extraction_ref,
            expected_identity_ref=args.expected_identity_ref,
            quality_profile=args.quality_profile,
        )
    )
    print(
        json.dumps(
            result.to_tool_response(correlationId=args.correlationId),
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
