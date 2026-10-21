"""Independent checks of one live preparation's persisted artifacts (read-only).

usage: verify_live_artifacts.py <runId> [dbUrl]
Recomputes every claim's source-support hash from the pinned materialization's node text, verifies every
semantic audit receipt's HMAC attestation with the run's key, and checks pin, lineage and activation.
"""
import json, os, sys
from collections import Counter
from pathlib import Path
ROOT = Path("/home/khovan/Workplaces/LCSP")
sys.path.insert(0, str(ROOT / "deepagents"))
os.environ.setdefault("LCSP_SEMANTIC_AUDIT_ATTESTATION_KEY", "7c" * 32)
import psycopg
from rule_set_preparation.semantic_audit import verify_attestation, utf16_slice, text_sha

run_id = sys.argv[1]
url = sys.argv[2] if len(sys.argv) > 2 else "postgresql://postgres:postgres@127.0.0.1:55441/lcsp_compliance_rule_set_live"
checks = {}
def check(name, ok, detail=None):
    checks[name] = {"ok": bool(ok), **({} if detail is None else {"detail": detail})}

with psycopg.connect(url) as db:
    q = lambda sql, *a: db.execute(sql, a).fetchall()
    run = q('SELECT "executionState","claimPhase","failureReason","legalSourceVersionId","claimInventoryRevision" FROM "RuleSetPreparationRun" WHERE id=%s', run_id)[0]
    check("run_succeeded", run[0] == "SUCCEEDED" and run[2] is None, {"state": run[0], "phase": run[1], "failure": run[2]})
    frontiers = q('SELECT "inventoryRevision","materializationId","frozenAt" IS NOT NULL FROM "RuleSetPreparationReviewFrontier" WHERE "preparationRunId"=%s ORDER BY 1', run_id)
    pin = frontiers[0][1]
    check("single_pinned_materialization", len({f[1] for f in frontiers}) == 1, {"frontiers": len(frontiers)})
    revision = run[4]
    inv = q('SELECT graph, fingerprint FROM "RuleSetPreparationClaimInventory" WHERE "preparationRunId"=%s AND revision=%s', run_id, revision)
    graph = inv[0][0] if inv else None
    check("inventory_frozen_on_pin", graph is not None and graph.get("materializationId") == pin, {"revision": revision})
    nodes = {r[0]: r[1] for r in q('SELECT "nodeId", content FROM "LegalDocumentNode" WHERE "materializationId"=%s', pin)}
    bad_support, spans = [], 0
    for claim in (graph or {}).get("claims", []):
        for s in claim.get("sourceSupport") or []:
            spans += 1
            text = utf16_slice(nodes.get(s["nodeId"], ""), s["startOffset"], s["endOffset"])
            if not text.strip() or text_sha(text) != s["contentSha256"]:
                bad_support.append((claim["claimId"][:12], s["nodeId"][:12]))
        if not claim.get("sourceSupport"):
            bad_support.append((claim["claimId"][:12], "NO_SUPPORT"))
    check("source_support_hashes_recomputed", not bad_support and spans > 0, {"claims": len((graph or {}).get("claims", [])), "spans": spans, "bad": bad_support[:5]})
    receipts = q('SELECT "sourceNodeId", receipt FROM "RuleSetPreparationSemanticAudit" WHERE "preparationRunId"=%s AND "inventoryRevision"=%s', run_id, revision)
    unverified = [r[0][:12] for r in receipts if not verify_attestation(r[1], run_id) or r[1].get("verdict") != "SUPPORTED"]
    forged = dict(receipts[0][1], verdict="SUPPORTED", gaps=[{"code": "X", "detail": "tamper"}]) if receipts else None
    check("audit_receipts_hmac_and_supported", receipts and not unverified, {"receipts": len(receipts), "unverified": unverified})
    check("tampered_receipt_rejected", forged is not None and not verify_attestation(forged, run_id))
    check("receipt_bound_to_run", receipts and not verify_attestation(receipts[0][1], "00000000-0000-4000-8000-000000000000"))
    embedded = (graph or {}).get("semanticAudits", [])
    check("frozen_inventory_receipts_verify", embedded and all(verify_attestation(r, run_id) for r in embedded), {"embedded": len(embedded)})
    version = q('SELECT id, version, "lifecycleState", "validationOutcome", "ruleSetDigest", "activatedAt" IS NOT NULL FROM "ComplianceRuleSetVersion" WHERE "preparationRunId"=%s', run_id)
    check("rule_set_version_active", version and version[0][2] == "ACTIVE" and version[0][3] == "PASSED" and version[0][4] and version[0][5],
          version and {"id": version[0][0], "version": version[0][1], "state": version[0][2], "digest": version[0][4]})
    if version:
        vid = version[0][0]
        claim_ids = {c["claimId"] for c in (graph or {}).get("claims", [])}
        reqs = q('SELECT id, "legalRequirementId" FROM "LegalRequirement" WHERE "ruleSetVersionId"=%s', vid)
        bindings = q('SELECT "legalRequirementRowId", "claimId", role FROM "LegalRequirementClaimBinding" WHERE "ruleSetVersionId"=%s', vid)
        check("requirements_bind_frozen_claims", reqs and bindings and all(b[1] in claim_ids for b in bindings) and {r[0] for r in reqs} <= {b[0] for b in bindings},
              {"requirements": len(reqs), "bindings": len(bindings), "roles": dict(Counter(b[2] for b in bindings))})
        rules = q('SELECT id, "assessmentRuleId" FROM "AssessmentRule" WHERE "ruleSetVersionId"=%s', vid)
        links = q('SELECT "assessmentRuleRowId", "legalRequirementRowId" FROM "AssessmentRuleLegalRequirement" WHERE "ruleSetVersionId"=%s', vid)
        check("every_rule_traces_to_a_requirement", rules and {r[0] for r in rules} <= {l[0] for l in links}, {"rules": len(rules), "links": len(links)})
        prov = q('SELECT p."contentSha256", c."contentSha256", p."legalSourceVersionId" FROM "LegalRequirementProvenance" p JOIN "LegalDocumentChunk" c ON c.id=p."chunkId" WHERE p."ruleSetVersionId"=%s', vid)
        check("requirement_provenance_matches_pinned_chunks", prov and all(p[0] == p[1] and p[2] == run[3] for p in prov), {"provenanceRows": len(prov)})
        acts = q('SELECT "validationOutcome" FROM "ComplianceRuleSetActivationRecord" WHERE "ruleSetVersionId"=%s', vid)
        check("single_activation_record", len(acts) == 1 and acts[0][0] == "PASSED", {"activations": len(acts)})
        actives = q('SELECT count(*) FROM "ComplianceRuleSetVersion" WHERE "lifecycleState"=%s', "ACTIVE")[0][0]
        check("exactly_one_active_rule_set", actives == 1, {"active": actives})
print(json.dumps({"runId": run_id, "pinnedMaterializationId": pin, "allPassed": all(c["ok"] for c in checks.values()), "checks": checks}, indent=1, default=str))
