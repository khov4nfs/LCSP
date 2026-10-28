"""Baseline reader for LCSP-360 non-disputed decisions."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DECISIONS_FILE = Path("/home/khovan/.cache/lcsp360-cheatshield-20261026/mapped-229-baseline-decisions.json")


def get_229_baseline_decisions() -> list[dict[str, Any]]:
    """Business purpose:
    Provide the 229 non-disputed decisions from baseline assessment 14a6d06e-e021-442e-a29e-0b5406e2b8fa
    with evidence and fact IDs mapped to the follow-up assessment environment.

    Business rules:
    - Only non-disputed decisions are returned (the 14 disputed rules are excluded).
    - Decisions must retain original rationale, criteria, and legal context references.
    - References must cite the follow-up assessment's minted evidence and facts.

    Execution flow:
    1. Read the mapped decisions JSON file from the private cache directory.
    2. Parse and return the list of 229 decision dictionaries.

    Failure cases:
    - Missing file or JSON parse error raises FileNotFoundError / json.JSONDecodeError.
    - If count is not 229, an AssertionError is raised.

    Side effects:
    - Read-only filesystem operation; no persistence mutations.
    """
    if not DECISIONS_FILE.exists():
        raise FileNotFoundError(f"Mapped decisions file not found: {DECISIONS_FILE}")
    data: list[dict[str, Any]] = json.loads(DECISIONS_FILE.read_text(encoding="utf-8"))
    assert len(data) == 229, f"Expected 229 baseline decisions, got {len(data)}"
    return data
