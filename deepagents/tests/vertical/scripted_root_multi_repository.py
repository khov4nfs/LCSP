"""Provider-free Assessment Root script for an assessment pinned to two repositories.

The script lays two repositories side by side under one filesystem root (the layout the sandbox hydrates), then walks
the real Root tools against the real API: it cites source from BOTH repositories, accepts a fact backed by both, and
decides one rule from both repositories and another from a single repository.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from deepagents.backends import FilesystemBackend
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import InMemorySaver

from assessment_root.client import AssessmentRuntimeClient
from assessment_root.researcher import RESEARCHER_NAME
from assessment_root.runner import run_assessment_root
from scripted_root import (
    BoundedReadStep,
    DynamicScriptedModel,
    _call as call,
    _catalog_read,
    _scope_read,
    _tool_results as results,
)


def lay_out_repositories(root: Path, assessment_id: str, repositories: list[dict[str, Any]]) -> None:
    """Business purpose: Reproduce the hydrated multi-repository sandbox layout without Docker.

    Business rules:
    - Every repository lives in its own directory named by its repositoryKey and carries the runtime marker the Root
      verifies against the API pins (assessment, snapshot, commit, source scope, key).

    Execution flow:
    1. Create each repository directory with its source files.
    2. Write its runtime marker from the pins the test read back from the API.

    Failure cases:
    - A file system error aborts the vertical before any model step runs.

    Side effects:
    - Writes files below the given temporary root only.
    """
    for repository in repositories:
        base = root / repository["repositoryKey"]
        (base / ".lcsp").mkdir(parents=True, exist_ok=True)
        for relative, content in repository["files"].items():
            target = base / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
        marker = {
            "assessmentId": assessment_id,
            "snapshotId": repository["snapshotId"],
            "commitSha": repository["commit"],
            "sourcePathPrefix": repository["sourcePathPrefix"],
            "repositoryKey": repository["repositoryKey"],
            "sourceCoverage": {
                "sourcePathPrefix": repository["sourcePathPrefix"],
                "coverageLimited": False,
                "includedFiles": len(repository["files"]),
                "skippedEntries": [],
            },
        }
        (base / ".lcsp" / "repository.json").write_text(json.dumps(marker), encoding="utf-8")


def main() -> int:
    from orchestration.runtime_control import active_runtime_incarnation_id, active_runtime_run_id

    # The harness admits this run through the Root capacity fixture and hands over its identity.
    active_runtime_run_id.set(os.getenv("LCSP_TEST_ROOT_RUNTIME_RUN_ID"))
    active_runtime_incarnation_id.set(os.getenv("LCSP_TEST_ROOT_INCARNATION_ID"))
    base_url, key, assessment_id, repo_root, config_path = sys.argv[1:6]
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    repositories = config["repositories"]
    lay_out_repositories(Path(repo_root), assessment_id, repositories)
    web, api = repositories[0], repositories[1]
    captured: dict[str, Any] = {}
    evidence: dict[str, str] = {}

    def last(messages):
        return results(messages)[-1]

    def decide(rule: dict[str, Any], evidence_names: list[str]):
        """Submit one decision whose criteria and applicability basis follow the pinned rule set the Root read."""

        def step(messages):
            refs = [{"type": "ASSESSMENT_EVIDENCE", "id": evidence[name]} for name in evidence_names]
            compliant = rule["compliance"] == "COMPLIANT"
            pinned = next(
                row for row in captured["rule_set"]["assessmentRules"] if row["assessmentRuleId"] == rule["assessmentRuleId"]
            )
            requirement = rule["legalRequirementIds"][0]
            basis = [{
                "legal_requirement_id": requirement, "kind": "APPLICABILITY_CONDITION", "index": 0,
                "finding": "ESTABLISHED",
                "rationale": "The accepted source evidence establishes that personal data is processed.",
                "references": refs,
            }]
            basis.extend({
                "legal_requirement_id": element["legalRequirementId"], "kind": "OPERATIVE_SCOPE",
                "index": element["index"], "finding": "ESTABLISHED",
                "rationale": "The accepted source evidence establishes the operator and activity.",
                "references": refs,
            } for element in captured[f"scope_{rule['assessmentRuleId']}"]["applicabilityElements"]
              if element["kind"] == "OPERATIVE_SCOPE")
            return call("submit_rule_decision", {
                "assessment_rule_id": rule["assessmentRuleId"],
                "applicability": "APPLICABLE",
                "rationale": rule["rationale"],
                "legal_context_ids": rule["legalRequirementIds"],
                "references": refs,
                "criteria": [
                    {
                        "criterion_id": criterion,
                        "outcome": "MET" if compliant else "NOT_MET",
                        "rationale": "Based on the accepted source evidence of the named repositories.",
                        "references": refs,
                    }
                    for criterion in pinned["criterionIds"]
                ],
                "compliance": rule["compliance"],
                "applicability_basis": basis,
            }, f"decision-{rule['assessmentRuleId']}")

        return step

    both, only_api = config["rules"]
    steps = [
        BoundedReadStep(_catalog_read(captured), "catalog", captured),
        lambda m: call("grep", {"pattern": web["grepPattern"], "path": f"/{web['repositoryKey']}"}, "grep-web"),
        lambda m: call("grep", {"pattern": api["grepPattern"], "path": f"/{api['repositoryKey']}/{api['sourcePathPrefix']}"}, "grep-api"),
        lambda m: call("cite_repository_source", {"path": f"/{web['repositoryKey']}/{web['citePath']}", "start_line": 1, "end_line": 1}, "cite-web"),
        lambda m: (
            evidence.__setitem__("web", last(m)["evidenceId"]),
            call("cite_repository_source", {"path": f"/{api['repositoryKey']}/{api['citePath']}", "start_line": 1, "end_line": 1}, "cite-api"),
        )[1],
        lambda m: (
            evidence.__setitem__("api", last(m)["evidenceId"]),
            call("task", {"description": "Confirm both repositories implement the consent lifecycle.", "subagent_type": RESEARCHER_NAME}, "research"),
        )[1],
        # (the researcher answers here: one model turn consumed by the child graph)
        lambda m: AIMessage(content="The web repository collects consent and the api repository stores it."),
        lambda m: call("record_search_coverage", {"known_gaps": []}, "coverage"),
        lambda m: (
            captured.__setitem__("coverage", last(m)),
            call("accept_case_fact", {"kind": "USE_CASE", "statement": config["factStatement"], "evidence_ids": [evidence["web"], evidence["api"]]}, "fact"),
        )[1],
        lambda m: (captured.__setitem__("fact", last(m)), call("start_rule_investigation", {"assessment_rule_id": both["assessmentRuleId"]}, "investigate-both"))[1],
        BoundedReadStep(_scope_read(captured, both["assessmentRuleId"]), "scope-both", captured),
        decide(both, ["web", "api"]),
        lambda m: (captured.__setitem__("decision_both", last(m)), call("start_rule_investigation", {"assessment_rule_id": only_api["assessmentRuleId"]}, "investigate-api"))[1],
        BoundedReadStep(_scope_read(captured, only_api["assessmentRuleId"]), "scope-api", captured),
        decide(only_api, ["api"]),
        lambda m: (captured.__setitem__("decision_api", last(m)), call("request_finalization", {}, "finalize"))[1],
        lambda m: (captured.__setitem__("finalization", last(m)), call("submit_final_report", {
            "summary": "Consent collection (web) and its storage and deletion (api) were assessed across both repositories.",
            "findings": [
                {"assessment_rule_id": rule["assessmentRuleId"], "summary": rule["rationale"], "recommendations": []}
                for rule in (both, only_api)
            ],
        }, "report"))[1],
        lambda m: (captured.__setitem__("report", last(m)), AIMessage(content="DONE"))[1],
    ]
    model = DynamicScriptedModel(responses=[], steps=steps)
    backend_root = Path(repo_root)
    result = run_assessment_root(
        AssessmentRuntimeClient(base_url, key), assessment_id,
        backend_factory=lambda claim, context: (FilesystemBackend(root_dir=backend_root, virtual_mode=True), None),
        model=model, checkpointer=InMemorySaver(), governance=(),
    )
    print(json.dumps({
        "result": result,
        "remainingSteps": len(model.steps),
        "coverage": captured.get("coverage"),
        "decisions": [captured.get("decision_both"), captured.get("decision_api")],
        "finalization": captured.get("finalization"),
        "report": captured.get("report"),
    }))
    return 0


if __name__ == "__main__":
    from approved_bundle_fixture import offline_instruction_bundle
    with offline_instruction_bundle():
        raise SystemExit(main())
