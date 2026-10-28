"""Provider-free native capability regressions, not semantic model acceptance."""

import asyncio
import json
from pathlib import Path

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import AIMessage, ToolMessage

from assessment_root.agent import ROOT_INSTRUCTIONS, create_assessment_root_agent
from test_assessment_root_agent import (
    THREAD,
    FakeClient,
    RootScriptedModel,
    _call,
    _run,
    _tools,
    complete_root_messages,
)


def test_native_investigation_plan_survives_graph_reconstruction(tmp_path):
    client = FakeClient()
    saver = InMemorySaver()
    plan = [
        {"content": "Trace the logging helper's callers and record unresolved operational facts", "status": "in_progress"},
        {"content": "Ask the customer for material facts the pinned source cannot establish", "status": "pending"},
    ]
    model = RootScriptedModel(responses=[
        _call("write_todos", {"todos": plan}, "plan"),
        *complete_root_messages(),
    ])
    run = _run(tmp_path, client)
    graph = create_assessment_root_agent(
        run=run, model=model, governance=(), checkpointer=saver, graph_tools=[],
    )
    config = {"configurable": {"thread_id": THREAD}}

    graph.invoke({"messages": [{"role": "user", "content": "Investigate"}]}, config=config)
    restored = create_assessment_root_agent(
        run=run, model=model, governance=(), checkpointer=saver, graph_tools=[],
    )

    assert restored.get_state(config).values.get("todos") == plan
    assert "write_todos" in model.bound_tool_names[0]
    assert not any(name == "decision" for name, _ in client.calls)


def test_native_scratch_permission_does_not_allow_editing_the_runtime_pin_marker(tmp_path):
    client = FakeClient()
    run = _run(tmp_path, client)
    marker = tmp_path / "repo/.lcsp/repository.json"
    marker.parent.mkdir()
    marker.write_text("server-only-pins")
    model = RootScriptedModel(responses=[
        _call("edit_file", {"file_path": "/.lcsp/repository.json", "old_string": "server-only-pins", "new_string": "model-forged-pins"}, "tamper"),
        _call("write_file", {"file_path": "/.lcsp/agent/investigation.md", "content": "Working hypothesis; source support unresolved"}, "scratch"),
        *complete_root_messages(),
    ])
    graph = create_assessment_root_agent(run=run, model=model, governance=(), graph_tools=[])

    result = graph.invoke({"messages": [{"role": "user", "content": "Investigate"}]})

    replies = {m.tool_call_id: str(m.content) for m in result["messages"] if isinstance(m, ToolMessage)}
    assert "denied" in replies["tamper"].lower()
    assert marker.read_text() == "server-only-pins"
    assert marker.with_name("agent").joinpath("investigation.md").is_file()


def test_native_researcher_calls_use_the_roots_configured_governance(tmp_path):
    calls = []

    class ObserveModelCall(AgentMiddleware):
        def wrap_model_call(self, request, handler):
            calls.append(request)
            return handler(request)

    client = FakeClient()
    model = RootScriptedModel(responses=[
        _call("task", {"description": "Trace the logging helper's actual callers", "subagent_type": "repository-researcher"}, "research"),
        AIMessage(content="Candidate only: the helper's integration is not established."),
        *complete_root_messages(),
    ])
    graph = create_assessment_root_agent(
        run=_run(tmp_path, client), model=model, governance=[ObserveModelCall()], graph_tools=[],
    )

    graph.invoke({"messages": [{"role": "user", "content": "Investigate"}]})

    assert len(calls) == len(model.prompts)
    assert any("Trace the logging helper's actual callers" in str(r.messages) for r in calls)


@pytest.mark.parametrize("asynchronous", [False, True])
def test_native_context_compaction_uses_existing_governed_summary_path(tmp_path, monkeypatch, asynchronous):
    import deepagents.middleware.summarization as native_summary

    operations = []

    class ObserveSummary(AgentMiddleware):
        def wrap_model_call(self, request, handler):
            operations.append(request)
            return handler(request)

        async def awrap_model_call(self, request, handler):
            operations.append(request)
            return await handler(request)

    monkeypatch.setattr(native_summary, "compute_summarization_defaults", lambda _: {
        "trigger": ("messages", 10), "keep": ("messages", 1), "truncate_args_settings": None,
    })

    class CompactionModel(RootScriptedModel):
        async def _agenerate(self, messages, stop=None, run_manager=None, **kwargs):
            return self._generate(messages, stop=stop, run_manager=run_manager, **kwargs)

    client = FakeClient()
    model = CompactionModel(responses=[
        AIMessage(content="Source observation retained; deployment and operator facts remain unresolved."),
        *complete_root_messages(),
    ])
    graph = create_assessment_root_agent(
        run=_run(tmp_path, client), model=model, governance=[ObserveSummary()], graph_tools=[],
    )

    history = [
        {"role": "user", "content": f"Earlier investigation observation {i}"} for i in range(12)
    ]
    history[0]["content"] = [
        {"type": "text", "text": "Earlier investigation observation with an inline image"},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNuoAAAAASUVORK5CYII="}},
    ]
    captured = json.loads((Path(__file__).parents[2] /
        "docs/implementation-artifacts/lcsp360-cheatshield-20261026/genuine-decision-audit.json").read_text())
    fact_context = json.dumps({"facts": captured["facts"], "evidence": captured["evidence"]})
    history[1:1] = [
        _call("get_assessment_context", {}, "captured-context"),
        ToolMessage(content=fact_context, tool_call_id="captured-context"),
    ]
    if asynchronous:
        asyncio.run(graph.ainvoke({"messages": history}))
    else:
        graph.invoke({"messages": history})

    summaries = [operation for operation in operations if "Context Extraction Assistant" in str(operation.messages)]
    assert summaries, "native compaction must pass through the Root's configured governance"
    assert "Earlier investigation observation" in str(summaries[0].messages)
    assert summaries[0].system_message is not None, "compaction lost the investigator's authority instructions"
    assert summaries[0].system_message.content == ROOT_INSTRUCTIONS
    assert fact_context in str(summaries[0].messages), "retain the actual fact authority and evidence for model-authored compaction"
    saved_history = tmp_path / "repo/.lcsp/agent/conversation_history"
    assert list(saved_history.glob("*.md"))
    assert list((saved_history / "media").rglob("*.png"))
    assert not (tmp_path / "repo/conversation_history").exists()


def test_root_can_reload_one_original_decision_without_overwriting_its_revision(tmp_path):
    original = {"decisionId": "prior-model-decision", "decisionRevision": 1,
                "state": "SUPERSEDED", "decision": {"rationale": "Original model-authored claim"}}

    class HistoryClient(FakeClient):
        def rule_decisions(self, rule_id, revision=None):
            self.calls.append(("decision_read", (rule_id, revision)))
            return {"records": [original]}

    client = HistoryClient()
    run = _run(tmp_path, client)
    run.decision_revisions["ER-1"] = 3
    tool = _tools(run)["get_rule_decision"]

    result = json.loads(tool.invoke({"assessment_rule_id": "ER-1", "revision": 1}))

    assert result["records"] == [original]
    assert run.decision_revisions["ER-1"] == 3
    assert client.calls[-1] == ("decision_read", ("ER-1", 1))
    assert set(tool.args_schema.model_fields) == {"assessment_rule_id", "revision"}
    assert not any(name in {"decision", "fact", "human"} for name, _ in client.calls)


def test_rule_catalog_can_be_read_in_bounded_complete_pages(tmp_path):
    client = FakeClient()
    rule_set = client.rule_set()
    template = rule_set["assessmentRules"][0]
    rule_set["assessmentRules"] = [dict(template, assessmentRuleId=f"ER-{i}") for i in range(243)]
    client.rule_set_override = rule_set
    run = _run(tmp_path, client)
    catalog = _tools(run)["get_pinned_rule_set"]
    offset, seen = 0, []

    while offset is not None:
        page = json.loads(catalog.invoke({"offset": offset, "limit": 25}))
        assert page["assessmentRuleCount"] == 243
        assert len(page["assessmentRules"]) <= 25
        seen.extend(rule["assessmentRuleId"] for rule in page["assessmentRules"])
        offset = page["nextOffset"]

    assert seen == [f"ER-{i}" for i in range(243)]
    assert len(run.rule_versions) == 243


def test_captured_genuine_packet_can_be_reinvestigated_then_pause_for_human_facts(tmp_path):
    """Replay tool/context plumbing only: scripted choices are not a live semantic verdict."""
    captured = json.loads((Path(__file__).parents[2] /
        "docs/implementation-artifacts/lcsp360-cheatshield-20261026/genuine-decision-audit.json").read_text())
    trace = json.loads((Path(__file__).parents[2] /
        "docs/implementation-artifacts/lcsp360-cheatshield-20261026/native-root-investigation-trace-20261027.json").read_text())
    assert trace["assessmentId"] == captured["assessmentId"]
    prior = next(row for row in captured["acceptedDecisions"] if row["assessmentRuleId"] == "ar-c12-rec")
    basis = captured["latestDecisionPinnedLegalContext"]
    source = captured["latestDecisionPinnedSource"][0]
    rule_id = prior["assessmentRuleId"]
    criterion_id = prior["decision"]["criteria"][0]["criterionId"]

    class CapturedClient(FakeClient):
        def context(self):
            context = super().context()
            context["coverage"] = [{
                "assessmentRuleId": rule_id, "assessmentRuleVersion": prior["decision"]["assessmentRuleVersion"],
                "resolutionState": "RESOLVED", "currentDecisionId": prior["decisionId"], "decisionRevision": 1,
            }]
            context["facts"] = [dict(fact, evidenceIds=[link["evidenceId"] for link in trace["factEvidenceLinks"]
                                                      if link["factId"] == fact["factId"]])
                                for fact in captured["facts"]]
            context["evidence"] = captured["evidence"]
            return context

        def rule_decisions(self, rule_id, revision=None):
            return {"records": [prior]}

        def post_human_request(self, body):
            result = super().post_human_request(body)
            self.open_requests = [result["requestId"]]
            return result

    client = CapturedClient()
    client.rule_set_override = {
        "ruleSetVersionId": captured["ruleSetVersionId"],
        "assessmentRules": [{
            "assessmentRuleId": rule_id, "assessmentRuleVersion": prior["decision"]["assessmentRuleVersion"],
            "legalRequirementIds": [basis[0]["legalRequirementId"]], "criteria": basis[0]["criteria"],
        }],
        "legalRequirements": [dict(basis[0])], "contextRelations": [],
    }
    client.legal_texts[(source["documentId"], source["locator"])] = source
    plan = [{"content": "Establish actual operator and deployment facts before revising the original packet", "status": "in_progress"}]
    model = RootScriptedModel(responses=[
        _call("get_assessment_context", {}, "reload"),
        _call("get_rule_decision", {"assessment_rule_id": rule_id}, "original"),
        _call("get_assessment_rule", {"assessment_rule_id": rule_id}, "rule"),
        _call("read_legal_source", {"document_id": source["documentId"], "locator": source["locator"]}, "law"),
        _call("write_todos", {"todos": plan}, "plan"),
        _call("open_human_request", {
            "assessment_rule_id": rule_id, "criterion_ids": [criterion_id],
            "question": "Who operates the service, and has it been put into actual use?",
            "unresolved_fact": "Actual operator and deployment facts",
            "decision_impact": ["Determines which source-stated actor and activity need investigation"],
            "resolution_attempts": ["Re-read the original decision, its evidence-backed description and the pinned provision"],
        }, "human"),
    ])
    run = _run(tmp_path, client)
    saver = InMemorySaver()
    graph = create_assessment_root_agent(run=run, model=model, governance=(), graph_tools=[], checkpointer=saver)
    config = {"configurable": {"thread_id": THREAD}}

    result = graph.invoke({"messages": [{"role": "user", "content": "Re-investigate the prior decision's support"}]}, config)

    assert result["__interrupt__"][0].value["requestIds"] == client.open_requests
    assert graph.get_state(config).values["todos"] == plan
    assert prior["decision"]["rationale"] in str(model.prompts[-1])
    assert source["content"] in str(model.prompts[-1])
    assert not any(name in {"decision", "fact", "final_report"} for name, _ in client.calls)
