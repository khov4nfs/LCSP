"""Provider-free protocol self-check; in-memory persistence, real API validators, no database access."""
import json
import subprocess
from copy import deepcopy
from pathlib import Path

from middleware.failure_policy import NoProgressDetected
from rule_set_preparation.source_graph import PinnedSourceGraph
from rule_set_preparation.tools import RuleSetPreparationContext, build_rule_set_tools
from structural_semantic_fixture import StructuralFixtureAuditor, semantic_arguments, MechanicalTools, mechanical_arguments

ROOT = Path(__file__).resolve().parents[2]
RUN = "00000000-0000-4000-8000-000000000009"


def bridge(payload):
    result = subprocess.run(["pnpm", "exec", "tsx", "apps/api/test/support/claim-convergence-bridge.ts"], cwd=ROOT,
                            input=json.dumps(payload), capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


class ScriptedApi:
    """Only persistence is in-memory; inventories and candidates use the real API domain validators."""
    def __init__(self, seed):
        self.source = seed["source"]
        self.frozen = None
        self.revision = 1
        self.submitted = None

    def claim_inventory_operation(self, run_id, action, revision, **fields):
        if revision != self.revision:
            return {"outcome": "FAILED", "failures": [{"code": "STALE_INVENTORY_BINDING", "ref": "claimInventory"}]}
        if action == "REOPEN":
            self.revision += 1; self.frozen = None
            return {"outcome": "PASSED", "revision": self.revision}
        if action == "AUTHOR_RULES":
            assert self.frozen
            return {"outcome": "PASSED"}
        result = bridge({"action": "INVENTORY", "runId": run_id, "revision": revision, "source": self.source, **fields})
        if action == "FINALIZE" and result["outcome"] == "PASSED":
            self.frozen = {"revision": revision, "fingerprint": result["fingerprint"], "graph": deepcopy(fields["graph"])}
        return result

    def validate_compliance_rule_set(self, run_id, packet):
        return bridge({"action": "RULES", "source": self.source, "packet": packet, "revision": self.revision, "frozen": self.frozen})

    def submit_compliance_rule_set(self, run_id, idempotency_key, packet):
        result = self.validate_compliance_rule_set(run_id, packet)
        assert result["outcome"] == "PASSED"
        self.submitted = deepcopy(result["packet"])
        return {"validation": result, "ruleSetVersionId": "scripted-persistence", "preparationState": "SUCCEEDED"}


def runtime(seed):
    seed = deepcopy(seed)
    graph = seed["source"]["documentGraph"]
    nodes = {n["nodeId"]: n for n in graph["nodes"]}
    owners = {m["chunkId"]: m["legalDocumentNodeId"] for m in graph["chunkMappings"]}
    chunks = [{**c, "chunkId": c["id"], "content": nodes[owners[c["id"]]]["content"]} for c in seed["source"]["chunks"]]
    api = ScriptedApi(seed)
    context = RuleSetPreparationContext(RUN, api, frontier_enabled=False, source_graph=PinnedSourceGraph(graph, chunks), semantic_auditor=StructuralFixtureAuditor())
    tools = MechanicalTools(context, build_rule_set_tools(context))
    return seed, context, tools, api


def call(tools, name, **args):
    if name in {"register_semantic_claim", "update_semantic_claim"} and isinstance(tools, MechanicalTools):
        args = mechanical_arguments(tools.context, args)
    return json.loads(tools[name].invoke(args))


def discover(seed, context, tools):
    remap = {}
    for c in seed["packet"]["semanticGraph"]["claims"]:
        result = call(tools, "register_semantic_claim", identity_key=c["claimId"], source_node_ids=c["sourceNodeIds"],
                      claim_type=c["claimType"], statement=c["statement"], **semantic_arguments(c), **({"actor": c["operative"]["actor"], "action": c["operative"]["action"]} if c["operative"] else {}))
        assert result["outcome"] == "PASSED", result
        remap[c["claimId"]] = result["claim"]["claimId"]
    for r in seed["packet"]["semanticGraph"]["relations"]:
        assert call(tools, "link_semantic_claims", from_claim_id=remap[r["fromClaimId"]], to_claim_id=remap[r["toClaimId"]], kind=r["kind"])["outcome"] == "PASSED"
    for r in seed["packet"]["semanticGraph"]["sourceAccounting"]:
        assert call(tools, "review_source_node", source_node_id=r["sourceNodeId"], claim_ids=[remap[cid] for cid in r["claimIds"]],
                    **({"no_relevant_claim_reason": r["nonSemanticReason"]} if r["nonSemanticReason"] else {}))["outcome"] == "PASSED"
    for r in seed["packet"]["semanticGraph"]["referenceAccounting"]:
        assert not r["material"], "Bridge fixture has no material reference edges"
        call(tools, "review_source_reference", reference_id=r["referenceId"], material=False, relation_ids=[], non_material_reason=r["nonMaterialReason"])
    return remap


def author(seed, context, tools, remap, omit_claim=None):
    for requirement in seed["packet"]["legalRequirements"]:
        roles = {r: [] for r in ["OPERATIVE_PROPOSITION", "APPLICABILITY_CONDITION", "QUALIFIER", "EXCEPTION", "CONTEXT"]}
        for b in requirement["claimBindings"]:
            if b["claimId"] == omit_claim:
                continue
            roles["CONTEXT" if b["role"] == "DEFINITION" else b["role"]].append(remap[b["claimId"]])
        result = call(tools, "author_legal_requirement", requirement_key=requirement["legalRequirementId"], title=requirement["title"],
                      operative_claim_ids=roles["OPERATIVE_PROPOSITION"], applicability_claim_ids=roles["APPLICABILITY_CONDITION"], qualifier_claim_ids=roles["QUALIFIER"],
                      exception_claim_ids=roles["EXCEPTION"], context_claim_ids=roles["CONTEXT"], non_repository_duty=requirement["nonRepositoryDuty"],
                      **({"non_assessable_reason": requirement["coverage"]["nonAssessableReason"]} if requirement["coverage"]["nonAssessableReason"] else {}))
        assert result["outcome"] == "PASSED", result
    for rule in seed["packet"]["assessmentRules"]:
        result = call(tools, "author_assessment_rule", assessment_rule_id=rule["assessmentRuleId"], concept=rule["concept"], legal_requirement_ids=rule["legalRequirementIds"], investigation_focus="One narrower evidence surface within the inherited predicate")
        assert result["outcome"] == "PASSED", result


def main():
    seed, ctx, tools, api = runtime(bridge({"action": "INIT"}))
    c = seed["packet"]["semanticGraph"]["claims"][0]
    call(tools, "register_semantic_claim", identity_key="duty", source_node_ids=c["sourceNodeIds"], claim_type="DUTY", statement=c["statement"], actor=c["operative"]["actor"], action=c["operative"]["action"])
    assert call(tools, "validate_semantic_claim_inventory")["outcome"] == "FAILED"
    assert call(tools, "validate_semantic_claim_inventory")["NO_PROGRESS"]
    try:
        call(tools, "validate_semantic_claim_inventory")
    except NoProgressDetected:
        pass
    else:
        raise AssertionError("No-progress did not terminate repeating discovery")
    seed, ctx, tools, api = runtime(seed)
    remap = discover(seed, ctx, tools)
    ready = call(tools, "finalize_semantic_claim_inventory")
    assert ready["outcome"] == "PASSED", ready
    assert ctx.inventory.phase == "CLAIM_INVENTORY_READY"
    frozen = deepcopy(ctx.inventory.frozen)
    author(seed, ctx, tools, remap)
    assert ctx.inventory.phase == "RULE_AUTHORING"
    assert call(tools, "validate_compliance_rule_set")["outcome"] == "PASSED"
    assert ctx.inventory.phase == "SUBMISSION_READY"
    assert call(tools, "submit_compliance_rule_set")["preparationState"] == "SUCCEEDED"
    assert ctx.inventory.phase == "COMPLETION" and ctx.inventory.frozen == frozen
    assert all(r["sourceRefs"] for r in api.submitted["legalRequirements"])
    print(json.dumps({"protocol": "PASS", "noProgress": "PASS", "inventoryRevision": ctx.inventory.revision,
                      "inventoryFingerprint": ready["fingerprint"], "claims": len(frozen["claims"]),
                      "providerCalls": 0, "databaseConnections": 0, "preparationsCreated": 0,
                      "persistence": "SCRIPTED_IN_MEMORY"}))

if __name__ == "__main__":
    main()
