#!/usr/bin/env python3
"""Run bounded OCR fallback from an immutable official snapshot proof."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from lcsp_workers.legal.official_text_extraction import OfficialSourceSnapshotResolver
from lcsp_workers.legal.official_text_extraction_repository import (
    OfficialTextExtractionRepository,
)
from lcsp_workers.legal.ocr_fallback import OcrFallbackRequest, OcrFallbackTool
from lcsp_workers.platform.api_client import WorkerApiClient


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-base-url", required=True)
    parser.add_argument("--worker-api-key", required=True)
    parser.add_argument("--storage-root", required=True, type=Path)
    parser.add_argument("--snapshot-ref", required=True)
    parser.add_argument("--fallback-proof-ref", required=True)
    parser.add_argument("--page", dest="pages", action="append", type=int, required=True)
    parser.add_argument("--ocr-profile", required=True)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--correlation-id", default="local-cli")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    api_client = WorkerApiClient(args.api_base_url, args.worker_api_key)
    tool = OcrFallbackTool(
        snapshot_resolver=OfficialSourceSnapshotResolver(
            api_client=api_client,
            storage_root=args.storage_root,
        ),
        extraction_repository=OfficialTextExtractionRepository(
            storage_root=args.storage_root
        ),
    )
    result = tool.run(
        OcrFallbackRequest(
            snapshot_ref=args.snapshot_ref,
            fallback_proof_ref=args.fallback_proof_ref,
            page_numbers=args.pages,
            ocr_profile=args.ocr_profile,
            output_dir=args.output_dir,
        )
    )
    print(
        json.dumps(
            result.to_tool_response(correlation_id=args.correlation_id),
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
