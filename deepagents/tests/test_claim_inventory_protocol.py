"""Provider-free native-tool protocol tests, including real TypeScript Gate convergence."""
import json
from copy import deepcopy

import pytest
from middleware.failure_policy import NoProgressDetected
from rule_set_preparation.claim_inventory import claim_id, fingerprint, normalized_graph

from claim_protocol_harness import RUN, ScriptedApi, runtime, bridge, call, discover, author


@pytest.fixture(scope="module")
def seed():
    return bridge({"action": "INIT"})


def test_real_native_tools_and_api_gate_converge_without_provider_or_preparation(seed):
    seed, ctx, tools, api = runtime(seed)
    remap = discover(seed, ctx, tools)
    ready = call(tools, "finalize_semantic_claim_inventory")
    assert ready["outcome"] == "PASSED", ready
    assert ctx.inventory.phase == "CLAIM_INVENTORY_READY"
    frozen = deepcopy(ctx.inventory.frozen)
    author(seed, ctx, tools, remap)
    result = call(tools, "validate_compliance_rule_set")
    assert result["outcome"] == "PASSED", result
    assert ctx.inventory.phase == "SUBMISSION_READY"
    assert ctx.inventory.frozen == frozen
    assert call(tools, "submit_compliance_rule_set")["preparationState"] == "SUCCEEDED"
    assert ctx.inventory.phase == "COMPLETION"
    assert api.submitted["claimInventory"]["fingerprint"] == ready["fingerprint"]
    assert all(r["sourceRefs"] for r in api.submitted["legalRequirements"])
    assert all(r["sourceRefs"] for r in api.submitted["assessmentRules"])


def test_incomplete_inventory_feedback_then_no_progress_before_submission(seed):
    _, ctx, tools, _ = runtime(seed)
    # The graph schema needs at least one claim, but missing reviews are a real inventory gap.
    c = seed["packet"]["semanticGraph"]["claims"][0]
    call(tools, "register_semantic_claim", identity_key="duty", source_node_ids=c["sourceNodeIds"], claim_type="DUTY", statement=c["statement"], actor=c["operative"]["actor"], action=c["operative"]["action"])
    assert "NO_PROGRESS" not in call(tools, "validate_semantic_claim_inventory")
    second = call(tools, "validate_semantic_claim_inventory")
    assert second["NO_PROGRESS"]
    with pytest.raises(NoProgressDetected):
        call(tools, "validate_semantic_claim_inventory")
    assert ctx.submission is None


def test_valid_discovery_repair_then_rule_repair_keeps_denominator_fixed(seed):
    seed, ctx, tools, _ = runtime(seed)
    remap = discover(seed, ctx, tools)
    missing_node = next(iter(ctx.draft["sourceAccounting"]))
    review = ctx.draft["sourceAccounting"].pop(missing_node)
    assert call(tools, "validate_semantic_claim_inventory")["outcome"] == "FAILED"
    ctx.draft["sourceAccounting"][missing_node] = review
    assert call(tools, "finalize_semantic_claim_inventory")["outcome"] == "PASSED"
    frozen_hash = ctx.inventory.frozen_fingerprint
    author(seed, ctx, tools, remap)
    req = next(iter(ctx.draft["legalRequirements"].values()))
    removed = req["claimBindings"].pop()
    first = call(tools, "validate_compliance_rule_set")
    assert first["outcome"] == "FAILED"
    req["claimBindings"].append(removed)
    assert call(tools, "validate_compliance_rule_set")["outcome"] == "PASSED"
    assert ctx.inventory.frozen_fingerprint == frozen_hash


def test_freeze_forbids_mutation_and_reopen_invalidates_and_remaps(seed):
    seed, ctx, tools, api = runtime(seed)
    remap = discover(seed, ctx, tools)
    assert call(tools, "finalize_semantic_claim_inventory")["outcome"] == "PASSED"
    author(seed, ctx, tools, remap)
    old = ctx.draft_packet()
    cid = next(iter(ctx.inventory.identities))
    assert call(tools, "update_semantic_claim", claim_id=cid, claim_type="CONTEXT", statement="changed")["outcome"] == "FAILED"
    reopened = call(tools, "reopen_semantic_claim_inventory", reason="Additional material claim discovered in source review")
    assert reopened["revision"] == 2
    assert not ctx.draft["legalRequirements"] and not ctx.draft["assessmentRules"]
    assert ctx.inventory.phase == "CLAIM_DISCOVERY" and cid not in ctx.inventory.identities
    stale = api.validate_compliance_rule_set(RUN, old)
    assert any(x["code"] in ["STALE_INVENTORY_BINDING", "CLAIM_INVENTORY_REQUIRED"] for x in stale["failures"])


def test_canonical_identity_ignores_wording_order_and_call_order():
    one = claim_id(RUN, 1, ["b", "a"], "  export   Duty ")
    assert one == claim_id(RUN, 1, ["a", "b"], "export duty")
    assert one != claim_id(RUN, 2, ["a", "b"], "export duty")


def test_schema_failure_no_progress_uses_effective_state_not_invalid_literal(seed):
    _, ctx, tools, _ = runtime(seed)
    call(tools, "register_semantic_claim", identity_key="test", source_node_ids=[], claim_type="DUTY", statement="bad one")
    result = call(tools, "register_semantic_claim", identity_key="other", source_node_ids=[], claim_type="DUTY", statement="different invalid wording")
    assert result["NO_PROGRESS"]
    with pytest.raises(NoProgressDetected):
        call(tools, "register_semantic_claim", identity_key="third", source_node_ids=[], claim_type="DUTY", statement="still invalid")
    assert not ctx.inventory.identities


def test_bounded_inventory_queries_and_no_giant_mutation_tool(seed):
    seed, ctx, tools, _ = runtime(seed)
    discover(seed, ctx, tools)
    assert "add_to_packet_draft" not in tools
    result = call(tools, "get_claim_inventory", kind="CLAIMS", limit=2)
    assert len(result["items"]) == 2 and result["nextOffset"] == 2
    assert len(json.dumps(result)) < 24000


def test_four_claims_in_one_review_stay_distinct_and_omissions_have_specific_ids(seed):
    seed, ctx, tools, api = runtime(seed)
    remap = discover(seed, ctx, tools)
    node = next(n for n, review in ctx.draft["sourceAccounting"].items() if not review["claimIds"])
    ids = {}
    for kind, statement in [("DUTY", "The authority must compensate eligible persons"),
                            ("CONTEXT", "Context about the compensation regime"),
                            ("EXCEPTION", "Except where a final order excludes compensation"),
                            ("TRANSITION_RULE", "Compensation applies to claims arising after 2030-01-01")]:
        result = call(tools, "register_semantic_claim", identity_key="mixed." + kind, source_node_ids=[node],
                      claim_type=kind, statement=statement, **({"actor": "The authority", "action": "compensate eligible persons"} if kind == "DUTY" else {}))
        ids[kind] = result["claim"]["claimId"]
    for kind in ["EXCEPTION", "TRANSITION_RULE"]:
        assert call(tools, "link_semantic_claims", from_claim_id=ids["DUTY"], to_claim_id=ids[kind], kind="EXCEPTION" if kind == "EXCEPTION" else "TEMPORALLY_LIMITS")["outcome"] == "PASSED"
    assert call(tools, "review_source_node", source_node_id=node, claim_ids=list(ids.values()))["outcome"] == "PASSED"
    assert call(tools, "finalize_semantic_claim_inventory")["outcome"] == "PASSED"
    assert len(next(r for r in ctx.inventory.frozen["sourceAccounting"] if r["sourceNodeId"] == node)["claimIds"]) == 4
    author(seed, ctx, tools, remap)
    result = call(tools, "author_legal_requirement", requirement_key="external-compensation", title="Compensation",
                  operative_claim_ids=[ids["DUTY"]], applicability_claim_ids=[], context_claim_ids=[ids["CONTEXT"]],
                  exception_claim_ids=[ids["EXCEPTION"]], qualifier_claim_ids=[ids["TRANSITION_RULE"]], non_repository_duty=True,
                  non_assessable_reason="Performance is an external authority payment, not a repository capability")
    assert result["outcome"] == "PASSED", result
    assert call(tools, "validate_compliance_rule_set")["outcome"] == "PASSED"
    for kind in ["DUTY", "TRANSITION_RULE", "EXCEPTION"]:
        candidate = ctx.draft_packet()
        requirement = next(r for r in candidate["legalRequirements"] if r["legalRequirementId"] == "external-compensation")
        requirement["claimBindings"] = [b for b in requirement["claimBindings"] if b["claimId"] != ids[kind]]
        result = api.validate_compliance_rule_set(RUN, candidate)
        assert {"code": "UNACCOUNTED_SEMANTIC_CLAIM", "ref": "claim:" + ids[kind]} in [{"code": f["code"], "ref": f["ref"]} for f in result["failures"]]
    candidate = ctx.draft_packet()
    candidate["assessmentRules"][0]["requiredEvidence"] = ["System MUST implement automatic blocking and automatic unblocking"]
    result = api.validate_compliance_rule_set(RUN, candidate)
    assert any(f["code"] == "DOWNSTREAM_AUTHORITY_MISMATCH" for f in result["failures"])


def test_rule_validation_no_progress_cannot_be_evaded_by_titles_or_progress_notes(seed):
    seed, ctx, tools, _ = runtime(seed)
    remap = discover(seed, ctx, tools)
    call(tools, "finalize_semantic_claim_inventory")
    author(seed, ctx, tools, remap)
    requirement = next(iter(ctx.draft["legalRequirements"].values()))
    requirement["claimBindings"].pop()
    assert call(tools, "validate_compliance_rule_set")["outcome"] == "FAILED"
    requirement["title"] = "A different label does not repair missing claim authority"
    assert call(tools, "validate_compliance_rule_set")["NO_PROGRESS"]
    requirement["title"] = "Yet another label"
    with pytest.raises(NoProgressDetected):
        call(tools, "validate_compliance_rule_set")
    assert not ctx.submission


def test_indexed_review_and_paginated_claim_lookup_at_corpus_scale(seed):
    import time
    _, ctx, tools, _ = runtime(seed)
    nodes = list(ctx.source_graph.nodes)
    started = time.perf_counter()
    for i in range(2000):
        result = ctx.inventory.put_claim("scale." + str(i), [nodes[i % len(nodes)]], "CONTEXT",
                                         "Synthetic contextual proposition " + str(i), None, None, True, None)
        assert result["outcome"] == "PASSED"
    for node, claims in ctx.inventory.claims_by_node.items():
        result = call(tools, "review_source_node", source_node_id=node, claim_ids=sorted(claims))
        # At most 128 claims per review is the bounded tool contract.
        if len(claims) <= 128:
            assert result["outcome"] == "PASSED"
    result = call(tools, "get_claim_inventory", kind="CLAIMS", source_node_id=nodes[0], limit=10)
    assert len(result["items"]) == 10 and result["total"] >= 100
    assert time.perf_counter() - started < 10


def test_native_managed_agent_uses_same_thread_phase_protocol_without_provider(seed, tmp_path, monkeypatch):
    from types import SimpleNamespace
    from langchain_core.messages import AIMessage
    from middleware import usage_metering
    from rule_set_preparation.runner import run_rule_set_preparation
    from functools import partial
    from rule_set_preparation.tools import RuleSetPreparationContext
    monkeypatch.setattr("rule_set_preparation.runner.RuleSetPreparationContext",partial(RuleSetPreparationContext,frontier_enabled=False))
    from test_rule_set_preparation_native_isolation_preparation import RuleSetPreparationScriptedModel
    # Record a scripted legal author's typed actions, then drive the actual Managed Deep Agent graph.
    seed, ctx, tools, _ = runtime(seed)
    actions = []
    def record(name, args):
        actions.append(AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": "phase-" + str(len(actions))}]))
    class RecordingTool:
        def __init__(self, name, tool): self.name, self.tool = name, tool
        def invoke(self, args):
            record(self.name, args)
            return self.tool.invoke(args)
    recording = {name: RecordingTool(name, tool) for name, tool in tools.items()}
    remap = discover(seed, ctx, recording)
    call(recording, "finalize_semantic_claim_inventory")
    author(seed, ctx, recording, remap)
    call(recording, "validate_compliance_rule_set")
    record("submit_compliance_rule_set", {})
    source = seed["source"]
    graph = source["documentGraph"]
    nodes = {n["nodeId"]: n for n in graph["nodes"]}
    owners = {m["chunkId"]: m["legalDocumentNodeId"] for m in graph["chunkMappings"]}
    bundle = {"preparationRunId": RUN, "executionState": "RUNNING", "legalSourceVersionId": source["legalSourceVersionId"],
              "legalSourceVersion": "SYNTHETIC-PROTOCOL-PROBE", "documentGraph": graph,
              "documents": [{"documentId": source["chunks"][0]["documentId"], "title": "Synthetic protocol probe",
                             "sourceUrl": "https://example.invalid/protocol-probe", "sourceSha256": "sha256:" + "a" * 64,
                             "sourceEffectStatus": "IN_FORCE", "chunks": [{**c, "chunkId": c["id"], "content": nodes[owners[c["id"]]]["content"], "hierarchy": {"path": c["locator"].split("::")}} for c in source["chunks"]]}]}
    api = ScriptedApi(seed)
    api.claim_rule_set_preparation = lambda run_id: deepcopy(bundle)
    api.fail_rule_set_preparation = lambda *args: None
    original = usage_metering.assert_model_identity
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda model, response=None: None if isinstance(model, RuleSetPreparationScriptedModel) else original(model, response))
    monkeypatch.setattr(usage_metering, "logger", SimpleNamespace(info=lambda *a, **kw: None, warning=lambda *a, **kw: None, error=lambda *a, **kw: None, debug=lambda *a, **kw: None))
    model = RuleSetPreparationScriptedModel(responses=actions)
    result = run_rule_set_preparation(api, RUN, model=model, work_dir=tmp_path)
    assert result["state"] == "SUCCEEDED", result
    assert api.submitted["claimInventory"]["revision"] == 1
    bound = {name for names in model.bound_tool_names for name in names}
    assert "register_semantic_claim" in bound and "finalize_semantic_claim_inventory" in bound
    assert "add_to_packet_draft" not in bound


def test_typed_tools_convert_for_provider_and_candidate_removal_preserves_freeze(seed):
    from langchain_google_genai import ChatGoogleGenerativeAI
    seed, ctx, tools, _ = runtime(seed)
    ChatGoogleGenerativeAI(model="gemini-3.5-flash-lite", api_key="fixture").bind_tools(list(tools.values()))
    remap = discover(seed, ctx, tools)
    call(tools, "finalize_semantic_claim_inventory")
    author(seed, ctx, tools, remap)
    frozen = deepcopy(ctx.inventory.frozen)
    requirement = next(iter(ctx.draft["legalRequirements"]))
    result = call(tools, "remove_rule_candidate", kind="LEGAL_REQUIREMENT", candidate_id=requirement, reason="Replace an incompatible aggregation")
    assert result["outcome"] == "PASSED" and result["invalidatedAssessmentRules"]
    assert ctx.inventory.frozen == frozen
    author(seed, ctx, tools, remap)
    assert call(tools, "validate_compliance_rule_set")["outcome"] == "PASSED"


@pytest.mark.parametrize("parallel_batch", [False, True])
def test_native_graph_terminates_repeated_inventory_validation_after_feedback(seed, tmp_path, monkeypatch, parallel_batch):
    from langchain_core.messages import AIMessage
    from middleware import usage_metering
    from rule_set_preparation.agent import create_rule_set_preparation_agent
    from test_rule_set_preparation_native_isolation_preparation import RuleSetPreparationScriptedModel
    _, ctx, _, api = runtime(seed)
    claim = seed["packet"]["semanticGraph"]["claims"][0]
    messages = [{"name": "register_semantic_claim", "args": {"identity_key": "single-duty", "source_node_ids": claim["sourceNodeIds"],
                 "claim_type": "DUTY", "statement": claim["statement"], "actor": claim["operative"]["actor"], "action": claim["operative"]["action"]}, "id": "discovery"}]
    messages += [{"name": "validate_semantic_claim_inventory", "args": {}, "id": "invalid-" + str(i)} for i in range(4 if parallel_batch else 3)]
    responses = ([AIMessage(content="", tool_calls=[messages[0]]), AIMessage(content="", tool_calls=messages[1:4]),
                  AIMessage(content="", tool_calls=[messages[4]])] if parallel_batch else
                 [AIMessage(content="", tool_calls=[call]) for call in messages])
    model = RuleSetPreparationScriptedModel(responses=responses)
    original = usage_metering.assert_model_identity
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda m, response=None: None if isinstance(m, RuleSetPreparationScriptedModel) else original(m, response))
    agent = create_rule_set_preparation_agent(context=ctx, legal_source_root=tmp_path, model=model)
    with pytest.raises(NoProgressDetected):
        agent.invoke({"messages": [{"role": "user", "content": "Discover then finalize the source claim inventory"}]})
    assert ctx.inventory.inventory_validation_calls == (4 if parallel_batch else 3) and api.submitted is None
    assert ctx.trace[-1]["phase"] == "CLAIM_INVENTORY_VALIDATION"


def test_empty_inventory_is_actionable_feedback_without_callback_exception(seed):
    _, ctx, tools, _ = runtime(seed)
    result = call(tools, "validate_semantic_claim_inventory")
    assert result["outcome"] == "FAILED" and "INCOMPLETE_STRUCTURAL_ACCOUNTING" in result["gaps"]
    assert ctx.inventory.phase == "CLAIM_DISCOVERY"


def test_legitimate_multiple_narrowings_keep_distinct_criterion_ids(seed):
    seed, ctx, tools, _ = runtime(seed)
    remap = discover(seed, ctx, tools)
    call(tools, "finalize_semantic_claim_inventory")
    author(seed, ctx, tools, remap)
    first = next(iter(ctx.draft["assessmentRules"].values()))
    second = call(tools, "author_assessment_rule", assessment_rule_id="additional-narrowing", concept="A narrower investigation",
                  legal_requirement_ids=first["legalRequirementIds"], investigation_focus="Only one repository endpoint is inspected in this optional investigation")
    assert second["outcome"] == "PASSED"
    assert second["assessmentRule"]["criteria"][0]["criterionId"] != first["criteria"][0]["criterionId"]
    assert call(tools, "validate_compliance_rule_set")["outcome"] == "PASSED"


def test_discovery_reason_rewording_does_not_repair_same_structural_gaps(seed):
    seed, ctx, tools, _ = runtime(seed)
    discover(seed, ctx, tools)
    ctx.draft["sourceAccounting"].pop(next(n for n, row in ctx.draft["sourceAccounting"].items() if row["claimIds"]))
    assert call(tools, "validate_semantic_claim_inventory")["outcome"] == "FAILED"
    review = next(row for row in ctx.draft["sourceAccounting"].values() if not row["claimIds"])
    review["nonSemanticReason"] = "Another explanation for the same structural heading disposition"
    assert call(tools, "validate_semantic_claim_inventory")["NO_PROGRESS"]
    review["nonSemanticReason"] = "A third wording does not review the missing node"
    with pytest.raises(NoProgressDetected):
        call(tools, "validate_semantic_claim_inventory")


def test_parallel_claim_update_cannot_cross_inventory_freeze(seed):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    seed, ctx, tools, api = runtime(seed)
    discover(seed, ctx, tools)
    entered, release = Event(), Event()
    original = api.claim_inventory_operation
    def delayed(run_id, action, revision, **fields):
        if action == "FINALIZE":
            entered.set()
            assert release.wait(5)
        return original(run_id, action, revision, **fields)
    api.claim_inventory_operation = delayed
    claim = next(iter(ctx.draft["semanticClaims"].values()))
    with ThreadPoolExecutor(max_workers=2) as pool:
        freeze = pool.submit(call, tools, "finalize_semantic_claim_inventory")
        assert entered.wait(5)
        update = pool.submit(call, tools, "update_semantic_claim", claim_id=claim["claimId"], claim_type="CONTEXT", statement="Late mutation")
        assert not update.done()
        release.set()
        assert freeze.result()["outcome"] == "PASSED"
        assert update.result()["outcome"] == "FAILED"
    assert normalized_graph(ctx.inventory.graph()) == ctx.inventory.frozen


def test_phase_fingerprints_and_accounting_survive_safe_durable_stream(seed):
    from orchestration.agent_stream import AgentStreamSession, activate_agent_stream
    seed, ctx, tools, _ = runtime(seed)
    events = []
    session = AgentStreamSession(assessment_id=None, run_id="offline-protocol", correlation_id="offline-correlation", boundary_name="rule-set-preparation", emit_payload=events.append, boundary_type="RULE_SET_PREPARATION", preparation_run_id=RUN)
    with activate_agent_stream(session):
        remap = discover(seed, ctx, tools)
        call(tools, "finalize_semantic_claim_inventory")
        author(seed, ctx, tools, remap)
        call(tools, "validate_compliance_rule_set")
    validations = [e["data"] for e in events if e.get("data", {}).get("activity_kind") == "CLAIM_PHASE_VALIDATION"]
    assert [e["phase"] for e in validations] == ["CLAIM_INVENTORY_VALIDATION", "RULE_VALIDATION"]
    assert all(e["durability"] == "DURABLE" and len(e["claim_inventory_fingerprint"]) == 64 for e in validations)
    assert len({e["claim_inventory_fingerprint"] for e in validations}) == 1
    assert validations[0]["coverage"]["semanticClaims"]["unaccounted"] > 0
    assert validations[-1]["coverage"]["semanticClaims"]["unaccounted"] == 0
    transitions = [e["data"]["phase"] for e in events if e.get("data", {}).get("activity_kind") == "CLAIM_PHASE_TRANSITION"]
    assert "CLAIM_INVENTORY_READY" in transitions and "RULE_AUTHORING" in transitions and "SUBMISSION_READY" in transitions


def test_combined_packet_arguments_are_rejected_even_if_provider_ignores_schema(seed):
    _, ctx, tools, _ = runtime(seed)
    result = call(tools, "validate_compliance_rule_set", packet={"legalRequirements": []})
    assert result["outcome"] == "FAILED" and "CLAIM_SCHEMA_INVALID" in result["gaps"]
    assert "replacement packet" in tools["validate_compliance_rule_set"].description
    assert not ctx.draft["legalRequirements"]


def test_callback_runtime_failure_is_not_mislabeled_as_claim_shape_error(seed):
    from tools.common.capabilities.platform.api_client import WorkerCallbackError
    seed, ctx, tools, api = runtime(seed)
    remap = discover(seed, ctx, tools)
    call(tools, "finalize_semantic_claim_inventory")
    author(seed, ctx, tools, remap)
    def unavailable(*args): raise WorkerCallbackError("Synthetic API unavailable", status_code=503)
    api.validate_compliance_rule_set = unavailable
    with pytest.raises(WorkerCallbackError):
        call(tools, "validate_compliance_rule_set")
