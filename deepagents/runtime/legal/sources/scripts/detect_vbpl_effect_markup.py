#!/usr/bin/env python3
"""Detect VBPL provision-level legal effect markup in a source HTML snapshot."""

from __future__ import annotations

import argparse
from pathlib import Path

from tools.legal.legal.vbpl_effect_detector import detect_effects


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output = detect_effects(
        source_manifest_path=args.source_manifest,
        output_path=args.output,
    )
    print(output)


if __name__ == "__main__":
    main()
