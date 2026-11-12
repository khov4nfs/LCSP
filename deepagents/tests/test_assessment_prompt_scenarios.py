"""Synthetic checks for domain coverage; live semantic evaluation is separate."""
import json
from pathlib import Path
from assessment_root.skills import ALLOWED

FIXTURE = Path(__file__).parent / "fixtures" / "assessment_prompt_routing" / "scenarios.json"


def test_prompt_evaluation_scenarios_cover_negative_controls():
    rows = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]
    assert len(rows) >= 6
    assert len({row["id"] for row in rows}) == len(rows)
    for row in rows:
        assert row["expected_skill"] in ALLOWED
        assert row["must_not"]
    assert any("no ML" in row["observed"] for row in rows)
    assert any("README" in row["observed"] for row in rows)
