"""Rule Authoring model-facing memory, through the REAL Managed Deep Agent request path (DraftHistoryMiddleware included).

Live run 7fefb641 froze 48 claims and then read the inventory 20 times without authoring once. These tests drive the
frozen inventory of that run through the same middleware with a model that sees only what the middleware shows it.
"""
import json

import pytest

import retained_rule_authoring_harness as H
from authoring_memory_harness import (FIXTURE48, PLAN48, NavigateAndAuthorProbe, ProbeBudgetExceeded, RejectionRetentionProbe,
                                      run_agent, view_chars, visible_text)

FX = json.loads(FIXTURE48.read_text())
CLAIMS = {c["claimId"]: c for c in FX["frozenInventory"]["graph"]["claims"]}
PREFIXES = {p for row in PLAN48 for part in row[1:] for p in part}
assert all(sum(cid.startswith(p) for cid in CLAIMS) == 1 for p in PREFIXES), "claim-ID prefixes must identify exactly one frozen claim"


def restored():
    return H.restore(FX)


def test_the_frozen_live_inventory_is_what_the_replay_uses():
    assert len(CLAIMS) == 48 and FX["frozenInventory"]["fingerprint"].startswith("02708956")
    relevant = {cid for cid, c in CLAIMS.items() if c["state"] == "RELEVANT"}
    assert len(relevant) == 46
    # every relevant claim is bound by the plan, so a complete replay can pass the real Rule Validator
    planned = {p for row in PLAN48 for part in row[1:] for p in part}
    assert {cid for cid in CLAIMS if any(cid.startswith(p) for p in planned)} == relevant


def test_early_page_claim_is_still_available_after_more_than_three_later_rounds(tmp_path, monkeypatch):
    """Navigation reads page 0..2 plus two more reads (5 rounds); the first Requirement needs claims from every page."""
    _, ctx, _, _ = restored()
    probe = NavigateAndAuthorProbe(plan=PLAN48, stop_after=1)
    try:
        run_agent(ctx, probe, tmp_path, monkeypatch)
    except ProbeBudgetExceeded:
        pass
    assert probe.first_author_view_missing == [], f"claims the model had already read were gone from its view: {probe.first_author_view_missing}"
    assert probe.rereads == 0


def test_real_middleware_replay_reaches_authoring_without_a_reread_loop(tmp_path, monkeypatch):
    _, ctx, _, _ = restored()
    probe = NavigateAndAuthorProbe(plan=PLAN48)
    try:
        run_agent(ctx, probe, tmp_path, monkeypatch)
    except ProbeBudgetExceeded as exceeded:
        pytest.fail(f"reread loop: {exceeded}")
    tally = probe.tally()
    assert tally.get("author_legal_requirement", 0) >= 1
    assert probe.rereads == 0 and tally["get_claim_inventory"] == 5, tally  # exactly the planned navigation, nothing re-read


def test_full_scripted_convergence_through_the_real_middleware(tmp_path, monkeypatch):
    _, ctx, _, api = restored()
    probe = NavigateAndAuthorProbe(plan=PLAN48)
    run_agent(ctx, probe, tmp_path, monkeypatch)
    assert len(ctx.draft["legalRequirements"]) == len(PLAN48) and len(ctx.draft["assessmentRules"]) == len(PLAN48)
    assert ctx.validation_calls >= 1 and ctx.last_validation is not None
    assert ctx.inventory.phase == "COMPLETION" and ctx.submission is not None and api.submitted is not None
    assert api.submitted["claimInventory"]["fingerprint"] == FX["frozenInventory"]["fingerprint"], "the frozen inventory is untouched through submission"


def test_an_unresolved_rejection_is_retained_until_a_corrected_call_succeeds(tmp_path, monkeypatch):
    _, ctx, _, _ = restored()
    pick = lambda claim_type: next(cid for cid, c in CLAIMS.items() if c["claimType"] == claim_type)[:6]
    probe = RejectionRetentionProbe(definition_prefix=pick("DEFINITION"), operative_prefix=pick("DUTY"), applicability_prefix=pick("SCOPE"))
    run_agent(ctx, probe, tmp_path, monkeypatch)
    assert probe.retry_was_corrected is True, "the only actionable feedback disappeared with the compacted rounds"
    assert "R-retry" in ctx.draft["legalRequirements"], "the corrected retry was accepted"
