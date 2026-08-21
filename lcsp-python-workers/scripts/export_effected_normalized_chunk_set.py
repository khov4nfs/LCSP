#!/usr/bin/env python3
"""Export a normalized-with-effects preview into chunk-set storage artifacts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from lcsp_workers.legal.vbpl_effected_chunk_set_exporter import export_chunk_set


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--normalized-payload", required=True, type=Path)
    parser.add_argument("--storage-root", required=True, type=Path)
    parser.add_argument("--document-identity-ref", required=True)
    parser.add_argument("--reviewed-input-ref", required=True)
    parser.add_argument("--chunk-set-ref")
    parser.add_argument("--relationship-manifest-ref")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = export_chunk_set(
        normalized_payload_path=args.normalized_payload,
        storage_root=args.storage_root,
        document_identity_ref=args.document_identity_ref,
        reviewed_input_ref=args.reviewed_input_ref,
        chunk_set_ref=args.chunk_set_ref,
        relationship_manifest_ref=args.relationship_manifest_ref,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
