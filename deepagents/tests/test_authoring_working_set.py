"""Rule Authoring working set, runtime digest, normalized read pagination and phase-aware compaction (provider-free)."""
import hashlib
import json
import random
from copy import deepcopy

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from middleware.failure_policy import NoProgressDetected
from orchestration.agent_stream import AgentStreamSession, activate_agent_stream
from rule_set_preparation.authoring_state import DIGEST_MAX_CLAIM_LINES, MARKER
from rule_set_preparation.claim_inventory import CLAIM_ROLES, AUTHORING, DISCOVERY
from rule_set_preparation.draft_history import DraftHistoryMiddleware, compact_draft_history

import retained_rule_authoring_harness as H
from authoring_memory_harness import FIXTURE48, PLAN48, NavigateAndAuthorProbe, run_agent, view_chars, visible_text
from claim_protocol_harness import call

FX = json.loads(FIXTURE48.read_text())
CLAIMS = {c["claimId"]: c for c in FX["frozenInventory"]["graph"]["claims"]}
RELEVANT = {cid for cid, c in CLAIMS.items() if c["state"] == "RELEVANT"}
PREFIX_MAX_REQUEST_CHARS, PREFIX_TOTAL_CHARS, PREFIX_REQUESTS = 52_112, 1_447_219, 40  # measured on deployed e6b6e2fbb, same replay (PREFIX_REPRODUCTION.json)


def restored():
    return H.restore(FX)


def synthetic(count):
    """A frozen inventory of `count` relevant claims with the live mix of accounting roles."""
    _, ctx, tools, api = restored()
    kinds = ["DUTY"] * 4 + ["SCOPE", "CONDITION", "QUALIFIER", "CONTEXT", "DEFINITION", "TEMPORAL_RULE"]
    claims = []
    for i in range(count):
        kind = kinds[i % len(kinds)]
        claims.append({"claimId": hashlib.sha256(f"synthetic-{i}".encode()).hexdigest(), "legalSourceVersionId": FX["sourceVersionId"], "sourceNodeIds": ["n"],
                       "claimType": kind, "statement": f"Synthetic statement {i} of type {kind} about a provision with enough words to be a realistic summary line.",
                       "operative": {"actor": "operator", "modality": "DUTY", "action": "act"} if kind == "DUTY" else None, "state": "RELEVANT", "nonOperativeReason": None})
    ctx.inventory.frozen = {**ctx.inventory.frozen, "claims": claims}
    ctx.draft["semanticClaims"] = {c["claimId"]: deepcopy(c) for c in claims}
    ctx.inventory.identities = {c["claimId"]: c["claimId"] for c in claims}
    ctx.inventory.phase = AUTHORING
    return ctx, tools, claims


def full(prefix):
    return next(cid for cid in CLAIMS if cid.startswith(prefix))


# --- normalized, observable read pagination -------------------------------------------------------------------------
def test_oversized_missing_and_nonpositive_limits_are_normalized_and_reported_not_rejected():
    _, ctx, tools, _ = restored()
    big = call(tools, "get_claim_inventory", kind="CLAIMS", limit=50)
    assert "gaps" not in big and (big["requestedLimit"], big["appliedLimit"], big["offset"], big["returnedCount"], big["hasMore"], big["nextOffset"]) == (50, 20, 0, 20, True, 20)
    for limit in (None, 0, -3):
        page = call(tools, "get_claim_inventory", kind="CLAIMS", **({} if limit is None else {"limit": limit}))
        assert page["appliedLimit"] == 20 and page["requestedLimit"] == limit and page["returnedCount"] == 20
    small = call(tools, "get_claim_inventory", kind="CLAIMS", limit=5, offset=-9)
    assert (small["appliedLimit"], small["offset"], small["returnedCount"]) == (5, 0, 5)
    assert ctx.validation_calls == 0 and not ctx.authoring.outstanding, "a normalized read is neither a rejection nor a validation"


def test_pagination_is_finite_observable_and_covers_every_claim_exactly_once():
    _, ctx, tools, _ = restored()
    seen, offset, pages = [], 0, 0
    while True:
        page = call(tools, "get_claim_inventory", kind="CLAIMS", limit=20, offset=offset)
        seen += [row["claim"]["claimId"] for row in page["items"]]
        pages += 1
        assert page["total"] == 48 and page["endReached"] == (not page["hasMore"]) and page["returnedCount"] == len(page["items"])
        if not page["hasMore"]:
            assert page["nextOffset"] is None
            break
        assert page["nextOffset"] == offset + page["returnedCount"]
        offset = page["nextOffset"]
    assert pages == 3 and sorted(seen) == sorted(CLAIMS) and len(seen) == len(set(seen))


def test_only_safe_read_pagination_is_normalized_mutations_and_enums_still_reject():
    _, ctx, tools, _ = restored()
    call(tools, "start_rule_authoring")
    assert call(tools, "get_claim_inventory", kind="NOPE")["outcome"] == "FAILED"
    assert call(tools, "get_claim_inventory", kind="CLAIMS", limit="many")["outcome"] == "FAILED"  # wrong type is not an ergonomic fix
    definition, duty, scope = (next(cid for cid, c in CLAIMS.items() if c["claimType"] == t) for t in ("DEFINITION", "DUTY", "SCOPE"))
    bad = call(tools, "author_legal_requirement", requirement_key="R", title="t", operative_claim_ids=[duty], applicability_claim_ids=[scope, definition])
    assert bad["outcome"] == "FAILED" and "CLAIM_REQUIREMENT_MISMATCH" in bad["gaps"] and not ctx.draft["legalRequirements"]


# --- bounded role-grouped authoring view ----------------------------------------------------------------------------
def test_authoring_view_groups_by_role_pages_boundedly_and_is_a_view_not_a_second_authority():
    _, ctx, tools, _ = restored()
    first = call(tools, "get_rule_authoring_context", limit=500)
    assert first["appliedLimit"] == 40 and first["requestedLimit"] == 500 and first["returnedCount"] == 40 and first["total"] == 46 and first["hasMore"]
    assert first["frozenInventory"]["fingerprint"] == FX["frozenInventory"]["fingerprint"]
    second = call(tools, "get_rule_authoring_context", offset=first["nextOffset"], limit=40)
    ids = [i["claimId"] for i in first["items"] + second["items"]]
    assert sorted(ids) == sorted(RELEVANT) and second["endReached"] and not second["hasMore"]
    roles = [i["accountingRole"] for i in first["items"] + second["items"]]
    assert roles == sorted(roles, key=lambda r: ["APPLICABILITY_CONDITION", "OPERATIVE_PROPOSITION", "QUALIFIER", "EXCEPTION", "CONTEXT", "DEFINITION"].index(r))
    only = call(tools, "get_rule_authoring_context", role="APPLICABILITY_CONDITION")
    assert only["total"] == 11 and all(i["claimType"] in {"SCOPE", "CONDITION"} for i in only["items"])
    # every summary row maps to the same frozen claim; the view stores nothing of its own
    assert all(CLAIMS[i["claimId"]]["claimType"] == i["claimType"] for i in first["items"])
    assert ctx.inventory.frozen_fingerprint == FX["frozenInventory"]["fingerprint"]


def test_authoring_view_tracks_binding_and_unaccounted_shrinks():
    _, ctx, tools, _ = restored()
    call(tools, "start_rule_authoring")
    before = call(tools, "get_rule_authoring_context", role="UNACCOUNTED")["total"]
    r = call(tools, "author_legal_requirement", requirement_key="R1", title="t", operative_claim_ids=[full("656289")], applicability_claim_ids=[full("c1d5c5")])
    assert r["outcome"] == "PASSED"
    after = call(tools, "get_rule_authoring_context", role="UNACCOUNTED")
    assert after["total"] == before - 2 and full("656289") not in {i["claimId"] for i in after["items"]}
    bound = {i["claimId"]: i["boundTo"] for i in call(tools, "get_rule_authoring_context", role="OPERATIVE_PROPOSITION", limit=40)["items"]}
    assert bound[full("656289")] == ["R1"] and call(tools, "get_rule_authoring_context")["authored"]["requirements"] == ["R1"]


def test_authoring_view_refuses_before_the_freeze():
    _, ctx, tools, _ = restored()
    ctx.inventory.frozen, ctx.inventory.phase = None, DISCOVERY
    assert call(tools, "get_rule_authoring_context")["outcome"] == "FAILED"


# --- the runtime digest -----------------------------------------------------------------------------------------------
def test_digest_is_deterministic_authoritative_and_free_of_source_prose():
    _, ctx, tools, _ = restored()
    digest = ctx.authoring.digest()
    assert digest == ctx.authoring.digest() and digest.startswith(MARKER)
    assert FX["frozenInventory"]["fingerprint"][:16] in digest and "46 relevant claims" in digest
    assert sum(cid in digest for cid in RELEVANT) == 46 and all(cid not in digest for cid in set(CLAIMS) - RELEVANT)
    assert "Respond with a tool call" in digest
    assert "Article" not in digest.split("Claim index")[0], "the header carries state only, never source text"


def test_digest_shrinks_to_what_is_still_needed_as_claims_are_bound():
    _, ctx, tools, _ = restored()
    call(tools, "start_rule_authoring")
    start = len(ctx.authoring.digest())
    for key, op, app, qual, exc, context in PLAN48:
        r = call(tools, "author_legal_requirement", requirement_key=key, title=key, operative_claim_ids=[full(p) for p in op], applicability_claim_ids=[full(p) for p in app],
                 qualifier_claim_ids=[full(p) for p in qual], exception_claim_ids=[full(p) for p in exc], context_claim_ids=[full(p) for p in context])
        assert r["outcome"] == "PASSED", r
    digest = ctx.authoring.digest()
    assert len(digest) < start and "Claims not yet bound to any Requirement: 0" in digest
    applicability = {cid for cid in RELEVANT if CLAIM_ROLES[CLAIMS[cid]["claimType"]] == "APPLICABILITY_CONDITION"}
    assert all(cid in digest for cid in applicability), "reusable applicability claims stay listed"
    assert sum(cid in digest for cid in RELEVANT - applicability) == 0


@pytest.mark.parametrize("count", [500, 5000])
def test_digest_stays_bounded_for_large_inventories(count):
    ctx, tools, claims = synthetic(count)
    digest = ctx.authoring.digest()
    lines = [line for line in digest.splitlines() if len(line) > 64 and line[:64] in {c["claimId"] for c in claims}]
    assert len(lines) <= DIGEST_MAX_CLAIM_LINES and "(+" in digest and "get_rule_authoring_context" in digest
    assert len(digest.encode()) < 16_000
    seen, offset = set(), 0
    while True:
        page = call(tools, "get_rule_authoring_context", offset=offset, limit=40)
        seen |= {i["claimId"] for i in page["items"]}
        if not page["hasMore"]:
            break
        offset = page["nextOffset"]
    assert seen == {c["claimId"] for c in claims}, "everything outside the digest is reachable through the bounded view"


# --- unresolved rejections ----------------------------------------------------------------------------------------------
def test_unresolved_rejection_is_in_the_digest_until_a_corrected_call_succeeds_then_cleared():
    _, ctx, tools, _ = restored()
    call(tools, "start_rule_authoring")
    duty, scope, definition = full("656289"), full("c1d5c5"), full("1ae971")
    assert call(tools, "author_legal_requirement", requirement_key="R-fix", title="t", operative_claim_ids=[duty], applicability_claim_ids=[scope, definition])["outcome"] == "FAILED"
    digest = ctx.authoring.digest()
    assert "OUTSTANDING AUTHORING REJECTION" in digest and "CLAIM_REQUIREMENT_MISMATCH" in digest and "context_claim_ids" in digest and "author_legal_requirement" in digest
    for _ in range(6):  # unrelated successful work does not clear a different operation's problem
        assert call(tools, "get_claim_inventory", kind="REQUIREMENTS")["total"] == 0
    assert call(tools, "author_legal_requirement", requirement_key="R-other", title="t", operative_claim_ids=[full("74d867")], applicability_claim_ids=[scope])["outcome"] == "PASSED"
    assert "OUTSTANDING AUTHORING REJECTION" in ctx.authoring.digest()
    assert call(tools, "author_legal_requirement", requirement_key="R-fix", title="t", operative_claim_ids=[duty], applicability_claim_ids=[scope], context_claim_ids=[definition])["outcome"] == "PASSED"
    assert "OUTSTANDING AUTHORING REJECTION" not in ctx.authoring.digest() and not ctx.authoring.outstanding, "a resolved error must not pollute later prompts"


def test_a_rejected_read_is_retained_until_a_valid_read_and_phase_change_clears_everything():
    _, ctx, tools, _ = restored()
    assert call(tools, "get_claim_inventory", kind="NOPE")["outcome"] == "FAILED"
    assert "get_claim_inventory" in ctx.authoring.digest() and "kind" in ctx.authoring.digest()
    assert call(tools, "get_claim_inventory", kind="CLAIMS", limit=5)["returnedCount"] == 5 and not ctx.authoring.outstanding
    call(tools, "start_rule_authoring")
    call(tools, "author_legal_requirement", requirement_key="R", title="t", operative_claim_ids=[], applicability_claim_ids=[])
    assert ctx.authoring.outstanding
    call(tools, "reopen_semantic_claim_inventory", reason="A material applicability claim was missed in discovery")
    assert not ctx.authoring.outstanding and ctx.authoring.digest() is None


def test_genuine_stagnation_is_still_terminal_with_the_feedback_visible():
    from middleware.failure_policy import NoProgressDetected
    _, ctx, tools, _ = restored()
    ctx.model_turn = 0
    for attempt in range(2):
        ctx.model_turn += 1
        call(tools, "get_claim_inventory", kind="NOPE")
    ctx.model_turn += 1
    with pytest.raises(NoProgressDetected):
        call(tools, "get_claim_inventory", kind="NOPE")


def test_harmless_oversized_reads_never_count_as_no_progress():
    _, ctx, tools, _ = restored()
    events = []
    session = AgentStreamSession(assessment_id=None, run_id="offline", correlation_id="offline", boundary_name="rule-set-preparation", emit_payload=events.append,
                                 boundary_type="RULE_SET_PREPARATION", preparation_run_id=FX["preparationId"])
    with activate_agent_stream(session):
        for turn in range(1, 9):
            ctx.model_turn = turn
            assert "gaps" not in call(tools, "get_claim_inventory", kind="CLAIMS", limit=100, offset=20 * (turn % 3))
    kinds = [e.get("data", {}).get("activity_kind") for e in events]
    assert "NO_PROGRESS_DETECTED" not in kinds and "CLAIM_INVENTORY_READ_REJECTED" not in kinds


# --- phase-aware compaction -----------------------------------------------------------------------------------------------
def round_(name, n, args=None):
    return [AIMessage(content="", tool_calls=[{"name": name, "args": args or {}, "id": f"c{n}"}]), ToolMessage(content=f"result {n}", tool_call_id=f"c{n}")]


def test_discovery_compaction_is_unchanged_reads_share_the_add_budget():
    messages = [HumanMessage(content="go")]
    for n in range(6):
        messages += round_("get_claim_inventory" if n % 2 else "register_semantic_claim", n)
    kept = {m.tool_call_id for m in compact_draft_history(messages) if isinstance(m, ToolMessage)}
    assert kept == {"c3", "c4", "c5"}


def test_authoring_compaction_gives_reads_their_own_budget():
    messages = [HumanMessage(content="go")]
    for n in range(5):
        messages += round_("get_claim_inventory", n)
    for n in range(5, 9):
        messages += round_("author_legal_requirement", n)
    kept = {m.tool_call_id for m in compact_draft_history(messages, authoring=True) if isinstance(m, ToolMessage)}
    assert kept == {"c3", "c4", "c6", "c7", "c8"}, "2 recent reads and 3 recent mutations, neither evicting the other"


def test_early_page_claim_survives_compaction_through_the_digest():
    """Pages 1-4 are read, page 1's raw ToolMessage is dropped, yet the next request still exposes a page-1 claim for binding."""
    _, ctx, tools, _ = restored()
    call(tools, "start_rule_authoring")
    messages, early = [HumanMessage(content="go")], None
    for n, offset in enumerate((0, 20, 40, 0)):
        result = call(tools, "get_claim_inventory", kind="CLAIMS", limit=20, offset=offset)
        early = early or next(r["claim"]["claimId"] for r in result["items"] if r["claim"]["state"] == "RELEVANT")
        messages += [AIMessage(content="", tool_calls=[{"name": "get_claim_inventory", "args": {"offset": offset}, "id": f"p{n}"}]),
                     ToolMessage(content=json.dumps(result), tool_call_id=f"p{n}")]
    view = DraftHistoryMiddleware(ctx)._view(messages)
    raw = {m.tool_call_id for m in view if isinstance(m, ToolMessage)}
    assert "p0" not in raw, "the first page's raw result is gone"
    assert early in visible_text(view), "but the claim from it is still available for binding"
    r = call(tools, "author_legal_requirement", requirement_key="R-early", title="t", operative_claim_ids=[early] if CLAIMS[early]["claimType"] == "DUTY" else [full("656289")],
             applicability_claim_ids=[full("c1d5c5")])
    assert r["outcome"] == "PASSED"


def test_compaction_never_drops_state_the_next_valid_transition_needs():
    """Randomized interleavings through the real tools: after every round the model-visible view holds all needed state."""
    definitions = [cid for cid, c in CLAIMS.items() if c["claimType"] == "DEFINITION"]
    for seed in range(40):
        rng = random.Random(seed)
        _, ctx, tools, _ = restored()
        middleware = DraftHistoryMiddleware(ctx)
        messages, n = [HumanMessage(content="go")], 0

        def run(name, **args):
            nonlocal n
            n += 1
            ctx.model_turn = n
            result = call(tools, name, **args)
            messages.extend([AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": f"r{n}"}]), ToolMessage(content=json.dumps(result), tool_call_id=f"r{n}")])

        def author(key, op, app, qual, exc, context, name=None):
            run("author_legal_requirement", requirement_key=name or key, title=key, operative_claim_ids=[full(p) for p in op], applicability_claim_ids=[full(p) for p in app],
                qualifier_claim_ids=[full(p) for p in qual], exception_claim_ids=[full(p) for p in exc], context_claim_ids=[full(p) for p in context])

        run("start_rule_authoring")
        try:
            for _ in range(rng.randint(8, 24)):
                choice = rng.random()
                if choice < 0.35:
                    run("get_claim_inventory", kind=rng.choice(["CLAIMS", "UNACCOUNTED_CLAIMS", "REQUIREMENTS", "RELATIONS"]), limit=rng.choice([5, 20, 50]), offset=rng.choice([0, 20, 40, -1]))
                elif choice < 0.5:
                    run("get_rule_authoring_context", role=rng.choice([None, "OPERATIVE_PROPOSITION", "UNACCOUNTED"]), offset=rng.choice([0, 40]))
                elif choice < 0.8:
                    author(*PLAN48[rng.randrange(len(PLAN48))])
                else:
                    key, op, *_ = PLAN48[rng.randrange(len(PLAN48))]
                    run("author_legal_requirement", requirement_key="bad-" + key, title="t", operative_claim_ids=[full(op[0])], applicability_claim_ids=[rng.choice(definitions)])
                view = middleware._view(messages)
                text = visible_text(view)
                bound = ctx.authoring.bound()
                needed = [c["claimId"] for c in ctx.authoring.claims() if CLAIM_ROLES[c["claimType"]] == "APPLICABILITY_CONDITION" or c["claimId"] not in bound]
                assert all(cid in text for cid in needed), f"seed {seed}: a claim the next transition may need left the view"
                newest = sorted(ctx.authoring.outstanding.values(), key=lambda item: -item["sequence"])
                for problem in newest[:3]:
                    assert problem["rejectionCode"] in text and str(problem["requiredAction"]) in text, f"seed {seed}: a recent unresolved rejection left the view"
                if newest:
                    assert f"({len(newest)} unresolved" in text, f"seed {seed}: the digest must state how many rejections are unresolved"
                assert len(view) <= 24, f"seed {seed}: the view grew with the run ({len(view)} messages)"
        except NoProgressDetected:
            pass  # a third identical rejection is genuine stagnation: the runtime rightly ends that run


def test_compaction_keeps_the_view_bounded_however_long_the_run():
    _, ctx, tools, _ = restored()
    call(tools, "start_rule_authoring")
    middleware = DraftHistoryMiddleware(ctx)
    messages, sizes = [HumanMessage(content="go")], []
    for n in range(300):
        result = call(tools, "get_claim_inventory", kind="CLAIMS", limit=20, offset=20 * (n % 3))
        messages += [AIMessage(content="", tool_calls=[{"name": "get_claim_inventory", "args": {}, "id": f"b{n}"}]), ToolMessage(content=json.dumps(result), tool_call_id=f"b{n}")]
        sizes.append((len(middleware._view(messages)), view_chars(middleware._view(messages))))
    assert max(s[0] for s in sizes) <= 8, "message count is flat however many reads happen"
    assert max(s[1] for s in sizes[100:]) <= max(s[1] for s in sizes[:100]) * 1.05, "and so are its characters: no growth with run length"


# --- end-to-end through the real middleware ---------------------------------------------------------------------------------
def test_restart_after_navigation_needs_no_reread_to_author_the_first_requirement(tmp_path, monkeypatch):
    """A restarted Agent has a fresh transcript and a fresh working set; the digest alone is enough to continue."""
    _, ctx, _, _ = restored()
    probe = NavigateAndAuthorProbe(plan=PLAN48, pages=0, extra_reads=0, stop_after=1)
    run_agent(ctx, probe, tmp_path, monkeypatch)
    assert probe.tally() == {"start_rule_authoring": 1, "author_legal_requirement": 1} and probe.rereads == 0
    assert "R1-export" in ctx.draft["legalRequirements"]


def test_context_size_is_bounded_and_the_whole_run_costs_less_than_before(tmp_path, monkeypatch):
    """The digest costs ~8 KB per request but ends the reread loop: peak is within 10% of before, the run total is much lower."""
    _, ctx, _, _ = restored()
    probe = NavigateAndAuthorProbe(plan=PLAN48)
    model = run_agent(ctx, probe, tmp_path, monkeypatch)
    sizes = [view_chars(v) for v in model.views]
    assert probe.tally()["get_claim_inventory"] == 5 and len(ctx.draft["legalRequirements"]) == 9
    assert max(sizes) <= PREFIX_MAX_REQUEST_CHARS * 1.10, f"peak request {max(sizes)} chars"
    assert sum(sizes) < PREFIX_TOTAL_CHARS * 0.80 and len(sizes) < PREFIX_REQUESTS, f"total {sum(sizes)} chars over {len(sizes)} requests"
    steady = sizes[len(sizes) // 2:]
    assert max(steady) <= max(sizes[:6]) , "once the window is full requests do not grow with run length"
    (tmp_path / "request-sizes.json").write_text(json.dumps({"maxChars": max(sizes), "totalChars": sum(sizes), "requests": len(sizes)}))


def test_authoring_context_telemetry_is_emitted_on_change_without_source_text(tmp_path, monkeypatch):
    _, ctx, _, _ = restored()
    events = []
    session = AgentStreamSession(assessment_id=None, run_id="offline", correlation_id="offline", boundary_name="rule-set-preparation", emit_payload=events.append,
                                 boundary_type="RULE_SET_PREPARATION", preparation_run_id=FX["preparationId"])
    with activate_agent_stream(session):
        run_agent(ctx, NavigateAndAuthorProbe(plan=PLAN48, stop_after=2), tmp_path, monkeypatch)
    rows = [e["data"] for e in events if e.get("data", {}).get("activity_kind") == "RULE_AUTHORING_CONTEXT"]
    assert rows and len({json.dumps(r, sort_keys=True) for r in rows}) == len(rows), "emitted only when the digest changed"
    expected = {"frozenInventoryRevision", "authoringContextRevision", "inventoryPagesSurfaced", "unreadClaimCount", "outstandingRejectionCode", "authoredRequirements", "authoredAssessmentRules", "digestBytes"}
    assert expected <= set(rows[0]) and rows[-1]["authoredRequirements"] == 2 and rows[-1]["frozenInventoryRevision"] == 1
    assert not any("statement" in json.dumps(r) or "claimId" in json.dumps(r) for r in rows)
