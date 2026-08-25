#!/usr/bin/env python3
"""List centrally registered LCSP tool runtime bindings for debugging."""

from __future__ import annotations

import argparse
import json

from tools.common.capabilities.agentic_evidence.dispatch import runtime_binding
from tools.common.capabilities.agentic_evidence import tool_runtime_manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--tool",
        help="Show one canonical tool by exact snake_case name.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print machine-readable JSON instead of a table.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.tool:
        binding = runtime_binding(args.tool)
        rows = (
            {
                "tool_name": binding.tool_name,
                "runtime_target": binding.runtime_target.value,
                "entrypoint": binding.entrypoint.__name__,
                "downstream_target": binding.downstream_target,
            },
        )
    else:
        rows = tool_runtime_manifest()

    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return

    widths = {
        key: max(len(key), *(len(str(row[key])) for row in rows))
        for key in (
            "tool_name",
            "runtime_target",
            "entrypoint",
            "downstream_target",
        )
    }
    header = "  ".join(key.ljust(widths[key]) for key in widths)
    print(header)
    print("  ".join("-" * widths[key] for key in widths))
    for row in rows:
        print("  ".join(str(row[key]).ljust(widths[key]) for key in widths))


if __name__ == "__main__":
    main()
