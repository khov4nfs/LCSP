"""Offline admission and prompt regressions for focused customer clarification."""
import json

import pytest
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from assessment_root.agent import ROOT_INSTRUCTIONS, ROOT_INSTRUCTIONS_VI, create_assessment_root_agent
from runtime_instruction_bundle import production_runtime_bundle
from test_assessment_root_agent import FakeClient, RootScriptedModel, THREAD, _call, _run, complete_root_messages


@pytest.mark.parametrize("shape", ["parallel", "batch", "mixed", "unresolvable"])
def test_multiple_questions_are_rejected_before_any_tool_effect_and_one_shared_question_resumes(tmp_path, shape):
    class HumanClient(FakeClient):
        def post_human_request(self, body):
            result = super().post_human_request(body)
            if self.case_revision == 0:
                self.open_requests = [result["requestId"]]
            return result

    question = {
        "assessment_rule_id": "ER-1", "criterion_ids": ["C-1"],
        "question": "How long are production login logs retained?",
        "unresolved_fact": "Production login-log retention period",
        "decision_impact": ["Establishes the retention period for the selected criteria"],
        "resolution_attempts": ["Reviewed the configuration and accepted operational facts"],
        "dependencies": [{"assessment_rule_id": "ER-2", "criterion_ids": ["C-2"]}],
    }
    second = {**question, "question": "Who is the privacy contact?", "unresolved_fact": "Privacy contact"}
    calls = [
        {"name": "open_human_request", "args": question, "id": "ask-1"},
        {"name": "open_human_request", "args": second, "id": "ask-2"},
    ]
    if shape == "batch":
        calls = [{"name": "open_human_requests_batch", "args": {"requests": [question, second]}, "id": "batch"}]
    elif shape == "mixed":
        calls[1] = {"name": "open_human_requests_batch", "args": {"requests": [second]}, "id": "batch"}
    elif shape == "unresolvable":
        calls[1] = {"name": "report_human_fact_unresolvable", "args": {**second,
            "unavailability_rationale": "A supplied record claims the contact cannot be obtained", "evidence_ids": ["ev-1"]}, "id": "unresolvable"}
    # A mixed turn must not partly execute its unrelated side effect either.
    calls.append({"name": "request_finalization", "args": {}, "id": "premature-finalization"})
    model = RootScriptedModel(responses=[
        AIMessage(content="", tool_calls=calls),
        _call("open_human_request", question, "focused-question"),
        *complete_root_messages(),
    ])
    client = HumanClient()
    run = _run(tmp_path, client)
    agent = create_assessment_root_agent(run=run, model=model, governance=(), checkpointer=InMemorySaver(), graph_tools=[])
    config = {"configurable": {"thread_id": THREAD}}
    paused = agent.invoke({"messages": [{"role": "user", "content": "Investigate"}]}, config)
    assert len(paused["__interrupt__"]) == 1
    assert len(paused["__interrupt__"][0].value["requestIds"]) == 1
    assert not any(kind in {"human_batch", "finalization"} for kind, _ in client.calls)
    persisted = [body for kind, body in client.calls if kind == "human"]
    assert len(persisted) == 1
    assert persisted[0]["question"] == question["question"]
    assert persisted[0]["dependencies"] == [{"assessmentRuleId": "ER-2", "criterionIds": ["C-2"]}]
    rejected = [message for message in paused["messages"] if isinstance(message, ToolMessage) and message.tool_call_id in {call["id"] for call in calls}]
    assert len(rejected) == len(calls)
    assert all(json.loads(message.content)["reason"] == "ONE_CUSTOMER_QUESTION_PER_TURN" for message in rejected)
    client.open_requests = []
    client.case_revision = 1
    agent.invoke(Command(resume={paused["__interrupt__"][0].id: {"resolved": True}}), config)
    persisted = [body for kind, body in client.calls if kind == "human"]
    assert len(persisted) == 2 and persisted[0]["idempotencyKey"] == persisted[1]["idempotencyKey"]
    assert not agent.get_state(config).next


def test_runtime_and_localized_sources_require_one_relevant_question_without_forcing_verdicts():
    runtime = production_runtime_bundle().instruction("assessment-root.system")
    for prompt in [runtime, ROOT_INSTRUCTIONS]:
        assert "one focused customer question at a time" in prompt
        assert "same operational fact, actor, workflow and time" in prompt
        assert "one request with `dependencies`" in prompt
        assert 'An "I don\'t know" answer stays OPEN' in prompt
        assert "Do not impose a total question cap that forces a verdict" in prompt
        assert "Multiple independent material facts may be requested together" not in prompt
    assert "một câu hỏi có trọng tâm" in ROOT_INSTRUCTIONS_VI
    assert "không gọi song song" in ROOT_INSTRUCTIONS_VI
    assert "Không đặt tổng số câu hỏi tối đa" in ROOT_INSTRUCTIONS_VI
