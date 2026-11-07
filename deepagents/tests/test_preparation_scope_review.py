"""Offline contract controls; not legal semantic model evaluation."""
import copy
import pytest

from rule_set_preparation.scope_review import review_claim_level_development_scope


def fixture():
    version = "source-v1"
    node = "a" * 64
    def claim(cid, kind, actor=None, action=None):
        return {
            "claimId": cid,
            "state": "RELEVANT",
            "semanticAuthority": "LEGAL_NORMATIVE",
            "claimType": kind,
            "legalSourceVersionId": version,
            "sourceNodeIds": [node],
            "operative": (
                {"actor": actor, "modality": "MUST", "action": action}
                if actor else None
            ),
        }
    graph = {
        "legalSourceVersionId": version,
        "claims": [
            claim("dev", "DUTY", "Developer", "build logging guard"),
            claim("deploy", "DUTY", "Operator", "notify authority"),
            claim("condition", "CONDITION"),
            claim("unlinked", "QUALIFIER"),
        ],
        "relations": [{
            "relationId": "r-condition",
            "kind": "CONDITION_OF",
            "fromClaimId": "condition",
            "toClaimId": "dev",
        }],
    }
    def decision(cid, stage, actor, action):
        return {
            "claimId": cid,
            "legalSourceVersionId": version,
            "sourceNodeIds": [node],
            "actor": actor,
            "modality": "MUST",
            "action": action,
            "stage": stage,
        }
    decisions = [
        decision("dev", "DEVELOPMENT", "Developer", "build logging guard"),
        decision("deploy", "NON_DEVELOPMENT", "Operator", "notify authority"),
    ]
    return graph, decisions


def test_same_article_distinct_actor_claims_are_separate_and_deploy_hidden():
    graph, decisions = fixture()
    result = review_claim_level_development_scope(graph, decisions)
    assert result["sourceOperativeClaimsAccounted"] == 2
    assert result["developmentClaimIds"] == ["dev"]
    assert result["nonDevelopmentClaimIds"] == ["deploy"]
    assert result["materialContextClaimIds"] == ["condition"]
    assert result["materialRelationIds"] == ["r-condition"]
    assert "unlinked" not in str(result)
    assert result["activationEligible"] is False


def test_unaccounted_or_wrong_actor_or_duplicate_decision_fails_closed():
    graph, decisions = fixture()
    with pytest.raises(ValueError, match="MISSING_OPERATIVE"):
        review_claim_level_development_scope(graph, decisions[:1])
    altered = copy.deepcopy(decisions)
    altered[0]["actor"] = "Operator"
    with pytest.raises(ValueError, match="PROVENANCE_OR_ACTOR_MISMATCH"):
        review_claim_level_development_scope(graph, altered)
    with pytest.raises(ValueError, match="UNKNOWN_OR_DUPLICATE"):
        review_claim_level_development_scope(graph, decisions + decisions[:1])


def test_same_claim_actor_modality_action_duplicated_rejected():
    graph, decisions = fixture()
    same = copy.deepcopy(graph["claims"][0])
    same["claimId"] = "dup-dev"
    graph["claims"].append(same)
    with pytest.raises(ValueError, match="DUPLICATE_OPERATIVE"):
        review_claim_level_development_scope(graph, decisions)


def test_permission_cannot_be_published_as_development_duty():
    graph, decisions = fixture()
    graph["claims"][0]["claimType"] = "PERMISSION"
    with pytest.raises(ValueError, match="PERMISSION_AS_MANDATORY"):
        review_claim_level_development_scope(graph, decisions)


def test_context_from_deploy_only_actor_never_becomes_developer_requirement():
    graph, decisions = fixture()
    graph["relations"].append({
        "relationId": "r-deploy",
        "kind": "CONTEXT_FOR",
        "fromClaimId": "deploy",
        "toClaimId": "dev",
    })
    result = review_claim_level_development_scope(graph, decisions)
    assert "deploy" not in result["materialContextClaimIds"]
    assert "r-deploy" not in result["materialRelationIds"]


def test_unresolved_decision_is_accounted_but_not_published():
    graph, decisions = fixture()
    decisions[0]["stage"] = "LEGAL_REVIEW_REQUIRED"
    result = review_claim_level_development_scope(graph, decisions)
    assert result["developmentClaimIds"] == []
    assert result["unresolvedClaimIds"] == ["dev"]
    assert result["materialContextClaimIds"] == []


@pytest.mark.parametrize("field,value", [
    ("legalSourceVersionId", "foreign-source"),
    ("sourceNodeIds", []),
    ("sourceNodeIds", [""]),
])
def test_material_context_must_be_pinned_to_same_source(field, value):
    graph, decisions = fixture()
    graph["claims"][2][field] = value
    with pytest.raises(ValueError, match="UNPINNED_MATERIAL_CONTEXT"):
        review_claim_level_development_scope(graph, decisions)


def test_unlinked_foreign_context_is_not_included_or_approved():
    graph, decisions = fixture()
    graph["claims"][3]["legalSourceVersionId"] = "foreign-source"
    result = review_claim_level_development_scope(graph, decisions)
    assert result["materialContextClaimIds"] == ["condition"]
    assert result["activationEligible"] is False
