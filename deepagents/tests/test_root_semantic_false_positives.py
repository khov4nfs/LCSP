"""Validate adversarial live-eval inputs; these tests do not execute a model."""
import hashlib
import json
from pathlib import Path

import pytest

from vertical.root_semantic_fixture import fixture


CASES = json.loads((Path(__file__).resolve().parents[2] / "tests/fixtures/assessment-root/semantic-false-positives.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=[case["id"] for case in CASES])
def test_live_regression_uses_pinned_duty_and_complete_adversarial_source(case):
    result = fixture(case["id"])
    assert len(result["packet"]["assessmentRules"]) == 1
    assert result["packet"]["assessmentRules"][0]["criteria"] == case["criteria"]
    assert result["packet"]["legalRequirements"][0]["applicabilityConditions"] == [case["condition"]]
    assert result["semanticExpectation"] == case["expected"]
    for name, source in case["files"].items():
        assert result["files"][name] == source
        if name.endswith(".py"):
            compile(source, name, "exec")
    for chunk in result["chunks"]:
        assert chunk["content"] == case["legalText"]
        assert chunk["contentSha256"] == "sha256:" + hashlib.sha256(chunk["content"].encode()).hexdigest()
