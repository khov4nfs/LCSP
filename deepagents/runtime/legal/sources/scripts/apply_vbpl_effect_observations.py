#!/usr/bin/env python3
"""Apply reviewed VBPL effect observations to a normalized corpus preview."""

from __future__ import annotations

import argparse
from pathlib import Path

from tools.legal.legal.vbpl_effect_applier import apply_effect_observations


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--normalized-payload", required=True, type=Path)
    parser.add_argument("--effect-observations", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--no-propagate-repealed-descendants",
        action="store_true",
        help="Only update the exact repealed locator, not its descendant chunks.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output = apply_effect_observations(
        normalized_payload_path=args.normalized_payload,
        effect_observations_path=args.effect_observations,
        output_path=args.output,
        propagate_repealed_descendants=not args.no_propagate_repealed_descendants,
    )
    print(output)


if __name__ == "__main__":
    main()
