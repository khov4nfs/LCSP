"""Semantic counterfactuals over the exact retained source. Test annotations, never production law parsing."""
from copy import deepcopy

from corrected_semantic_fixture import corrected_graph
from rule_set_preparation.claim_inventory import fingerprint
from rule_set_preparation.semantic_audit import canonical_support, FRAME_FIELDS


def semantic_mutations():
    fixture, source, original, _, keys = corrected_graph()

    def variant(label, key, mutate, expected):
        graph = deepcopy(original)
        by_key = {k: next(c for c in graph["claims"] if c["claimId"] == v["claimId"]) for k, v in keys.items()}
        mutate(graph, by_key)
        for relation in graph["relations"]:
            relation["relationId"] = fingerprint({k: v for k, v in relation.items() if k != "relationId"})
        graph["relations"] = sorted({r["relationId"]: r for r in graph["relations"]}.values(), key=lambda r: r["relationId"])
        for review in graph["sourceAccounting"]:
            review["claimIds"] = sorted(c["claimId"] for c in graph["claims"] if review["sourceNodeId"] in c["sourceNodeIds"])
            review["nonSemanticReason"] = None if review["claimIds"] else "No relevant semantic material"
        return label, source, graph, keys[key]["sourceNodeIds"][0], expected

    def remove(graph, by_key, names):
        ids = {by_key[k]["claimId"] for k in names}
        graph["claims"] = [c for c in graph["claims"] if c["claimId"] not in ids]
        graph["relations"] = [r for r in graph["relations"] if r["fromClaimId"] not in ids and r["toClaimId"] not in ids]

    def retarget(graph, by_key, origin, kind, target):
        for r in graph["relations"]:
            if r["fromClaimId"] == by_key[origin]["claimId"] and r["kind"] == kind:
                r["toClaimId"] = by_key[target]["claimId"]

    def invented(graph, by_key):
        claim = deepcopy(next(c for c in fixture["frozenInventory"]["graph"]["claims"] if c["claimId"].startswith("923f9380")))
        claim.update(sourceSupport=deepcopy(by_key["portability.prohibition"]["sourceSupport"]), semanticAuthority="LEGAL_NORMATIVE", assessability="REPOSITORY_VERIFIABLE", semanticFrame={k: None for k in FRAME_FIELDS})
        graph["claims"].append(claim)

    yield variant("N1-exact-invented-provider-duty", "portability.prohibition", invented, {"INSUFFICIENT_SUPPORT", "WRONG_ACTION", "CONTRADICTED"})
    yield variant("N2-omitted-definitions", "def.repository", lambda g, k: remove(g, k, ["def.repository", "def.audit", "context.definitions-only"]), {"MISSING_ASSERTION"})
    yield variant("N3-cessation-without-operative-end-duty", "access.end", lambda g, k: remove(g, k, ["access.end"]), {"MISSING_ASSERTION"})
    yield variant("N4-no-delay-preservation-omitted", "exception.transfer", lambda g, k: (remove(g, k, ["preserves.no-delay"]), g.update(relations=[r for r in g["relations"] if not (r["kind"] == "PRESERVES" and r["fromClaimId"] == k["exception.transfer"]["claimId"])])), {"MISSING_ASSERTION", "WRONG_RELATION"})
    yield variant("N5-temporal-unrelated-target", "temporal.new", lambda g, k: retarget(g, k, "temporal.new", "TEMPORALLY_APPLIES_TO", "configuration.service"), {"WRONG_RELATION", "WRONG_SCOPE"})
    yield variant("N6-exception-wrong-target", "exception.transfer", lambda g, k: retarget(g, k, "exception.transfer", "EXCEPTION_TO", "delegation.configuration"), {"WRONG_RELATION"})
    yield variant("N7-guidance-promoted-to-norm", "guidance.encryption", lambda g, k: k["guidance.encryption"].update(semanticAuthority="LEGAL_NORMATIVE", assessability="REPOSITORY_VERIFIABLE"), {"WRONG_SEMANTIC_AUTHORITY"})
    yield variant("N8-external-payment-repository-proven", "compensation.payment", lambda g, k: k["compensation.payment"].update(assessability="REPOSITORY_VERIFIABLE", semanticFrame={**k["compensation.payment"]["semanticFrame"], "externalFulfillmentAspect": None}), {"INSUFFICIENT_SUPPORT", "WRONG_SCOPE", "CONTRADICTED"})
    yield variant("M-modality", "export.software", lambda g, k: k["export.software"].update(claimType="PERMISSION", operative={**k["export.software"]["operative"], "modality": "PERMISSION"}), {"WRONG_MODALITY"})
    yield variant("M-actor", "delegation.path", lambda g, k: k["delegation.path"]["operative"].update(actor="Actor A"), {"WRONG_ACTOR"})
    yield variant("M-action", "export.software", lambda g, k: k["export.software"]["operative"].update(action="delete customer records after every export request"), {"WRONG_ACTION", "CONTRADICTED"})
    yield variant("M-correct-claim-wrong-span", "export.software", lambda g, k: k["export.software"].update(sourceSupport=deepcopy(k["context.delivery-distinct"]["sourceSupport"])), {"INSUFFICIENT_SUPPORT"})
    yield variant("M-relation-target", "condition.direction", lambda g, k: retarget(g, k, "condition.direction", "CONDITION_OF", "safeguards"), {"WRONG_RELATION"})
    yield variant("M-remove-one-definition", "def.repository", lambda g, k: remove(g, k, ["def.repository"]), {"MISSING_ASSERTION"})
