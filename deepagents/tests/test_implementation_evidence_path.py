"""Only implementation source can close a criterion (governed rule assessments).

Provenance proves a cited range exists at the pinned commit; it does not prove relevance.
This deterministic floor keeps prose documentation and non-production files from becoming
the basis of a terminal COMPLIANT/NON_COMPLIANT conclusion.
"""

import pytest

from orchestration.context import LCSPRunContext, coerce_run_context
from tools.common.capabilities.assessment.claims.evidence_claim.evidence_claim_validator import (
    is_implementation_evidence_path,
)


@pytest.mark.parametrize("path", ["src/app/service.py", "apps/api/main.ts", "config/app.yaml"])
def test_implementation_and_config_are_admissible(path: str) -> None:
    assert is_implementation_evidence_path(path)


@pytest.mark.parametrize(
    "path",
    ["README.md", "docs/guide.md", "LICENSE", "CHANGELOG", "src/notes.txt", "tests/test_a.py", "scripts/run.py"],
)
def test_documentation_and_non_production_cannot_close_a_criterion(path: str) -> None:
    assert not is_implementation_evidence_path(path)


def test_run_context_is_coerced_from_a_mapping() -> None:
    context = coerce_run_context({"assessment_id": "a1", "engineering_rule_ids": ("r1",)})
    assert isinstance(context, LCSPRunContext) and context.assessment_id == "a1"
    assert coerce_run_context({"not_a_field": 1}) is None
    assert coerce_run_context(None) is None
