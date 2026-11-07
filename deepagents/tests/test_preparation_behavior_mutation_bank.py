"""Synthetic adversarial semantic scoring. No live model or legal gold approval."""
from __future__ import annotations

from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
import pytest
from rule_set_preparation.eval_semantics import CRITICAL, evaluate_preparation_semantics

BANK = Path(__file__).resolve().parents[1] / "evals/fixtures/preparation_adversarial_cases_v1.json"
CASES = json.loads(BANK.read_text(encoding="utf-8"))["cases"]


def seed(row):
    version = "synthetic-v-" + row["id"]
    node = sha256(row["locator"].encode()).hexdigest()

    def claim(cid, fields):
        kind = fields["claimType"]
        return {
            "claimId": cid, "state": "RELEVANT",
            "semanticAuthority": "LEGAL_NORMATIVE", "claimType": kind,
            "legalSourceVersionId": version, "sourceNodeIds": [node],
            "operative": {
                "actor": fields["actor"], "action": fields["action"],
                "modality": {"PROHIBITION": "MUST_NOT", "PERMISSION": "MAY"}.get(kind, "MUST"),
            },
            "frame": deepcopy(fields["frame"]),
        }

    dev, other = claim("dev", row["develop"]), claim("other", row["other"])
    modifier = {
        "claimId": "modifier", "state": "RELEVANT",
        "semanticAuthority": "LEGAL_NORMATIVE",
        "claimType": row["context"]["claimType"],
        "legalSourceVersionId": version, "sourceNodeIds": [node],
        "operative": None, "frame": deepcopy(row["context"]["frame"]),
    }
    extra = {**deepcopy(modifier), "claimId": "unlinked", "claimType": "CONTEXT"}
    edge = {
        "relationId": "r1", "kind": row["context"]["kind"],
        "fromClaimId": "dev" if row["context"]["kind"] == "DEFINED_BY" else "modifier",
        "toClaimId": "modifier" if row["context"]["kind"] == "DEFINED_BY" else "dev",
    }
    graph = {
        "legalSourceVersionId": version,
        "claims": [dev, other, modifier, extra], "relations": [edge],
    }
    decisions = [
        {**dev["operative"], "claimId": "dev", "legalSourceVersionId": version,
         "sourceNodeIds": [node], "stage": "DEVELOPMENT"},
        {**other["operative"], "claimId": "other", "legalSourceVersionId": version,
         "sourceNodeIds": [node], "stage": row["other"]["stage"]},
    ]
    # Fixed source annotations, separate from candidate graph mutations.
    def gold_norm(cid, fields):
        return {
            "claimId": cid, "actor": fields["actor"], "action": fields["action"],
            "modality": {"PROHIBITION": "MUST_NOT", "PERMISSION": "MAY"}.get(fields["claimType"], "MUST"),
            "claimType": fields["claimType"], "sourceNodeIds": [node],
            "frame": deepcopy(fields["frame"]),
        }
    gold = {
        "schemaVersion": "PREPARATION_SEMANTIC_GOLD_V1",
        "goldApprovalStatus": "SYNTHETIC_FIXTURE",
        "legalSourceVersionId": version,
        "normativeClaims": [gold_norm("dev", row["develop"]), gold_norm("other", row["other"])],
        "contextClaims": [{
            "claimId": "modifier", "claimType": row["context"]["claimType"],
            "semanticAuthority": "LEGAL_NORMATIVE", "legalSourceVersionId": version,
            "sourceNodeIds": [node], "frame": deepcopy(row["context"]["frame"]),
        }],
        "developmentClaimIds": ["dev"],
        "nonDevelopmentClaimIds": ["other"] if row["other"]["stage"] == "NON_DEVELOPMENT" else [],
        "unresolvedClaimIds": ["other"] if row["other"]["stage"] == "LEGAL_REVIEW_REQUIRED" else [],
        "materialContextClaimIds": ["modifier"],
        "materialRelations": [{"kind": edge["kind"], "fromClaimId": edge["fromClaimId"], "toClaimId": edge["toClaimId"]}],
    }
    return gold, graph, decisions


MUTATIONS = {
    "drop_dev": "MISSING_NORMATIVE_CLAIM",
    "drop_other": "MISSING_NORMATIVE_CLAIM",
    "insert_duty": "INVENTED_NORMATIVE_CLAIM",
    "actor": "CLAIM_ACTOR_ACTION_MISMATCH",
    "action": "CLAIM_ACTOR_ACTION_MISMATCH",
    "modality": "CLAIM_ACTOR_ACTION_MISMATCH",
    "claim_type": "CLAIM_ACTOR_ACTION_MISMATCH",
    "source_locator": "CLAIM_ACTOR_ACTION_MISMATCH",
    "dev_frame": "NORMATIVE_MODIFIER_MISMATCH",
    "other_frame": "NORMATIVE_MODIFIER_MISMATCH",
    "drop_context": "MATERIAL_CLAIM_MISSING",
    "context_type": "MATERIAL_CLAIM_MISMATCH",
    "context_authority": "MATERIAL_CLAIM_MISMATCH",
    "context_frame": "MATERIAL_CLAIM_MISMATCH",
    "context_locator": "MATERIAL_CLAIM_MISMATCH",
    "context_state": "MATERIAL_CLAIM_MISSING",
    "drop_relation": "MATERIAL_RELATION_MISSING",
    "reverse_relation": "MATERIAL_RELATION_MISSING",
    "wrong_relation": "MATERIAL_RELATION_MISSING",
    "redirect_relation": "MATERIAL_RELATION_MISSING",
    "add_unlinked_context": "UNRELATED_CONTEXT_LEAK",
    "dev_to_review": "DEVELOPMENT_DUTY_OMITTED",
    "other_stage_drift": "NON_DEVELOPMENT_STAGE_MISSING",
    "other_to_dev": "CLAIM_PROJECTION_INVALID",
    "drop_decision": "CLAIM_PROJECTION_INVALID",
    "duplicate_decision": "CLAIM_PROJECTION_INVALID",
    "decision_actor": "CLAIM_PROJECTION_INVALID",
    "decision_pin": "CLAIM_PROJECTION_INVALID",
}

def mutate(kind, graph, decisions):
    dev, other, modifier, unlinked = graph["claims"]
    edge = graph["relations"][0]
    if kind == "drop_dev":
        graph["claims"].remove(dev)
    elif kind == "drop_other":
        graph["claims"].remove(other)
    elif kind == "insert_duty":
        invented = deepcopy(other)
        invented["claimId"] = "invented"
        invented["operative"]["actor"] = "unrelated actor"
        graph["claims"].append(invented)
    elif kind == "actor":
        dev["operative"]["actor"] = "unrelated actor"
    elif kind == "action":
        dev["operative"]["action"] = "unrelated action"
    elif kind == "modality":
        dev["operative"]["modality"] = "MAY"
    elif kind == "claim_type":
        dev["claimType"] = "PERMISSION"
    elif kind == "source_locator":
        dev["sourceNodeIds"] = ["f" * 64]
    elif kind == "dev_frame":
        dev["frame"] = {"object": "different obligation"}
    elif kind == "other_frame":
        other["frame"] = {"object": "different obligation"}
    elif kind == "drop_context":
        graph["claims"].remove(modifier)
    elif kind == "context_type":
        modifier["claimType"] = "CONTEXT"
    elif kind == "context_authority":
        modifier["semanticAuthority"] = "EVIDENCE_GUIDANCE"
    elif kind == "context_frame":
        modifier["frame"] = {"exception": "all duties erased"}
    elif kind == "context_locator":
        modifier["sourceNodeIds"] = ["f" * 64]
    elif kind == "context_state":
        modifier["state"] = "EXCLUDED"
    elif kind == "drop_relation":
        graph["relations"] = []
    elif kind == "reverse_relation":
        edge["toClaimId"], edge["fromClaimId"] = edge["fromClaimId"], edge["toClaimId"]
    elif kind == "wrong_relation":
        edge["kind"] = "UNVERIFIED"
    elif kind == "redirect_relation":
        if edge["fromClaimId"] == "dev":
            edge["fromClaimId"] = "other"
        else:
            edge["toClaimId"] = "other"
    elif kind == "add_unlinked_context":
        graph["relations"].append({
            "relationId": "extra", "kind": "QUALIFIES",
            "fromClaimId": unlinked["claimId"], "toClaimId": "dev",
        })
    elif kind == "dev_to_review":
        decisions[0]["stage"] = "LEGAL_REVIEW_REQUIRED"
    elif kind == "other_stage_drift":
        decisions[1]["stage"] = (
            "LEGAL_REVIEW_REQUIRED"
            if decisions[1]["stage"] == "NON_DEVELOPMENT"
            else "NON_DEVELOPMENT"
        )
    elif kind == "other_to_dev":
        decisions[1]["stage"] = "DEVELOPMENT"
    elif kind == "drop_decision":
        decisions.pop()
    elif kind == "duplicate_decision":
        decisions.append(deepcopy(decisions[1]))
    elif kind == "decision_actor":
        decisions[0]["actor"] = "unrelated actor"
    elif kind == "decision_pin":
        decisions[0]["legalSourceVersionId"] = "foreign"
    else:
        raise AssertionError("unreviewed mutation " + kind)


@pytest.mark.parametrize("case", CASES, ids=lambda row: row["id"])
def test_clean_synthetic_baseline_and_non_acceptance(case):
    gold, graph, decisions = seed(case)
    result = evaluate_preparation_semantics(gold, graph, decisions)
    assert result["fixtureMatched"], (case["id"], result["errors"])
    assert result["goldApprovalStatus"] == "SYNTHETIC_FIXTURE"
    assert result["liveModelAcceptance"] == "NOT_RUN"
    assert result["productionAcceptance"] == "NOT_PROVEN"


@pytest.mark.parametrize("case", CASES, ids=lambda row: row["id"])
@pytest.mark.parametrize("mutation,expected", MUTATIONS.items())
def test_every_mutation_triggers_its_specific_critical_code(case, mutation, expected):
    gold, graph, decisions = seed(case)
    mutate(mutation, graph, decisions)
    result = evaluate_preparation_semantics(gold, graph, decisions)
    if mutation == "other_stage_drift" and case["other"]["stage"] == "LEGAL_REVIEW_REQUIRED":
        expected = "UNRESOLVED_STAGE_MISSING"
    if mutation == "other_to_dev" and case["other"]["claimType"] != "PERMISSION":
        expected = "DEPLOYMENT_DUTY_LEAK"
    codes = {item["code"] for item in result["errors"]}
    assert expected in codes, (case["id"], mutation, expected, codes)
    assert expected in CRITICAL
    assert result["criticalErrorCounts"][expected] > 0
    assert not result["fixtureMatched"]


def test_mutation_bank_is_diverse_and_explicitly_unreviewed():
    raw = json.loads(BANK.read_text(encoding="utf-8"))
    assert raw["schemaVersion"] == "LCSP_SYNTHETIC_MUTATION_BANK_V1"
    assert raw["approvalStatus"] == "SYNTHETIC_NOT_REVIEWED"
    assert len(CASES) >= 10 and len(MUTATIONS) >= 25
    assert len({row["id"] for row in CASES}) == len(CASES)
    assert {row["context"]["kind"] for row in CASES} >= {
        "CONDITION_OF", "QUALIFIES", "EXCEPTION_TO",
        "TEMPORALLY_APPLIES_TO", "DEFINED_BY",
    }
    assert {row["other"]["stage"] for row in CASES} == {
        "NON_DEVELOPMENT", "LEGAL_REVIEW_REQUIRED",
    }
    assert all(row["sourceVi"] and row["sourceEn"] for row in CASES)

@pytest.mark.parametrize("case", CASES, ids=lambda row: row["id"])
def test_locale_parity_rejects_typed_modifier_drift(case):
    from rule_set_preparation.eval_semantics import compare_preparation_locale_parity
    _, en_graph, en_decisions = seed(case)
    vi_graph, vi_decisions = deepcopy(en_graph), deepcopy(en_decisions)
    assert compare_preparation_locale_parity(en_graph, en_decisions, vi_graph, vi_decisions)["parity"] == "MATCH"
    vi_graph["claims"][2]["frame"] = {"changed": "semantic predicate"}
    assert compare_preparation_locale_parity(en_graph, en_decisions, vi_graph, vi_decisions)["parity"] == "MISMATCH"
    vi_graph, vi_decisions = deepcopy(en_graph), deepcopy(en_decisions)
    vi_graph["claims"][0]["frame"] = {"changed": "operative limit"}
    result = compare_preparation_locale_parity(en_graph, en_decisions, vi_graph, vi_decisions)
    assert result["parity"] == "MISMATCH"
    assert result["semanticTruth"] == "NOT_ESTABLISHED_BY_PARITY"
