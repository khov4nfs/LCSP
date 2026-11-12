"""Semantic eval oracle controls: label mismatches must be detected, not masked."""
import copy

from rule_set_preparation.eval_semantics import evaluate_preparation_semantics
from test_preparation_scope_review import fixture


def seeded():
    graph, decisions = fixture()
    gold = {
        "schemaVersion": "PREPARATION_SEMANTIC_GOLD_V1",
        "legalSourceVersionId": graph["legalSourceVersionId"],
        "goldApprovalStatus": "SYNTHETIC_FIXTURE",
        "normativeClaims": [
            {"claimId": c["claimId"],
             "actor": c["operative"]["actor"],
             "modality": c["operative"]["modality"],
             "action": c["operative"]["action"],
             "claimType": c["claimType"],
             "sourceNodeIds": c["sourceNodeIds"]}
            for c in graph["claims"] if c["operative"]
        ],
        "developmentClaimIds": ["dev"],
        "materialContextClaimIds": ["condition"],
        "materialRelationIds": ["r-condition"],
        "materialRelations": [
            {"kind": "CONDITION_OF", "fromClaimId": "condition", "toClaimId": "dev"}
        ],
    }
    return gold, graph, decisions


def codes(gold, graph, decisions):
    return {error["code"] for error in
            evaluate_preparation_semantics(gold, graph, decisions)["errors"]}


def test_synthetic_gold_match_is_not_a_production_acceptance():
    gold, graph, decisions = seeded()
    result = evaluate_preparation_semantics(gold, graph, decisions)
    assert result["fixtureMatched"]
    assert result["errors"] == []
    assert result["productionAcceptance"] == "NOT_PROVEN"
    assert result["liveModelAcceptance"] == "NOT_RUN"


def test_missing_development_claim_and_wrong_actor_are_detected():
    gold, graph, decisions = seeded()
    graph["claims"] = [c for c in graph["claims"] if c["claimId"] != "dev"]
    assert "MISSING_NORMATIVE_CLAIM" in codes(gold, graph, decisions)
    gold, graph, decisions = seeded()
    graph["claims"][0]["operative"]["actor"] = "Government"
    assert "CLAIM_ACTOR_ACTION_MISMATCH" in codes(gold, graph, decisions)


def test_false_deploy_inclusion_and_missing_context_are_detected():
    gold, graph, decisions = seeded()
    decisions[1]["stage"] = "DEVELOPMENT"
    assert "DEPLOYMENT_DUTY_LEAK" in codes(gold, graph, decisions)
    gold, graph, decisions = seeded()
    graph["relations"] = []
    assert "MATERIAL_CONTEXT_MISSING" in codes(gold, graph, decisions)


def test_invented_normative_claim_and_unrelated_context_are_detected():
    gold, graph, decisions = seeded()
    invented = copy.deepcopy(graph["claims"][1])
    invented["claimId"] = "invented"
    invented["operative"]["actor"] = "Another actor"
    graph["claims"].append(invented)
    assert "INVENTED_NORMATIVE_CLAIM" in codes(gold, graph, decisions)
    gold, graph, decisions = seeded()
    graph["relations"].append({
        "relationId": "unrelated", "kind": "QUALIFIES",
        "fromClaimId": "unlinked", "toClaimId": "dev",
    })
    assert "UNRELATED_CONTEXT_LEAK" in codes(gold, graph, decisions)


def test_gold_version_mismatch_fails_closed():
    gold, graph, decisions = seeded()
    gold["legalSourceVersionId"] = "other-v"
    try:
        evaluate_preparation_semantics(gold, graph, decisions)
    except ValueError as error:
        assert "SOURCE_VERSION_MISMATCH" in str(error)
    else:
        raise AssertionError("must not grade outputs against a different source version")


def test_parity_oracle_detects_changed_stage_without_requiring_identical_language():
    from rule_set_preparation.eval_semantics import compare_preparation_locale_parity
    en_gold, en_graph, en_decisions = seeded()
    vi_gold, vi_graph, vi_decisions = seeded()
    matched = compare_preparation_locale_parity(
        en_graph, en_decisions, vi_graph, vi_decisions
    )
    assert matched["parity"] == "MATCH"
    assert matched["semanticTruth"] == "NOT_ESTABLISHED_BY_PARITY"
    vi_decisions[1]["stage"] = "DEVELOPMENT"
    mismatch = compare_preparation_locale_parity(
        en_graph, en_decisions, vi_graph, vi_decisions
    )
    assert mismatch["parity"] == "MISMATCH"


def test_parity_rejects_different_source_versions():
    from rule_set_preparation.eval_semantics import compare_preparation_locale_parity
    _, en_graph, en_decisions = seeded()
    _, vi_graph, vi_decisions = seeded()
    vi_graph["legalSourceVersionId"] = "other-version"
    try:
        compare_preparation_locale_parity(
            en_graph, en_decisions, vi_graph, vi_decisions
        )
    except ValueError as error:
        assert "PARITY_SOURCE_MISMATCH" in str(error)
    else:
        raise AssertionError("cross-corpus parity is not meaningful")


def test_parity_detects_material_context_relation_loss():
    from rule_set_preparation.eval_semantics import compare_preparation_locale_parity
    _, en_graph, en_decisions = seeded()
    _, vi_graph, vi_decisions = seeded()
    vi_graph["relations"] = []
    parity = compare_preparation_locale_parity(
        en_graph, en_decisions, vi_graph, vi_decisions
    )
    assert parity["parity"] == "MISMATCH"


def test_relation_oracle_detects_wrong_direction_or_missing_relation():
    gold, graph, decisions = seeded()
    graph["relations"] = []
    result = evaluate_preparation_semantics(gold, graph, decisions)
    assert result["criticalErrorCounts"]["MATERIAL_RELATION_MISSING"] == 1
    gold, graph, decisions = seeded()
    graph["relations"][0]["fromClaimId"] = "unlinked"
    result = evaluate_preparation_semantics(gold, graph, decisions)
    assert result["criticalErrorCounts"]["MATERIAL_RELATION_MISSING"] == 1


def test_parity_rejects_equally_fabricated_actor_frames():
    from rule_set_preparation.eval_semantics import compare_preparation_locale_parity
    _, en_graph, en_decisions = seeded()
    _, vi_graph, vi_decisions = seeded()
    en_decisions[0]["actor"] = "Fabricated actor"
    vi_decisions[0]["actor"] = "Fabricated actor"
    try:
        compare_preparation_locale_parity(en_graph, en_decisions, vi_graph, vi_decisions)
    except ValueError as error:
        assert "PROVENANCE_OR_ACTOR_MISMATCH" in str(error)
    else:
        raise AssertionError("matching unsupported claims must not pass parity")
