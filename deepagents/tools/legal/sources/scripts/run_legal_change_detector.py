#!/usr/bin/env python3
"""Run Legal Change Detector manually to test Partial Update Context building."""

import argparse
import json
from pathlib import Path

from tools.legal.corpus.partial_update.partial_update_context_builder import build_partial_update_context


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--document-id", required=True, type=str, help="e.g. LAW-134-2025-QH15")
    parser.add_argument("--old-html", required=True, type=Path, help="Path to old HTML file")
    parser.add_argument("--new-html", required=True, type=Path, help="Path to new HTML file")
    parser.add_argument("--output", required=False, type=Path, help="Path to save PartialUpdateContext JSON")
    return parser.parse_args()


def main():
    args = parse_args()

    document_id = args.document_id
    
    try:
        old_html_content = args.old_html.read_text(encoding="utf-8")
        new_html_content = args.new_html.read_text(encoding="utf-8")
    except Exception as e:
        print(f"Error reading HTML files: {e}")
        return

    print(f"Detecting changes for document: {document_id}")
    
    context = build_partial_update_context(
        document_id=document_id,
        source_url="http://mock-url",
        base_snapshot_ref="snapshot-old-mock",
        new_snapshot_ref="snapshot-new-mock",
        old_html=old_html_content,
        new_html=new_html_content,
    )

    if context:
        print("\n--- Partial Update Context Built Successfully ---")
        json_output = context.to_json()
        print(json_output)
        
        if args.output:
            args.output.write_text(json_output, encoding="utf-8")
            print(f"\nSaved output to {args.output}")
    else:
        print("\nNo changes or legal effects detected.")


if __name__ == "__main__":
    main()
