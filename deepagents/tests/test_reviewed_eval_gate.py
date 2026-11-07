"""Provider-free negative controls for independently pinned reviewed-eval admission.

No fixture is genuine human-reviewed gold or a provider execution.
"""
from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json

import pytest

from evals.run_manifest import stable_hash
from rule_set_preparation.eval_cli import main
from rule_set_preparation.reviewed_eval_gate import reviewed_eval_preflight
from test_preparation_behavior_mutation_bank import CASES, seed


def inputs():
    gold, graph, decisions = seed(CASES[0])
    gold["goldReviewerRevision"] = "synthetic-review-r1"
    candidate = {
        "semanticGraph": graph, "scopeDecisions": decisions,
        "runId": "offline-fixture-run", "responseLanguage": "vi",
    }
    manifest = {
        "schemaVersion": "LCSP_MODEL_FACING_MANIFEST_V1",
        "runId": "offline-fixture-run",
        "component": "rule-set-preparation",
        "responseLanguage": "vi",
        "model": {"configuredModelId": "synthetic-model-not-used", "adapterClass": "Fixture"},
        "promptsSha256": {"phase_system_message": "a" * 64},
        "toolDescriptionsSha256": {"load_preparation_skill": "b" * 64},
        "availableSkillsSha256": {},
        "selectedSkillsSha256": {},
        "sourcePins": {"legalSourceVersionId": gold["legalSourceVersionId"]},
        "goldReviewerRevision": gold["goldReviewerRevision"],
        "usage": {
            "physicalAttempts": 1, "failedAttempts": 0,
            "inputTokens": 13, "cachedInputTokens": 0, "outputTokens": 3,
            "providerCost": 1.5, "costCurrency": "USD",
        },
        "semanticAcceptance": "NOT_ESTABLISHED_BY_FINGERPRINT",
    }
    manifest["manifestSha256"] = stable_hash(manifest)
    candidate["promptManifestSha256"] = manifest["manifestSha256"]
    raw = json.dumps(gold, ensure_ascii=False).encode()
    return gold, raw, candidate, manifest


def verified(gold, raw, candidate, manifest, expected=None):
    return reviewed_eval_preflight(
        gold, raw, candidate, manifest, expected or sha256(raw).hexdigest()
    )


def test_synthetic_gold_cannot_be_accepted_even_with_correct_external_digest():
    gold, raw, candidate, manifest = inputs()
    failures = verified(gold, raw, candidate, manifest)
    assert "REVIEWED_EVAL_GOLD_NOT_APPROVED" in failures


def test_review_requires_exact_externally_pinned_gold_and_revision():
    gold, raw, candidate, manifest = inputs()
    gold["goldApprovalStatus"] = "HUMAN_APPROVED"  # not an actual approval
    assert "REVIEWED_EVAL_GOLD_HASH_MISMATCH" in verified(
        gold, raw, candidate, manifest, "0" * 64
    )
    gold["goldReviewerRevision"] = ""
    assert "REVIEWED_EVAL_GOLD_REVIEW_REVISION_MISSING" in verified(
        gold, raw, candidate, manifest
    )


def test_omitted_critical_gold_dimensions_are_blocked():
    gold, raw, candidate, manifest = inputs()
    gold["goldApprovalStatus"] = "HUMAN_APPROVED"
    gold.pop("contextClaims")
    failures = verified(gold, raw, candidate, manifest)
    assert "REVIEWED_EVAL_GOLD_COVERAGE_INCOMPLETE" in failures
    gold, raw, candidate, manifest = inputs()
    gold["goldApprovalStatus"] = "HUMAN_APPROVED"
    gold["normativeClaims"][0].pop("frame")
    assert "REVIEWED_EVAL_GOLD_NORMATIVE_FRAME_MISSING" in verified(
        gold, raw, candidate, manifest
    )


@pytest.mark.parametrize("mutation,expected", [
    ("prompt", "REVIEWED_EVAL_CANDIDATE_MANIFEST_MISMATCH"),
    ("run_id", "REVIEWED_EVAL_RUN_OR_LOCALE_MISMATCH"),
    ("locale", "REVIEWED_EVAL_RUN_OR_LOCALE_MISMATCH"),
    ("component", "REVIEWED_EVAL_MANIFEST_WRONG_COMPONENT"),
    ("manifest_content", "REVIEWED_EVAL_MANIFEST_INTEGRITY_FAILED"),
    ("source", "REVIEWED_EVAL_LEGAL_SOURCE_PIN_MISMATCH"),
    ("revision", "REVIEWED_EVAL_GOLD_REVISION_MISMATCH"),
    ("model", "REVIEWED_EVAL_MODEL_ID_MISSING"),
    ("tools", "REVIEWED_EVAL_EXECUTION_HASHES_MISSING"),
    ("attempts", "REVIEWED_EVAL_USAGE_INCONSISTENT"),
    ("usage", "REVIEWED_EVAL_USAGE_INCOMPLETE"),
    ("cost", "REVIEWED_EVAL_BILLING_NOT_RECONCILED"),
    ("currency", "REVIEWED_EVAL_BILLING_NOT_RECONCILED"),
    ("infinite_cost", "REVIEWED_EVAL_BILLING_NOT_RECONCILED"),
])
def test_frozen_candidate_and_accounting_provenance_fail_closed(mutation, expected):
    gold, raw, candidate, manifest = inputs()
    gold["goldApprovalStatus"] = "HUMAN_APPROVED"  # test-only synthetic marker
    if mutation == "prompt":
        candidate["promptManifestSha256"] = "f" * 64
    elif mutation == "run_id":
        candidate["runId"] = "wrong-run"
    elif mutation == "locale":
        candidate["responseLanguage"] = "en"
    elif mutation == "component":
        manifest["component"] = "assessment-root"
    elif mutation == "manifest_content":
        manifest["promptsSha256"]["phase_system_message"] = "f" * 64
    elif mutation == "source":
        manifest["sourcePins"]["legalSourceVersionId"] = "foreign"
    elif mutation == "revision":
        manifest["goldReviewerRevision"] = "stale"
    elif mutation == "model":
        manifest["model"]["configuredModelId"] = None
    elif mutation == "tools":
        manifest["toolDescriptionsSha256"] = {}
    elif mutation == "attempts":
        manifest["usage"]["physicalAttempts"] = 0
    elif mutation == "usage":
        manifest["usage"]["inputTokens"] = None
    elif mutation == "cost":
        manifest["usage"]["providerCost"] = None
    elif mutation == "currency":
        manifest["usage"]["costCurrency"] = ""
    elif mutation == "infinite_cost":
        manifest["usage"]["providerCost"] = float("inf")
    assert expected in verified(gold, raw, candidate, manifest)


def test_reviewed_evidence_preflight_only_checks_frozen_inputs_not_legal_truth():
    gold, raw, candidate, manifest = inputs()
    gold["goldApprovalStatus"] = "HUMAN_APPROVED"  # synthetic data, not actual reviewer
    raw = json.dumps(gold, ensure_ascii=False).encode()
    assert verified(gold, raw, candidate, manifest) == []


def test_cli_keeps_diagnostic_mode_and_refuses_review_gate_without_manifest(tmp_path, capsys):
    gold, raw, candidate, manifest = inputs()
    g = tmp_path / "gold.json"
    c = tmp_path / "candidate.json"
    g.write_bytes(raw)
    c.write_text(json.dumps(candidate))
    result = main(["--gold", str(g), "--candidate", str(c)])
    assert result == 0
    receipt = json.loads(capsys.readouterr().out)
    assert receipt["reviewedEvidenceGate"]["status"] == "NOT_REQUESTED"
    assert receipt["productionAcceptance"] == "NOT_PROVEN"

    result = main([
        "--gold", str(g), "--candidate", str(c),
        "--approved-gold-sha256", sha256(raw).hexdigest(),
    ])
    assert result == 4
    receipt = json.loads(capsys.readouterr().out)
    assert receipt["reviewedEvidenceGate"]["status"] == "BLOCKED"
    assert "REVIEWED_EVAL_APPROVAL_INPUTS_INCOMPLETE" in (
        receipt["reviewedEvidenceGate"]["blockingReasons"]
    )


def test_cli_binds_manifest_and_still_blocks_synthetic_approval(tmp_path, capsys):
    gold, raw, candidate, manifest = inputs()
    g = tmp_path / "gold.json"
    c = tmp_path / "candidate.json"
    m = tmp_path / "manifest.json"
    g.write_bytes(raw)
    c.write_text(json.dumps(candidate))
    m.write_text(json.dumps(manifest))
    rc = main([
        "--gold", str(g), "--candidate", str(c),
        "--approved-gold-sha256", sha256(raw).hexdigest(),
        "--run-manifest", str(m),
    ])
    result = json.loads(capsys.readouterr().out)
    assert rc == 4
    assert "REVIEWED_EVAL_GOLD_NOT_APPROVED" in (
        result["reviewedEvidenceGate"]["blockingReasons"]
    )
    assert result["productionAcceptance"] == "NOT_PROVEN"


def test_reviewed_gold_object_cannot_change_after_external_bytes_are_pinned():
    gold, raw, candidate, manifest = inputs()
    # A forged review marker on the parsed object must not borrow the real
    # file's approved digest. CLI reads one file, but this pure helper guards
    # its own bytes/object boundary too.
    gold["goldApprovalStatus"] = "HUMAN_APPROVED"
    failures = verified(gold, raw, candidate, manifest)
    assert "REVIEWED_EVAL_GOLD_OBJECT_BYTES_MISMATCH" in failures
