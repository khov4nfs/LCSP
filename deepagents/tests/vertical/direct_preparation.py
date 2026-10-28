"""Scripted legal facts over the genuine worker HTTP API, without provider calls."""
from __future__ import annotations

import json
import os
from copy import deepcopy
from pathlib import Path
import sys

from rule_set_preparation.claim_inventory import ClaimInventory
from rule_set_preparation.direct_draft import DirectDraft
from rule_set_preparation.source_graph import PinnedSourceGraph
from rule_set_preparation.tools import RuleSetPreparationContext, build_rule_set_tools
from tools.common.capabilities.platform.api_client import WorkerApiClient


def main():
    base, key, run_id, manifest_file = sys.argv[1:5]
    api = WorkerApiClient(base, key)
    bundle = api.claim_rule_set_preparation(run_id)
    assert bundle["executionContract"] == "DIRECT_DRAFT_V1"
    source = PinnedSourceGraph(bundle["documentGraph"], [{**c, "documentId": d["documentId"]} for d in bundle["documents"] for c in d["chunks"]])
    context = RuleSetPreparationContext(run_id, api, source_graph=source, direct_draft=True, target_date=bundle["targetDate"])
    context.inventory = ClaimInventory(context, revision=bundle["claimInventoryRevision"], phase=bundle["claimPhase"])
    refused = context.inventory.frontier.restore()
    assert not refused, refused
    context.inventory.restore_frozen_inventory(bundle["frozenInventory"])
    context.inventory.restore_authoring_draft()
    tools = {t.name: t for t in build_rule_set_tools(context)}
    manifest = json.loads(Path(manifest_file).read_text())
    values = deepcopy(manifest["candidates"])
    for candidate in values:
        for facts in [candidate["obligations"], candidate["applicability"]["conditions"], candidate["qualifiers"], candidate["exceptions"], candidate["definitions"]]:
            for fact in facts:
                for evidence in fact["support"]:
                    evidence["nodeId"] = source.resolve_locator(evidence.pop("documentId"), evidence.pop("locator"))
                    assert evidence["nodeId"], evidence
    package = json.loads(tools["get_next_legal_analysis_package"].invoke({}))
    while not package.get("complete"):
        assert package.get("outcome") == "PASSED", package
        ids = {n["nodeId"] for n in package["sourceUnits"]}
        candidates = [c for c in values if any(s["nodeId"] in ids for f in c["obligations"] for s in f["support"])
                      and c["candidateId"] not in context.draft["legalRequirements"]]
        sources = [{"sourceNodeId": n["nodeId"], "disposition": "ANALYZED" if any(s["nodeId"] == n["nodeId"] for c in candidates for f in c["obligations"] for s in f["support"]) else "NO_REQUIREMENT",
                    "reason": manifest["noRequirementReasons"].get(n["locator"])} for n in package["sourceUnits"]]
        payload = {"packageId": package["packageId"], "candidates": candidates, "removeCandidateIds": [], "legalEffects": [], "references": [], "sourceUnits": sources}
        result = json.loads(tools["submit_rule_set_draft_candidates"].invoke(payload))
        assert result.get("outcome") == "PASSED", result
        print(json.dumps({"event": "DRAFT_PERSISTED", "draftVersion": result["draftVersion"], "requirements": result["requirements"], "assessmentRules": result["assessmentRules"]}), flush=True)
        if os.environ.get("LCSP_DIRECT_CRASH_AFTER_SAVE") == "1" and result["requirements"] > 0:
            os._exit(86)
        package = result["nextPackage"]
    validation = json.loads(tools["validate_compliance_rule_set"].invoke({}))
    assert validation.get("outcome") == "PASSED", validation
    submission = json.loads(tools["submit_compliance_rule_set"].invoke({}))
    assert context.submission, submission
    print(json.dumps({"validation": validation, "submission": submission, "requirements": len(context.draft["legalRequirements"]), "assessmentRules": len(context.draft["assessmentRules"])}))


if __name__ == "__main__":
    main()
