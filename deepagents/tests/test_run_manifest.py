"""Fingerprints describe actual model-facing material and fail on drift/replays."""
from types import SimpleNamespace

import pytest

from evals.run_manifest import (
    build_runtime_manifest, checked_in_skill_hashes, save_runtime_manifest,
    settle_runtime_manifest,
)


def make_manifest(tmp_path, description="read canonical rule"):
    skills = tmp_path / "skills" / "read-source"
    skills.mkdir(parents=True, exist_ok=True)
    (skills / "SKILL.vi.md").write_text("Nguồn luật được pin", encoding="utf-8")
    digest = checked_in_skill_hashes(["read-source"], "vi", tmp_path / "skills")
    return build_runtime_manifest(
        run_id="execution-123", component="assessment-root", locale="vi",
        model=SimpleNamespace(model_name="pinned-model"),
        prompts={"root": "Start by reloading context."},
        tools=[SimpleNamespace(name="get_assessment_context", description=description)],
        skill_hashes=digest, pins={"repositoryCommit": "abc", "ruleSetVersionId": "r1"},
        gold_revision="approved-gold-r2",
    )


def test_fingerprint_changes_with_tool_description(tmp_path):
    first = make_manifest(tmp_path)
    second = make_manifest(tmp_path, "read newly pinned source")
    assert first["manifestSha256"] != second["manifestSha256"]
    assert first["promptsSha256"] == second["promptsSha256"]


def test_manifest_is_immutable_and_never_invents_usage(tmp_path):
    manifest = make_manifest(tmp_path)
    assert manifest["usage"]["providerCost"] is None
    skill_hash = manifest["availableSkillsSha256"]["read-source"]
    frozen = settle_runtime_manifest(manifest, selected_skill_hashes={"read-source": skill_hash},
        usage={"physicalAttempts": 2, "failedAttempts": 1, "cachedInputTokens": 25})
    receipt = tmp_path / "receipts" / "execution-123.json"
    save_runtime_manifest(receipt, frozen)
    save_runtime_manifest(receipt, frozen)
    with pytest.raises(ValueError, match="REPLAY_CONFLICT"):
        save_runtime_manifest(receipt, manifest)
    assert frozen["usage"]["providerCost"] is None
    assert frozen["goldReviewerRevision"] == "approved-gold-r2"


def test_unversioned_or_drifted_skill_is_rejected(tmp_path):
    manifest = make_manifest(tmp_path)
    with pytest.raises(ValueError, match="SKILL_CHANGED"):
        settle_runtime_manifest(manifest, selected_skill_hashes={"read-source": "0" * 64})
    with pytest.raises(FileNotFoundError):
        checked_in_skill_hashes(["read-source"], "en", tmp_path / "skills")


def test_journal_reconciliation_requires_same_run_and_authoritative_complete_source(tmp_path):
    from evals.settle_manifest import reconcile_usage
    manifest = make_manifest(tmp_path)
    journal = {
        "runId": "execution-123", "accountingSource": "API_USAGE_JOURNAL",
        "accountingState": "COMPLETE", "recordsSha256": "a"*64,
        "physicalAttempts": 3, "failedAttempts": 1,
        "inputTokens": 120, "cachedInputTokens": 25, "outputTokens": 60,
    }
    reconciled = reconcile_usage(manifest, journal)
    assert reconciled["usage"]["physicalAttempts"] == 3
    assert reconciled["usage"]["providerCost"] is None
    with pytest.raises(ValueError, match="COST_NOT_BILLED"):
        reconcile_usage(manifest, {**journal, "providerCost": 0.4, "costCurrency": "USD"})
    billed = reconcile_usage(manifest, {**journal,
        "accountingSource": "SERVER_BILLING_LEDGER", "providerCost": 0.4, "costCurrency": "USD"})
    assert billed["usage"]["providerCost"] == 0.4
    with pytest.raises(ValueError, match="RUN_MISMATCH"):
        reconcile_usage(manifest, {**journal, "runId": "other"})
    with pytest.raises(ValueError, match="NOT_RECONCILED"):
        reconcile_usage(manifest, {**journal, "accountingState": "PARTIAL"})
