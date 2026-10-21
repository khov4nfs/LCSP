"""Drive the real claim-first Preparation journey with a provider-free model and fixture auditor.

Used by tests/compliance-rule-set-vertical.mjs. The model is scripted; everything else is real:
the Deep Agent graph, tool surface, WorkerApiClient HTTP calls, API, validator and PostgreSQL.
Auditor verdicts are scripted mechanical fixtures, never legal-semantic acceptance evidence.

usage: scripted_preparation.py <apiBase> <workerKey> <runId> <seedJson> <mode>
modes: valid | stale | orphan | no-submit
"""

from __future__ import annotations

import json
import sys
from contextlib import ExitStack
from typing import Any
from unittest.mock import patch

from langchain_core.messages import AIMessage

from rule_set_preparation import runner as runner_module
from rule_set_preparation.runner import run_rule_set_preparation
from authoring_memory_harness import ViewDrivenModel, last_result
from structural_semantic_fixture import StructuralFixtureAuditor
from rule_set_preparation.semantic_audit import FRAME_FIELDS
from tools.common.capabilities.platform.api_client import WorkerApiClient

DOC = "SYNTHETIC-NOTICE-INSTRUMENT"


def _ref(hashes: dict[str, str], locator: str, *, hash_override: str | None = None) -> dict[str, str]:
    return {"documentId": DOC, "locator": locator, "contentSha256": hash_override or hashes[locator]}


def _legal(rule_id: str, locators: list[str], hashes: dict[str, str], *, duty: bool = False) -> dict[str, Any]:
    return {
        "legalRequirementId": rule_id,
        "title": f"Rule {rule_id}",
        "proposition": f"Proposition {rule_id}.",
        "applicabilityConditions": [] if duty else ["Applies to the service that stores notices."],
        "qualifiers": [],
        "exceptions": [],
        "nonRepositoryDuty": duty,
        "sourceRefs": [_ref(hashes, loc) for loc in locators],
        "coverage": (
            {"state": "NON_ASSESSABLE", "nonAssessableReason": "Not establishable from a repository."}
            if duty
            else {"state": "COVERED_BY_ASSESSMENT_RULES", "nonAssessableReason": None}
        ),
    }


def _assessment_rule(rule_id: str, legal_ids: list[str], locators: list[str], hashes: dict[str, str]) -> dict[str, Any]:
    return {
        "assessmentRuleId": rule_id,
        "legalRequirementIds": legal_ids,
        "concept": f"Concept {rule_id}",
        "legalIntent": "Ensure the legal intent is met.",
        "applicabilityGuidance": "Applies when the described condition holds.",
        "criteria": [{"criterionId": "C-1", "statement": "The control exists."}],
        "investigationGoals": ["find the control"],
        "startingNodeTypes": [], "targetNodeTypes": [], "edgeStrategies": [],
        "graphQueries": [], "keywords": [], "commonApis": [], "commonLibraries": [],
        "patterns": [], "requiredEvidence": ["control implementation"],
        "supportingEvidence": [], "negativeEvidence": [], "unresolvedConditions": [],
        "sourceRefs": [_ref(hashes, loc) for loc in locators],
    }


def build_packet(hashes: dict[str, str]) -> dict[str, Any]:
    return {
        "legalRequirements": [
            _legal("LR-DEF", ["art-1::cl-1"], hashes),
            _legal("LR-RET", ["art-5::cl-1::pt-a", "art-5::cl-1::pt-b"], hashes),
            _legal("LR-EXC", ["art-3::cl-1"], hashes),
            _legal("LR-XREF", ["art-4::cl-1::pt-a", "art-2::cl-1"], hashes),
            _legal("LR-PERSON", ["art-6::cl-1"], hashes, duty=True),
        ],
        "assessmentRules": [
            _assessment_rule("ER-DEF", ["LR-DEF"], ["art-1::cl-1"], hashes),
            _assessment_rule("ER-RET", ["LR-RET", "LR-EXC"], ["art-5::cl-1::pt-a", "art-3::cl-1"], hashes),
            _assessment_rule("ER-XREF", ["LR-XREF"], ["art-4::cl-1::pt-a"], hashes),
        ],
        "contextRelations": [
            {"relationId": "REL-EXC", "kind": "CROSS_REFERENCE", "fromLegalRequirementId": "LR-RET",
             "toLegalRequirementId": "LR-EXC", "toSourceRef": None},
            {"relationId": "REL-DEF", "kind": "CROSS_REFERENCE", "fromLegalRequirementId": "LR-XREF",
             "toLegalRequirementId": "LR-DEF", "toSourceRef": None},
        ],
    }


def _call(name: str, args: dict[str, Any], call_id: str) -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": call_id}])


def main() -> int:
    base, key, run_id, seed_path, mode = sys.argv[1:6]
    seed = json.loads(open(seed_path, encoding="utf-8").read())
    hashes: dict[str, str] = seed["hashes"]
    api = WorkerApiClient(base, key)

    packet = seed.get("packet") or build_packet(hashes)
    calls = []
    context = None

    def journey():
        yield "read_file", {"file_path": "/legal-source/INDEX.md"}
        if mode == "no-submit":
            yield "report_rule_set_source_blocked", {
                "reason": "SOURCE_PINS_INCONSISTENT", "path": "/legal-source/INDEX.md"}
            return
        operands = {r["legalRequirementId"]: [] for r in packet["legalRequirements"]}
        scopes = {key: [] for key in operands}
        while True:
            work = yield "get_next_review_unit", {}
            assert work["outcome"] == "PASSED", work
            unit = work["unit"]
            if unit is None:
                assert work["progress"]["discoveryCompleteEligible"], work
                break
            node_id = unit["sourceNodeId"]
            source = context.source_graph
            locators = {source.chunks[c]["locator"] for c in source.chunk_ids[node_id]}
            authored = False
            for row in packet["legalRequirements"]:
                refs = [r for r in row["sourceRefs"] if r["locator"] in locators]
                if not refs or operands[row["legalRequirementId"]]:
                    continue
                key = row["legalRequirementId"]
                wanted = {r["locator"] for r in row["sourceRefs"]}
                anchors = [nid for nid, chunks in source.chunk_ids.items()
                           if any(source.chunks[c]["locator"] in wanted for c in chunks)]
                support = [{"nodeId": nid, "startOffset": 0,
                            "endOffset": len(source.nodes[nid]["content"].encode("utf-16-le")) // 2}
                           for nid in anchors]
                if mode == "stale":
                    support[0]["contentSha256"] = "f" * 64
                common = {"source_node_ids": anchors, "source_support": support,
                          "semantic_authority": "LEGAL_NORMATIVE",
                          "semantic_frame": {k: None for k in FRAME_FIELDS}}
                scope = yield "register_semantic_claim", {
                    **common, "identity_key": f"{key}-{node_id}-scope",
                    "claim_type": "SCOPE", "statement": " ".join(row["applicabilityConditions"]) or "Applies to the synthetic notice service.",
                    "assessability": "NON_ASSESSABLE"}
                assert scope["outcome"] == "PASSED", scope
                scopes[key].append(scope["claim"]["claimId"])
                claim = yield "register_semantic_claim", {
                    **common, "identity_key": f"{key}-{node_id}-duty", "claim_type": "DUTY",
                    "statement": row["proposition"], "actor": "Synthetic notice operator",
                    "action": row["proposition"],
                    "semantic_frame": {**common["semantic_frame"], **seed.get("semanticFrames", {}).get(key, {})},
                    "assessability": seed.get("assessability", {}).get(key,
                        "EXTERNAL_FULFILLMENT" if row["nonRepositoryDuty"] else "REPOSITORY_VERIFIABLE")}
                assert claim["outcome"] == "PASSED", claim
                operands[key].append(claim["claim"]["claimId"])
                relation = yield "link_semantic_claims", {
                    "from_claim_id": scopes[key][-1], "to_claim_id": operands[key][-1], "kind": "CONDITION_OF"}
                assert relation["outcome"] == "PASSED", relation
                for edge in packet["contextRelations"]:
                    if edge["fromLegalRequirementId"] == key:
                        linked = yield "link_semantic_claims", {
                            "from_claim_id": operands[key][-1],
                            "to_claim_id": operands[edge["toLegalRequirementId"]][0],
                            "kind": edge["kind"]}
                        assert linked["outcome"] == "PASSED", linked
                authored = True
            for reference in unit["references"]:
                result = yield "mark_reference_non_material", {
                    "reference_id": reference["referenceId"],
                    "reason": "Mechanical fixture defines each assertion locally; no incorporation is scripted."}
                assert result["outcome"] == "PASSED", result
            completed = yield "complete_source_review", {
                "disposition": "CLAIMS_AUTHORED" if authored else "NO_RELEVANT_SEMANTIC_CLAIMS",
                **({} if authored else {"reason": "Structural fixture unit outside the scripted assertions."})}
            assert completed["outcome"] == "PASSED", completed
        frozen = yield "finalize_semantic_claim_inventory", {}
        assert frozen["outcome"] == "PASSED", frozen
        started = yield "start_rule_authoring", {}
        assert started["outcome"] == "PASSED", started
        for row in packet["legalRequirements"]:
            key = row["legalRequirementId"]
            result = yield "author_legal_requirement", {
                "requirement_key": key, "title": row["title"],
                "operative_claim_ids": operands[key], "applicability_claim_ids": scopes[key],
                "non_repository_duty": row["nonRepositoryDuty"]}
            assert result["outcome"] == "PASSED", result
        for row in packet["assessmentRules"]:
            result = yield "author_assessment_rule", {
                "assessment_rule_id": row["assessmentRuleId"], "concept": row["concept"],
                "legal_requirement_ids": ["LR-MISSING"] if mode == "orphan" else row["legalRequirementIds"]}
            if mode != "orphan":
                assert result["outcome"] == "PASSED", result
        validation = yield "validate_compliance_rule_set", {}
        if mode == "valid":
            assert validation["outcome"] == "PASSED", validation
        yield "submit_compliance_rule_set", {}

    script = journey()
    first = True
    def policy(messages, model):
        nonlocal first
        result = last_result(messages)
        if calls and result is not None:
            calls[-1]["result"] = {k: result[k] for k in ("outcome", "gaps", "fingerprint") if k in result}
        try:
            name, args = next(script) if first else script.send(result)
        except StopIteration as error:
            raise AssertionError("Scripted Preparation exhausted without an API terminal") from error
        first = False
        calls.append({"tool": name})
        return _call(name, args, f"script-{len(calls)}")

    model = ViewDrivenModel(policy=policy)
    real_create = runner_module.create_rule_set_preparation_agent
    def create(**kwargs):
        nonlocal context
        context = kwargs["context"]
        # Only this CLI uses the mechanical auditor. The API still verifies signed receipts,
        # freeze, typed authoring and Validator results; this proves no legal-model quality.
        context.semantic_auditor = StructuralFixtureAuditor()
        return real_create(**kwargs)
    # The offline model has no provider route; routing is covered by the SDK-backed governance tests.
    with ExitStack() as stack:
        stack.enter_context(patch("rule_set_preparation.agent.MODEL_GOVERNANCE_MIDDLEWARE", ()))
        stack.enter_context(patch.object(runner_module, "create_rule_set_preparation_agent", create))
        if mode == "no-submit":
            # A source-blocking claim is only honored when the pinned source really is inconsistent, so
            # the scripted block is made true: one chunk file stops matching its INDEX pin.
            real_materialize = runner_module.materialize_legal_source

            def tampered(bundle: dict[str, Any], root: Any) -> list[str]:
                paths = real_materialize(bundle, root)
                chunk = root / paths[1].lstrip("/")
                chunk.write_text(chunk.read_text(encoding="utf-8").replace(
                    "contentSha256: ", "contentSha256: tampered-", 1), encoding="utf-8")
                return paths

            stack.enter_context(patch.object(runner_module, "materialize_legal_source", tampered))
        result = run_rule_set_preparation(api, run_id, model=model)
    if mode != "no-submit":
        result["scriptedCalls"] = calls
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
