"""Drive the REAL Rule Set Preparation agent and API client with a scripted (provider-free) model.

Used by tests/compliance-rule-set-vertical.mjs. The model is scripted; everything else is real:
the Deep Agent graph, tool surface, WorkerApiClient HTTP calls, API, validator and PostgreSQL.

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
from test_rule_set_preparation_native_isolation_preparation import RuleSetPreparationScriptedModel
from tools.common.capabilities.platform.api_client import WorkerApiClient

DOC = "SYNTHETIC-NOTICE-INSTRUMENT"


def _ref(hashes: dict[str, str], locator: str, *, hash_override: str | None = None) -> dict[str, str]:
    return {"documentId": DOC, "locator": locator, "contentSha256": hash_override or hashes[locator]}


def _legal(rule_id: str, locators: list[str], hashes: dict[str, str], *, duty: bool = False) -> dict[str, Any]:
    return {
        "legalRequirementId": rule_id,
        "title": f"Rule {rule_id}",
        "proposition": f"Proposition {rule_id}.",
        "applicabilityConditions": [],
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
            {"relationId": "REL-EXC", "kind": "EXCEPTION", "fromLegalRequirementId": "LR-RET",
             "toLegalRequirementId": "LR-EXC", "toSourceRef": None},
            {"relationId": "REL-DEF", "kind": "DEFINITION", "fromLegalRequirementId": "LR-XREF",
             "toLegalRequirementId": None, "toSourceRef": _ref(hashes, "art-1::cl-1")},
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
    if mode == "stale":
        packet["legalRequirements"][1]["sourceRefs"][0]["contentSha256"] = "sha256:" + "f" * 64
    elif mode == "orphan":
        packet["assessmentRules"][0]["legalRequirementIds"] = ["LR-MISSING"]

    if mode == "no-submit":
        responses = [_call("report_rule_set_source_blocked", {
            "reason": "SOURCE_PINS_INCONSISTENT", "path": "/legal-source/INDEX.md",
        }, "blocked")]
    else:
        responses = [
            _call("read_file", {"file_path": "/legal-source/INDEX.md"}, "read-index"),
            _call("validate_compliance_rule_set", {"packet": packet}, "validate"),
            _call("submit_compliance_rule_set", {"packet": packet}, "submit"),
            AIMessage(content="DONE"),
        ]
    model = RuleSetPreparationScriptedModel(responses=responses)
    # The offline model has no provider route; routing is covered by the SDK-backed governance tests.
    with ExitStack() as stack:
        stack.enter_context(patch("rule_set_preparation.agent.MODEL_GOVERNANCE_MIDDLEWARE", ()))
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
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
