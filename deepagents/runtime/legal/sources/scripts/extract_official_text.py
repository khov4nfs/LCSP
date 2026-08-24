#!/usr/bin/env python3
"""Extract bounded official legal text spans from an immutable snapshot manifest."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from tools.legal.legal.official_text_extraction import (
    OfficialTextExtractionRequest,
    OfficialTextExtractor,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot-ref", required=True)
    parser.add_argument("--extractor-profile", required=True)
    parser.add_argument("--max-pages", required=True, type=int)
    parser.add_argument("--source-manifest", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--correlation-id", required=False, default="local-cli")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = OfficialTextExtractor().extract(
        OfficialTextExtractionRequest(
            snapshot_ref=args.snapshot_ref,
            extractor_profile=args.extractor_profile,
            max_pages=args.max_pages,
            source_manifest_path=args.source_manifest,
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
