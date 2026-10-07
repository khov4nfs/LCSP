"""Drive the REAL Legal Preparation agent and API client with a scripted (provider-free) model.

Used by tests/legal-portfolio-vertical.mjs. The model is scripted; everything else is real:
the Deep Agent graph, tool surface, WorkerApiClient HTTP calls, API, validator and PostgreSQL.

usage: scripted_preparation.py <apiBase> <workerKey> <runId> <seedJson> <mode>
modes: valid | stale | orphan | no-submit | bridge
"""

from __future__ import annotations

import json
import sys
from typing import Any

from langchain_core.messages import AIMessage

from legal_preparation.runner import run_legal_preparation
from test_legal_preparation_native_isolation_preparation import LegalPreparationScriptedModel
from tools.common.capabilities.platform.api_client import WorkerApiClient

DOC = "SYNTHETIC-NOTICE-INSTRUMENT"


def _ref(hashes: dict[str, str], locator: str, *, hash_override: str | None = None) -> dict[str, str]:
    return {"documentId": DOC, "locator": locator, "contentSha256": hash_override or hashes[locator]}


def _legal(rule_id: str, locators: list[str], hashes: dict[str, str], *, duty: bool = False) -> dict[str, Any]:
    return {
        "legalRuleId": rule_id,
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
            else {"state": "COVERED_BY_ENGINEERING_RULES", "nonAssessableReason": None}
        ),
    }


def _engineering(rule_id: str, legal_ids: list[str], locators: list[str], hashes: dict[str, str]) -> dict[str, Any]:
    return {
        "engineeringRuleId": rule_id,
        "legalRuleIds": legal_ids,
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
        "legalRules": [
            _legal("LR-DEF", ["art-1::cl-1"], hashes),
            _legal("LR-RET", ["art-5::cl-1::pt-a", "art-5::cl-1::pt-b"], hashes),
            _legal("LR-EXC", ["art-3::cl-1"], hashes),
            _legal("LR-XREF", ["art-4::cl-1::pt-a", "art-2::cl-1"], hashes),
            _legal("LR-PERSON", ["art-6::cl-1"], hashes, duty=True),
        ],
        "engineeringRules": [
            _engineering("ER-DEF", ["LR-DEF"], ["art-1::cl-1"], hashes),
            _engineering("ER-RET", ["LR-RET", "LR-EXC"], ["art-5::cl-1::pt-a", "art-3::cl-1"], hashes),
            _engineering("ER-XREF", ["LR-XREF"], ["art-4::cl-1::pt-a"], hashes),
        ],
        "contextRelations": [
            {"relationId": "REL-EXC", "kind": "EXCEPTION", "fromLegalRuleId": "LR-RET",
             "toLegalRuleId": "LR-EXC", "toSourceRef": None},
            {"relationId": "REL-DEF", "kind": "DEFINITION", "fromLegalRuleId": "LR-XREF",
             "toLegalRuleId": None, "toSourceRef": _ref(hashes, "art-1::cl-1")},
        ],
    }


def _call(name: str, args: dict[str, Any], call_id: str) -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": call_id}])


def main() -> int:
    base, key, run_id, seed_path, mode = sys.argv[1:6]
    seed = json.loads(open(seed_path, encoding="utf-8").read())
    hashes: dict[str, str] = seed["hashes"]
    api = WorkerApiClient(base, key)

    if mode == "bridge":
        from unittest.mock import MagicMock

        from tools.common.capabilities.assessment.investigation.engineering_rule.rule_sources import (
            resolve_engineering_rules,
        )

        retriever = MagicMock()
        resolution = resolve_engineering_rules(
            api_client=api, retriever=retriever, workflow_run_id="vertical", correlation_id="vertical"
        )
        print(json.dumps({
            "status": resolution.status,
            "reason": resolution.reason,
            "portfolioVersionId": resolution.catalog_version_id,
            "corpusVersionId": resolution.corpus_version_id,
            "engineeringRuleIds": sorted(rule.engineering_rule_id for rule in resolution.rules),
            "legalRuleIds": sorted(rule["legalRuleId"] for rule in resolution.legal_rules),
            "indexedChunks": len(retriever.index_corpus.call_args.args[1]) if retriever.index_corpus.called else 0,
            "limitations": list(resolution.limitations),
        }))
        return 0

    packet = build_packet(hashes)
    if mode == "stale":
        packet["legalRules"][1]["sourceRefs"][0]["contentSha256"] = "sha256:" + "f" * 64
    elif mode == "orphan":
        packet["engineeringRules"][0]["legalRuleIds"] = ["LR-MISSING"]

    if mode == "no-submit":
        responses = [AIMessage(content="I could not complete the preparation.")]
    else:
        responses = [
            _call("read_file", {"file_path": "/corpus/INDEX.md"}, "read-index"),
            _call("validate_legal_portfolio", {"packet": packet}, "validate"),
            _call("submit_legal_portfolio", {"packet": packet}, "submit"),
            AIMessage(content="DONE"),
        ]
    model = LegalPreparationScriptedModel(responses=responses)
    result = run_legal_preparation(api, run_id, model=model)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
