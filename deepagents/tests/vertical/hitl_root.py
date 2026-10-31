"""Real API + PostgresSaver HITL across separate processes; only the model is scripted."""
from __future__ import annotations

import json
import os
import sys
import uuid

from deepagents.backends import FilesystemBackend
from langchain_core.messages import AIMessage
from langgraph.checkpoint.postgres import PostgresSaver

from assessment_root.client import AssessmentRuntimeClient, AssessmentApiError
from assessment_root.runner import run_assessment_root
from vertical.scripted_root import DynamicScriptedModel, _call, _tool_results


def question(rule: str, suffix: str, criteria: dict) -> dict:
    return {"assessment_rule_id": rule, "criterion_ids": criteria[rule],
            "question": f"Who owns the customer notification process {suffix}?",
            "unresolved_fact": f"Customer notification owner {suffix}",
            "decision_impact": ["The confirmed owner determines which operational duty applies."],
            "resolution_attempts": ["Reviewed accepted facts and repository configuration; organizational ownership is not recorded."],
            "control_type": "FREE_TEXT", "choices": []}


def main() -> None:
    from orchestration.runtime_control import active_runtime_run_id
    active_runtime_run_id.set(os.getenv("LCSP_TEST_ROOT_RUNTIME_RUN_ID"))
    base, key, assessment_id, repo_dir, mode = sys.argv[1:6]
    steps = []
    criteria = {}
    def load_criteria(messages):
        result = next(r for r in reversed(_tool_results(messages)) if "assessmentRules" in r)
        criteria.update({r["assessmentRuleId"]: r["criterionIds"] for r in result["assessmentRules"]})
        return _call("grep", {"pattern": "notification_owner", "path": "/"}, "search")
    if mode in {"ask", "multiple", "crash", "crash-before-checkpoint"}:
        steps = [lambda m: _call("get_assessment_context", {}, "context"),
                 lambda m: _call("get_pinned_rule_set", {}, "rules"), load_criteria]
        def ask(messages):
            calls = [{"name": "open_human_request", "args": question("ER-RET", "one", criteria), "id": "human-one"}]
            if mode == "multiple":
                calls.append({"name": "open_human_request", "args": question("ER-XREF", "two", criteria), "id": "human-two"})
            return AIMessage(content="", tool_calls=calls)
        steps.append(ask)
    if mode in {"unresolvable", "unresolvable-crash", "unresolvable-crash-before-checkpoint", "unresolvable-multiple", "unresolvable-rejected"}:
        steps = [lambda m: _call("get_assessment_context", {}, "context"),
                 lambda m: _call("get_pinned_rule_set", {}, "rules"),
                 lambda m: (load_criteria(m), _call("cite_repository_source", {"path": "README.md", "start_line": 1, "end_line": 1}, "source"))[1],
                 lambda m: _call("report_human_fact_unresolvable", {
                     **question("ER-RET", "one", criteria),
                     "unavailability_rationale": "The historical ownership records were permanently lost and no alternate source exists under the assessment contract.",
                     "evidence_ids": [_tool_results(m)[-1]["evidenceId"]],
                 }, "unresolvable")]
        if mode == "unresolvable-multiple":
            steps[-1] = lambda m: AIMessage(content="", tool_calls=[{
                "name": "report_human_fact_unresolvable",
                "args": {**question(rule, suffix, criteria),
                         "unavailability_rationale": "Historical records were permanently lost and no alternate source exists under the assessment contract.",
                         "evidence_ids": [_tool_results(m)[-1]["evidenceId"]]},
                "id": f"unresolvable-{suffix}",
            } for rule, suffix in [("ER-RET", "one"), ("ER-XREF", "two")]])
    steps.append(lambda m: AIMessage(content="Confirmed facts reloaded; investigation continues."))
    model = DynamicScriptedModel(responses=[], steps=steps)
    client = AssessmentRuntimeClient(base, key)
    api_checks = []
    if mode in {"unresolvable", "unresolvable-crash", "unresolvable-crash-before-checkpoint"}:
        report = client.report_unresolvable_human_fact
        def checked_report(body):
            for patch, code in [
                ({"humanResolutionRequestId": str(uuid.uuid4())}, "ASSESSMENT_HUMAN_REQUEST_NOT_FOUND"),
                ({"expectedCaseRevision": body["expectedCaseRevision"] + 1}, "ASSESSMENT_CASE_REVISION_STALE"),
                ({"expectedRequestRevision": body["expectedRequestRevision"] + 1}, "ASSESSMENT_HUMAN_REQUEST_REVISION_STALE"),
                ({"evidenceIds": [str(uuid.uuid4())]}, "ASSESSMENT_EVIDENCE_REFERENCE_INVALID"),
            ]:
                try:
                    report({**body, **patch})
                except AssessmentApiError as error:
                    assert error.code == code, error.code
                    api_checks.append(code)
                else:
                    raise AssertionError("invalid blocker packet was accepted")
            result = report(body)
            assert report(body)["replayed"] is True
            api_checks.append("REPLAYED")
            try:
                report({**body, "rationale": "A different claim"})
            except AssessmentApiError as error:
                assert error.code == "ASSESSMENT_IDEMPOTENCY_CONFLICT", error.code
                api_checks.append(error.code)
            else:
                raise AssertionError("conflicting blocker replay was accepted")
            if mode == "unresolvable-crash-before-checkpoint":
                os._exit(75)
            return result
        client.report_unresolvable_human_fact = checked_report
    if mode == "unresolvable-rejected":
        report = client.report_unresolvable_human_fact
        client.report_unresolvable_human_fact = lambda body: report({**body, "evidenceIds": [str(uuid.uuid4())]})
    if mode in {"crash", "unresolvable-crash"}:
        # Simulate abrupt worker loss AFTER native checkpoint persistence and BEFORE API finish.
        client.finish = lambda *args, **kwargs: os._exit(73)
    if mode == "crash-before-checkpoint":
        persist = client.post_human_request
        def crash_after_request(body):
            persist(body)
            os._exit(74)
        client.post_human_request = crash_after_request
    with PostgresSaver.from_conn_string(os.environ["LANGGRAPH_CHECKPOINT_DATABASE_URL"]) as saver:
        saver.setup()
        result = run_assessment_root(client, assessment_id,
            backend_factory=lambda claim, context: (FilesystemBackend(root_dir=repo_dir, virtual_mode=True), None),
            model=model, checkpointer=saver, governance=())
        saved = saver.get_tuple({"configurable": {"thread_id": result["threadId"]}})
        print(json.dumps({"result": result, "checkpoint": saved.config["configurable"]["checkpoint_id"],
                          "remainingSteps": len(model.steps), "pid": os.getpid(), "apiChecks": api_checks}))


if __name__ == "__main__":
    main()
