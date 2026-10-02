from __future__ import annotations

import hashlib
import json
from dataclasses import replace
from types import SimpleNamespace

import pytest

from tools.common.capabilities.assessment.claims.evidence_claim.evidence_claim_validator import (
    EvidenceClaimValidationError,
    EvidenceClaimValidator,
)
from tools.common.capabilities.assessment.claims.evidence_claim.models import (
    ENGINEERING_EVIDENCE_CLAIM_TYPES,
    ENGINEERING_LIMITATION_CODES,
    EvidenceClaim,
)
from tools.common.capabilities.assessment.evaluation.engineering_rule.rule_evaluator import (
    EngineeringRuleEvaluator,
)
from tools.common.capabilities.assessment.rule_assessment.run import (
    claims_for_rule,
    finalize_rule_results,
    rule_runtime_version,
    technical_evidence_display,
    usable_rule_result,
)
from tools.common.capabilities.assessment.rule_assessment.values import (
    RULE_ANALYSIS_STATUSES,
    RULE_ASSESSMENT_VALIDATOR_ID,
    RULE_CRITERION_STATUSES,
    RULE_EVIDENCE_KINDS,
)
from tools.common.capabilities.evidence.graph.schema.models import ProgramEvidenceGraph
from tools.common.capabilities.platform import repository_sandbox


_CRITERION = "AI_INTERACTION_DISCLOSURE_CONTROL"


def _graph() -> ProgramEvidenceGraph:
    return ProgramEvidenceGraph(
        graph_id="graph-1",
        snapshot_id="snapshot-1",
        commit_sha="abc123",
        node_count=0,
        edge_count=0,
        nodes=[],
        edges=[],
        provenance={"scan_job_id": "scan-1"},
    )


def _claim(
    *,
    claim_type: str = ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"],
    criterion: str = _CRITERION,
    path: str = "src/disclosure.py",
) -> EvidenceClaim:
    return EvidenceClaim(
        claim_id="claim-1",
        engineering_rule_id="rule-1",
        claim_type=claim_type,
        value=claim_type == ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"],
        evidence_refs=(),
        source_locations=({"path": path, "start_line": 1, "end_line": 1},),
        confidence=0.9,
        criterion=criterion,
    )


class _Repository:
    def __init__(
        self,
        *,
        content: str = "show_disclosure_notice()",
        baseline: str | None = None,
        snapshot_id: str = "snapshot-1",
    ):
        self.content = content
        self.snapshot_id = snapshot_id
        payload = content.encode()
        self.baseline = baseline or hashlib.sha1(
            f"blob {len(payload)}\0".encode() + payload
        ).hexdigest()

    def download_files(self, paths):
        path = paths[0]
        if path == "/.lcsp/repository.json":
            content = json.dumps(
                {
                    "snapshotId": self.snapshot_id,
                    "scanJobId": "scan-1",
                    "commitSha": "abc123",
                }
            ).encode()
        else:
            content = self.content.encode()
        return [SimpleNamespace(content=content, error=None)]

    def execute(self, command):
        assert "rev-parse" in command
        return SimpleNamespace(output=self.baseline, exit_code=0)


def _rule():
    return SimpleNamespace(
        engineering_rule_id="rule-1",
        legal_rule_id="legal-1",
        concept="DISCLOSURE",
        required_evidence=(_CRITERION,),
        source_chunk_ids=(),
        source_locators=(),
    )


def test_pinned_production_source_can_close_positive_claim(monkeypatch) -> None:
    monkeypatch.setattr(repository_sandbox, "current_repository_backend", lambda: _Repository())
    claim = _claim()

    assert EngineeringRuleEvaluator._has_evidence(claim) is False
    validated = EvidenceClaimValidator().validate(claim, _graph())
    assert validated.source_verified is True
    assert EngineeringRuleEvaluator().evaluate(_rule(), [validated]).status == "COMPLIANT"

    # The same pinned production source closes the criterion through the new
    # per-rule runtime: the accepted assessment carries validator-stamped
    # provenance, claims_for_rule mints the governed claim, and the evaluator
    # stays COMPLIANT.
    assessment = _governed_assessment()
    assert usable_rule_result(
        _rule(), assessment, commit_sha="abc123", applicability_status="MATCHED"
    ) is True
    (governed_claim,) = claims_for_rule(_rule(), assessment, commit_sha="abc123")
    assert governed_claim.claim_type == ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"]
    assert governed_claim.value is True
    assert EngineeringRuleEvaluator().evaluate(_rule(), [governed_claim]).status == "COMPLIANT"
    displays = technical_evidence_display(assessment)
    assert displays[0]["file_path"] == "src/disclosure.py"
    assert displays[0]["start_line"] == 1


def _governed_assessment() -> dict:
    """Accepted rule assessment mirroring the pinned production source above."""
    rule = _rule()
    entry = {
        "ref": "ref:disclosure",
        "path": "src/disclosure.py",
        "startLine": 1,
        "endLine": 1,
        "symbol": "show_disclosure_notice",
        "provenance": {
            "assessmentId": "assessment-1",
            "repositoryVersion": "abc123",
            "engineeringRuleId": "rule-1",
            "criterionId": _CRITERION,
            "validator": RULE_ASSESSMENT_VALIDATOR_ID,
        },
    }
    return {
        "resultId": "rar-rule-1",
        "assessmentId": "assessment-1",
        "engineeringRuleId": "rule-1",
        "engineeringRuleVersion": rule_runtime_version(rule),
        "repositoryVersion": "abc123",
        "contextRevision": 1,
        "status": RULE_ANALYSIS_STATUSES["completed"],
        "criteria": [
            {
                "criterionId": _CRITERION,
                "status": RULE_CRITERION_STATUSES["evidenceFound"],
                "evidenceKind": RULE_EVIDENCE_KINDS["supportsRequirement"],
                "evidenceRefs": [entry["ref"]],
                "evidence": [entry],
                "technicalFacts": [],
                "limitations": [],
            }
        ],
        "limitations": [],
        "execution": {"attempt": 1},
    }


@pytest.mark.parametrize(
    ("claim", "repository", "message"),
    [
        (_claim(path="tests/test_disclosure.py"), _Repository(), "production code"),
        (_claim(path="docs/disclosure.md"), _Repository(), "production code"),
        (_claim(), _Repository(content="unrelated_handler()"), "criterion-aligned"),
        (_claim(), _Repository(content="# disclosure notice"), "criterion-aligned"),
        (_claim(), _Repository(baseline="b" * 40), "baseline"),
        (_claim(), _Repository(snapshot_id="stale-snapshot"), "pinned evidence graph"),
        (
            _claim(claim_type=ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_not_met"]),
            _Repository(),
            "governed repository provenance",
        ),
        (
            _claim(criterion="AI_OUTPUT_PATH"),
            _Repository(),
            "governed repository provenance",
        ),
    ],
)
def test_unproven_direct_source_claims_fail_closed(
    monkeypatch, claim, repository, message
) -> None:
    monkeypatch.setattr(repository_sandbox, "current_repository_backend", lambda: repository)
    with pytest.raises(EvidenceClaimValidationError, match=message):
        EvidenceClaimValidator().validate(claim, _graph())


def test_direct_source_requires_repository_backend(monkeypatch) -> None:
    monkeypatch.setattr(repository_sandbox, "current_repository_backend", lambda: None)
    with pytest.raises(EvidenceClaimValidationError, match="pinned assessment repository"):
        EvidenceClaimValidator().validate(_claim(), _graph())


def test_governed_claim_fails_closed_without_stamped_provenance() -> None:
    # A source citation is accepted only with validator-stamped provenance binding
    # it to this assessment, commit, rule and criterion. An unstamped entry fails
    # closed to an unresolved claim (UNKNOWN), never to a decided outcome.
    from unittest.mock import MagicMock

    assessment = _governed_assessment()
    entry = dict(assessment["criteria"][0]["evidence"][0])
    entry.pop("provenance")
    assessment["criteria"][0]["evidence"] = [entry]

    (claim,) = claims_for_rule(_rule(), assessment, commit_sha="abc123")
    assert claim.claim_type == ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"]
    assert claim.value is None
    (evaluation,) = finalize_rule_results(
        assessment_id="assessment-1",
        rules=[_rule()],
        api=MagicMock(),
        applicability_facts={},
        context_revision=1,
        assessments=[assessment],
        applicability={"rule-1": {"status": "MATCHED"}},
        commit_sha="abc123",
    )
    assert evaluation.status == "UNKNOWN"


def test_direct_source_cannot_bypass_closed_claim_value_or_confidence(monkeypatch) -> None:
    monkeypatch.setattr(repository_sandbox, "current_repository_backend", lambda: _Repository())
    validator = EvidenceClaimValidator()
    with pytest.raises(EvidenceClaimValidationError, match="zero-confidence"):
        validator.validate(replace(_claim(), confidence=0), _graph())
    with pytest.raises(EvidenceClaimValidationError, match="governed repository provenance"):
        validator.validate(replace(_claim(), value=False), _graph())


def test_unresolved_claim_without_refs_remains_unresolved() -> None:
    claim = EvidenceClaim(
        claim_id="claim-unresolved",
        engineering_rule_id="rule-1",
        claim_type=ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"],
        value=None,
        evidence_refs=(),
        confidence=0.0,
        limitations=(ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"],),
        criterion=_CRITERION,
    )
    assert EvidenceClaimValidator().validate(claim, _graph()) == claim
    assert EngineeringRuleEvaluator().evaluate(_rule(), [claim]).status == "UNKNOWN"
