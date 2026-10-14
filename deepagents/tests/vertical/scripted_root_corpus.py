"""Provider-free Assessment Root script for parameterized corpus verticals."""

from __future__ import annotations

import json
import sys
from typing import Any, ClassVar

from deepagents.backends import FilesystemBackend
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver

from assessment_root.client import AssessmentRuntimeClient
from assessment_root.researcher import RESEARCHER_NAME
from assessment_root.runner import run_assessment_root
from test_native_researcher_task_preparation import ScriptedModel


def results(messages: list[Any]) -> list[dict[str, Any]]:
    values = []
    for message in messages:
        if isinstance(message, ToolMessage):
            try:
                values.append(json.loads(message.content))
            except (ValueError, TypeError):
                values.append({"raw": str(message.content)})
    return values


def call(name: str, args: dict[str, Any], call_id: str) -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": call_id}])


class DynamicModel(ScriptedModel):
    steps: list[Any] = []
    model_name: ClassVar[str] = "assessment-report-corpus-vertical"

    def _get_ls_params(self, **kwargs: Any) -> dict[str, str]:
        return {"ls_provider": self.model_name, "ls_model_type": "chat"}

    def _generate(self, messages, **kwargs):  # noqa: ANN001
        from langchain_core.outputs import ChatGeneration, ChatResult

        step = self.steps.pop(0)
        return ChatResult(generations=[ChatGeneration(message=step(messages))])


def main() -> int:
    base, key, assessment_id, repo_dir, config_path = sys.argv[1:6]
    config = json.loads(open(config_path, encoding="utf-8").read())
    rules = config["rules"]
    evidence: dict[str, str] = {}
    fact: dict[str, str] = {}

    def last(messages):
        return results(messages)[-1]

    def capture(name: str, messages):
        value = last(messages)
        if name == "evidence":
            evidence["source"] = value["evidenceId"]
        if name == "fact":
            fact["use_case"] = value["factId"]
        return value

    def decide(rule: dict[str, Any]):
        def step(messages):
            if rule["applicability"] == "NOT_APPLICABLE":
                args = {
                    "assessment_rule_id": rule["assessmentRuleId"],
                    "applicability": "NOT_APPLICABLE",
                    "rationale": rule["rationale"],
                    "legal_context_ids": rule["legalRequirementIds"],
                    "references": [{"type": "CONFIRMED_FACT", "id": fact["use_case"]}],
                    "criteria": [],
                }
            else:
                refs = [{"type": "ASSESSMENT_EVIDENCE", "id": evidence["source"]}]
                outcome = rule["compliance"]
                args = {
                    "assessment_rule_id": rule["assessmentRuleId"],
                    "applicability": "APPLICABLE",
                    "rationale": rule["rationale"],
                    "legal_context_ids": rule["legalRequirementIds"],
                    "references": refs,
                    "criteria": [{
                        "criterion_id": rule["criterionId"],
                        "outcome": "MET" if outcome == "COMPLIANT" else "NOT_MET",
                        "rationale": "Based on the accepted synthetic evidence.",
                        "references": refs,
                    }],
                    "compliance": outcome,
                }
            return call("submit_rule_decision", args, f"decision-{rule['assessmentRuleId']}")
        return step

    steps = [
        lambda m: call("get_assessment_context", {}, "context"),
        lambda m: call("get_pinned_rule_set", {}, "rules"),
        lambda m: call("grep", {"pattern": config["grepPattern"], "path": "/"}, "grep"),
        lambda m: call("cite_repository_source", {"path": "src/control.py", "start_line": 1, "end_line": 1}, "cite"),
        lambda m: (capture("evidence", m), call("task", {"description": "Confirm the synthetic control context.", "subagent_type": RESEARCHER_NAME}, "research"))[1],
        lambda m: AIMessage(content="The synthetic repository contains the declared control context."),
        lambda m: call("record_search_coverage", {"known_gaps": []}, "coverage"),
        lambda m: call("accept_case_fact", {"kind": "USE_CASE", "statement": config["factStatement"], "evidence_ids": [evidence["source"]]}, "fact"),
    ]
    for index, rule in enumerate(rules):
        if index == 0:
            steps.append(lambda m, rule=rule, index=index: (fact.__setitem__("use_case", last(m)["factId"]), call("start_rule_investigation", {"assessment_rule_id": rule["assessmentRuleId"]}, f"investigate-{index}"))[1])
        else:
            steps.append(lambda m, rule=rule, index=index: call("start_rule_investigation", {"assessment_rule_id": rule["assessmentRuleId"]}, f"investigate-{index}"))
        steps.append(decide(rule))
    steps.extend([
        lambda m: call("request_finalization", {}, "finalize"),
        lambda m: call("submit_final_report", {
            "summary": "Accepted canonical decisions and evidence complete this synthetic assessment.",
            "findings": [{"assessment_rule_id": rule["assessmentRuleId"], "summary": rule["rationale"], "recommendations": []} for rule in rules],
        }, "report"),
        lambda m: AIMessage(content="DONE"),
    ])
    model = DynamicModel(responses=[], steps=steps)
    result = run_assessment_root(
        AssessmentRuntimeClient(base, key), assessment_id,
        backend_factory=lambda claim, context: (FilesystemBackend(root_dir=repo_dir, virtual_mode=True), None),
        model=model, checkpointer=InMemorySaver(), governance=(),
    )
    print(json.dumps({"result": result, "remainingSteps": len(model.steps)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
