"""Pure evaluator tests: no Docker, database or provider."""
from copy import deepcopy

import pytest

from vertical.discovery_files_eval import (
    APPROVAL, evaluate_anchors, evaluate_gates, limits, require_live_approval,
    usage_metrics, write_report,
)


def test_approval_is_literal_and_quota_overrides_only_downward():
    for env in ({}, {"LCSP_FBD_LIVE_APPROVED": "true"}, {"LCSP_FBD_LIVE_APPROVED": APPROVAL + " "}):
        with pytest.raises(RuntimeError, match="refused"):
            require_live_approval(env)
    require_live_approval({"LCSP_FBD_LIVE_APPROVED": APPROVAL})
    assert limits({})["LCSP_RSP_MAX_MODEL_CALLS"] == 600
    assert limits({"LCSP_RSP_MAX_MODEL_CALLS": "20"})["LCSP_RSP_MAX_MODEL_CALLS"] == 20
    for key, value in (("LCSP_RSP_MAX_MODEL_CALLS", "601"), ("LCSP_RSP_MAX_INPUT_TOKENS", "12000001"), ("LCSP_RSP_MAX_MODEL_CALLS", "0")):
        with pytest.raises(ValueError):
            limits({key: value})


def test_usage_deduplicates_physical_attempts_and_counts_cache_once():
    usage = {"inputTokens": 10, "cachedInputTokens": 20, "cacheWriteTokens": 5,
             "inputTokensIncludingCache": 35, "outputTokens": 2}
    start = {"event": "MODEL_ATTEMPT", "invocationId": "1", "agentRole": "claim-author", "attemptStatus": "STARTED"}
    end = {**start, "attemptStatus": "COMPLETED", **usage}
    response = {"event": "MODEL_RESPONSE", "invocationId": "1", "agentRole": "claim-author", "usage": usage}
    result = usage_metrics([start, end, response, start])
    assert result["modelCalls"] == 1 and result["tokens"] == 37 and result["accountingComplete"]
    assert result["roles"]["claim-author"]["cachedInputTokens"] == 20
    result = usage_metrics([start, end, response, {**start, "invocationId": "2", "agentRole": "claim-author"}])
    assert result["modelCalls"] == 2 and result["missingUsageCalls"] == 1
    assert not result["accountingComplete"]
    failed = {**start, "invocationId": "3", "attemptStatus": "FAILED"}  # rejected by the provider: nothing to account for
    result = usage_metrics([start, end, response, failed])
    assert result["modelCalls"] == 2 and result["accountingComplete"]
    assert not usage_metrics([])["accountingComplete"]


def fixture():
    doc, target = "luat-134", "luat-so-71-2025-qh15-luat-cong-nghiep-cong-nghe-so"
    paths = ["article/14/clause/1/point/" + p for p in ("a", "b", "c", "d", "e", "g", "đ")]
    paths += ["article/33", "article/2", "article/13/clause/4"]
    graph = {"nodes": [{"nodeId": str(i), "documentId": doc, "structuralPath": f"/document/{doc}/{p}"} for i, p in enumerate(paths)],
             "references": [{"referenceId": "r", "fromNodeId": "9", "toNodeId": None, "resolutionState": "UNRESOLVED"}]}
    claims = [{"claimId": str(i), "state": "RELEVANT", "claimType": "DUTY",
               "sourceSupport": [{"nodeId": str(i)}]} for i in range(7)]
    claims += [{"claimId": "repeal", "state": "RELEVANT", "claimType": "CONTEXT", "sourceSupport": [{"nodeId": "7"}],
                "semanticFrame": {"legalEffect": {"kind": "REPEALS", "targets": [], "unresolvedTargets": [
                    {"documentIdentifier": target, "locator": "art-1", "reason": "Target absent from this source"}]}}},
               {"claimId": "scope", "state": "RELEVANT", "claimType": "SCOPE", "sourceSupport": [{"nodeId": "8"}]},
               {"claimId": "ref", "state": "RELEVANT", "claimType": "CONDITION", "sourceSupport": [{"nodeId": "9"}]}]
    refs = [{"referenceId": "r", "unresolved": True, "material": False, "nonMaterialReason": "qd-33 absent from this source"}]
    golden = {"document": doc, "anchors": [
        {"path": "article/14/clause/1", "needs": ["DUTY"], "point_labels": ["a", "b", "c", "d", "e", "g", "đ"]},
        {"path": "article/33", "needs": ["any"], "legal_effect": "REPEALS", "target_document": target},
        {"path": "article/2", "needs": ["CONDITION|SCOPE"]},
        {"path": "article/13/clause/4", "needs": ["any"], "reference_to_document": "qd-33"}],
        "gates": {"max_model_calls": 400, "max_tokens": 5000000, "max_minutes": 45, "max_tool_reject_ratio": .10, "must_end": "CLAIM_INVENTORY_READY"}}
    return golden, graph, claims, refs


def test_anchor_subtrees_point_labels_repeal_and_unresolved_reference():
    golden, graph, claims, refs = fixture()
    assert all(a["pass"] for a in evaluate_anchors(golden, graph, claims, refs))
    bad = deepcopy(claims)
    bad[6]["claimType"] = "CONTEXT"
    bad[7]["semanticFrame"]["legalEffect"]["unresolvedTargets"][0]["documentIdentifier"] = "another-law"
    result = evaluate_anchors(golden, graph, bad, [])
    assert result[0]["missingPoints"] == ["đ"]
    assert not result[1]["pass"] and not result[3]["pass"]
    bad = deepcopy(graph)
    bad["nodes"][8]["structuralPath"] += "0"
    assert not evaluate_anchors(golden, bad, claims, refs)[2]["pass"]


def test_all_threshold_edges_and_incomplete_usage_fail_closed(tmp_path):
    golden, graph, claims, refs = fixture()
    metrics = {"mode": "SYNTHETIC", "accountingComplete": True, "modelCalls": 400, "tokens": 5000000,
        "minutes": 45, "toolRejectRatio": .10, "claimPhase": "CLAIM_INVENTORY_READY", "executionState": "RUNNING",
        "frontierComplete": True, "unaccountedLocators": [], "conflictingLocators": [],
        "referenceAccountingComplete": True, "ruleSets": 0}
    anchors = evaluate_anchors(golden, graph, claims, refs)
    assert all(evaluate_gates(metrics, golden, anchors).values())
    for field, value, gate in [("modelCalls", 401, "model_calls"), ("tokens", 5000001, "tokens"),
        ("minutes", 45.001, "minutes"), ("toolRejectRatio", .1001, "tool_reject_ratio"),
        ("claimPhase", "CLAIM_DISCOVERY", "terminal_phase"), ("executionState", "PAUSED", "terminal_phase"),
        ("unaccountedLocators", ["art-1"], "article_locators"), ("conflictingLocators", ["art-1"], "article_locators"),
        ("frontierComplete", False, "frontier_complete"), ("referenceAccountingComplete", False, "references"),
        ("ruleSets", 1, "discovery_only"), ("errorType", "RuntimeError", "runtime")]:
        assert not evaluate_gates({**metrics, field: value}, golden, anchors)[gate]
    result = write_report(tmp_path, {**metrics, "accountingComplete": False}, golden, graph, claims, refs)
    assert result["result"] == "FAIL"
    assert not result["gates"]["model_calls"] and not result["gates"]["tokens"]
    assert "FAIL" in (tmp_path / "report.md").read_text()
    assert (tmp_path / "claims.json").exists()


def test_scripted_native_tasks_each_own_exactly_one_article(monkeypatch):
    import json
    from types import SimpleNamespace
    from vertical.discovery_files_eval import scripted_model
    paths = [f'/legal-source/doc/dieu-{i}.md' for i in (1, 2, 3)]
    source = SimpleNamespace(source_files={p: [str(i)] for i, p in enumerate(paths, 1)},
        file_articles={p: f'art-{i}' for i, p in enumerate(paths, 1)},
        nodes={str(i): {'content': f'Article {i} content'} for i in (1, 2, 3)},
        locators={str(i): f'art-{i}' for i in (1, 2, 3)})
    model = scripted_model(SimpleNamespace(source_graph=source))
    tasks = [m.tool_calls[0] for m in model.queues['rule-set-preparation'] if m.tool_calls and m.tool_calls[0]['name'] == 'task']
    assert len(tasks) == 3
    for task in tasks:
        assignment = json.loads(task['args']['description'])
        assert len(assignment['sourceFiles']) == len(assignment['claimFiles']) == 1
    commits = [m.tool_calls[0] for m in model.queues['claim-author'] if m.tool_calls and m.tool_calls[0]['name'] == 'commit_claims']
    assert len(commits) == 3 and all(len(c['args']['paths']) == 1 for c in commits)

    from middleware.usage_metering import extract_provider_usage
    monkeypatch.setattr('middleware.usage_metering.active_agent_role', lambda: 'rule-set-preparation')
    message = scripted_model(SimpleNamespace(source_graph=source)).invoke('offline fixture')
    usage = extract_provider_usage(message, model)
    assert usage['inputTokensIncludingCache'] == usage['inputTokens'] == '20'
    assert usage['outputTokens'] == '2' and usage['cachedInputTokens'] == usage['cacheWriteTokens'] == '0'
