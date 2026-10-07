"""Offline proof of the Assessment Root surface: tools, thread binding, researcher isolation.

The model is scripted; the Deep Agents graph, tool schemas, native ``task()``, permissions and the
governed tool code are real. The API is an in-memory fake that records every call.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest
from deepagents.backends import FilesystemBackend
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import ValidationError

from assessment_root.agent import create_assessment_root_agent, root_permissions
from assessment_root.client import AssessmentApiError
from assessment_root.researcher import RESEARCHER_NAME
from assessment_root.runner import run_assessment_root
from assessment_root.tools import ROOT_TOOL_NAMES, RootRun, SearchTrace, build_root_tools
from test_native_researcher_task_preparation import ScriptedModel

ASSESSMENT = "11111111-1111-4111-8111-111111111111"
THREAD = "22222222-2222-4222-8222-222222222222"
EXECUTION = "33333333-3333-4333-8333-333333333333"
COMMIT = "a" * 40
PINS = {
    "legalPortfolioVersionId": "44444444-4444-4444-8444-444444444444",
    "repositorySnapshotId": "55555555-5555-4555-8555-555555555555",
    "repositoryCommit": COMMIT,
}


class RootScriptedModel(ScriptedModel):
    model_name: str = "assessment-root-test"

    def _get_ls_params(self, **kwargs: Any) -> dict[str, str]:
        return {"ls_provider": self.model_name, "ls_model_type": "chat"}


def _call(name: str, args: dict[str, Any], call_id: str) -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": call_id}])


class FakeClient:
    """In-memory stand-in for the API tool plane; records every governed call."""

    def __init__(self, *, open_requests: list[str] | None = None) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.lease_token: str | None = None
        self.assessment_id: str | None = None
        self.case_revision = 0
        self.open_requests = open_requests or []
        self.reject_decision: AssessmentApiError | None = None

    def claim(self, assessment_id: str) -> dict[str, Any]:
        self.assessment_id = assessment_id
        self.lease_token = "lease-1"
        self.calls.append(("claim", assessment_id))
        return {
            "assessmentId": assessment_id,
            "threadId": THREAD,
            "executionId": EXECUTION,
            "leaseToken": "lease-1",
            "leaseExpiresAt": "2030-01-01T00:00:00.000Z",
            "checkpointNamespace": assessment_id,
            "executionState": "RUNNING",
        }

    def context(self) -> dict[str, Any]:
        self.calls.append(("context", None))
        return {
            "assessmentId": self.assessment_id,
            "threadId": THREAD,
            "lifecycleState": "ACTIVE",
            "lifecycleRevision": 2,
            "caseRevision": self.case_revision,
            "decisionScopeId": "ASSESSMENT",
            "repositoryScanJobId": "job-1",
            "coverage": [
                {
                    "engineeringRuleId": "ER-1",
                    "engineeringRuleVersion": "v1",
                    "resolutionState": "PENDING",
                    "currentDecisionId": None,
                    "decisionRevision": 0,
                }
            ],
            "facts": [],
            "evidence": [],
            "openHumanRequestIds": self.open_requests,
            **PINS,
        }

    def portfolio(self) -> dict[str, Any]:
        self.calls.append(("portfolio", None))
        return {
            "portfolioVersionId": PINS["legalPortfolioVersionId"],
            "legalRules": [{"legalRuleId": "LR-1", "title": "t", "proposition": "p"}],
            "engineeringRules": [
                {
                    "engineeringRuleId": "ER-1",
                    "engineeringRuleVersion": "v1",
                    "concept": "retention",
                    "legalRuleIds": ["LR-1"],
                    "criteria": [{"criterionId": "C-1", "statement": "s"}],
                }
            ],
            "contextRelations": [],
        }

    def post_evidence(self, body: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("evidence", body))
        return {"evidenceId": "66666666-6666-4666-8666-666666666666", "state": "ACCEPTED", "replayed": False}

    def post_fact(self, body: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("fact", body))
        self.case_revision += 1
        return {"factId": "77777777-7777-4777-8777-777777777777", "caseRevision": self.case_revision}

    def start_investigation(self, rule_id: str) -> dict[str, Any]:
        self.calls.append(("investigation", rule_id))
        return {"resolutionState": "INVESTIGATING"}

    def post_decision(self, body: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("decision", body))
        if self.reject_decision:
            raise self.reject_decision
        return {"decisionId": "88888888-8888-4888-8888-888888888888", "decisionRevision": 1, "replayed": False}

    def post_human_request(self, body: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("human", body))
        return {"requestId": "99999999-9999-4999-8999-999999999999", "caseRevision": self.case_revision, "requestRevision": 0}

    def post_activity(self, body: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("activity", body))
        return {"eventId": "e", "sequence": 1}

    def finish(self, state: str, **metadata: Any) -> dict[str, Any]:
        self.calls.append(("finish", state))
        return {"executionState": state}

    def heartbeat(self) -> dict[str, Any]:
        return {"leaseExpiresAt": "2030-01-01T00:00:00.000Z"}


def _repo(tmp_path: Path) -> Path:
    root = tmp_path / "repo"
    (root / "src").mkdir(parents=True)
    (root / "src" / "retention.py").write_text("a = 1\nb = 2\nkeep_days = 7\nc = 4\n", encoding="utf-8")
    return root


def _run(tmp_path: Path, client: FakeClient) -> RootRun:
    backend = FilesystemBackend(root_dir=_repo(tmp_path), virtual_mode=True)
    run = RootRun(client=client, assessment_id=ASSESSMENT, thread_id=THREAD, execution_id=EXECUTION, backend=backend)
    run.adopt_context(client.context())
    return run


def _tools(run: RootRun) -> dict[str, Any]:
    return {tool.name: tool for tool in build_root_tools(run)}


# ---- governed tools -----------------------------------------------------------------------------


def test_cite_repository_source_mints_only_through_the_server_with_a_verified_hash(tmp_path) -> None:
    client = FakeClient()
    tools = _tools(_run(tmp_path, client))

    result = json.loads(tools["cite_repository_source"].invoke({"path": "/src/retention.py", "start_line": 3, "end_line": 3}))

    assert result["ok"] is True and result["evidenceId"]
    body = next(b for kind, b in client.calls if kind == "evidence")
    assert body["type"] == "REPOSITORY_SOURCE" and body["repositoryCommit"] == COMMIT
    assert body["path"] == "src/retention.py"
    assert body["excerptSha256"] == "sha256:" + hashlib.sha256(b"keep_days = 7").hexdigest()
    # The agent can never type an evidence ID, identity, lease or hash.
    schema = tools["cite_repository_source"].args_schema.model_json_schema()["properties"]
    assert set(schema) == {"path", "start_line", "end_line"}


def test_cite_rejects_missing_files_and_out_of_range_without_calling_the_api(tmp_path) -> None:
    client = FakeClient()
    tools = _tools(_run(tmp_path, client))
    assert json.loads(tools["cite_repository_source"].invoke({"path": "nope.py", "start_line": 1, "end_line": 1}))["code"] == "FILE_NOT_FOUND"
    assert json.loads(tools["cite_repository_source"].invoke({"path": "src/retention.py", "start_line": 1, "end_line": 99}))["code"] == "RANGE_OUT_OF_BOUNDS"
    assert not any(kind == "evidence" for kind, _ in client.calls)


def test_search_trace_marks_result_truncation_and_reports_dropped_calls(monkeypatch) -> None:
    monkeypatch.setattr("assessment_root.tools._MAX_TRACE", 1)
    trace = SearchTrace()
    trace.on_tool_start({"name": "grep"}, "", run_id="first", inputs={"pattern": "notice"})
    trace.on_tool_end('{"hasMore":true,"results":[]}', run_id="first")
    trace.on_tool_start({"name": "glob"}, "", run_id="second", inputs={"pattern": "**/*"})
    trace.on_tool_end("one result", run_id="second")

    entries, dropped = trace.snapshot_and_reset()

    assert len(entries) == 1 and entries[0]["truncated"] is True
    assert dropped == 1
    assert trace.snapshot_and_reset() == ([], 0)


@pytest.mark.parametrize(
    ("output", "expected"),
    [
        ('{"has_more":false,"truncated":false}', False),
        ('{"hasMore":true,"results":[]}', True),
        ('{"note":"not truncated","has_more":false}', False),
        ("[truncated; narrow the query]", True),
    ],
)
def test_search_trace_requires_affirmative_truncation_metadata(output, expected) -> None:
    trace = SearchTrace()
    trace.on_tool_start({"name": "grep"}, "", run_id="search", inputs={"pattern": "notice"})
    trace.on_tool_end(output, run_id="search")

    entries, _ = trace.snapshot_and_reset()

    assert entries[0]["truncated"] is expected


@pytest.mark.parametrize(
    ("output", "count"),
    [
        ("No matches found", 0),
        ("No files found", 0),
        ("(no results)", 0),
        ("[]", 0),
        ("['/README.md', '/src/notices.py']", 2),
        ('["/README.md", "/src/notices.py"]', 2),
        ("/README.md\n/src/notices.py", 2),
        ("/src/notices.py:1: No matches found", 1),
    ],
)
def test_search_trace_counts_native_search_outputs(output, count) -> None:
    trace = SearchTrace()
    trace.on_tool_start({"name": "grep"}, "", run_id="search", inputs={"pattern": "notify"})
    trace.on_tool_end(output, run_id="search")
    entries, _ = trace.snapshot_and_reset()
    assert entries[0]["resultCount"] == count


def test_search_coverage_rejects_agent_fabricated_scope_and_query_fields(tmp_path) -> None:
    client = FakeClient()
    tools = _tools(_run(tmp_path, client))
    schema = tools["record_search_coverage"].args_schema

    assert set(schema.model_fields) == {
        "inspected_entry_points",
        "known_gaps",
        "direct_source_fallbacks",
    }
    with pytest.raises(ValidationError):
        schema.model_validate(
            {
                "scopes": [{"kind": "SOURCE_DIRECTORY", "path": "."}],
                "queries": [],
                "repository_commit": COMMIT,
            }
        )
    out = json.loads(tools["record_search_coverage"].invoke({"known_gaps": ["I searched everything"]}))
    assert out["code"] == "NO_SEARCH_ACTIVITY"
    assert not any(kind == "evidence" for kind, _ in client.calls)


def test_tool_schemas_expose_no_identity_pin_or_lifecycle_fields(tmp_path) -> None:
    tools = _tools(_run(tmp_path, FakeClient()))
    assert set(tools) == set(ROOT_TOOL_NAMES)
    forbidden = {"assessment_id", "thread_id", "execution_id", "lease", "evidence_id", "commit", "pins", "lifecycle", "state"}
    for tool in tools.values():
        fields = set(tool.args_schema.model_json_schema().get("properties", {}))
        assert not (fields & forbidden), (tool.name, fields & forbidden)


def test_submit_decision_binds_pins_versions_and_idempotency_from_server_state(tmp_path) -> None:
    client = FakeClient()
    tools = _tools(_run(tmp_path, client))
    evidence = "66666666-6666-4666-8666-666666666666"
    args = {
        "engineering_rule_id": "ER-1",
        "applicability": "APPLICABLE",
        "rationale": "The duty applies.",
        "legal_context_ids": ["LR-1"],
        "references": [{"type": "ASSESSMENT_EVIDENCE", "id": evidence}],
        "criteria": [
            {"criterion_id": "C-1", "outcome": "MET", "rationale": "Seen.", "references": [{"type": "ASSESSMENT_EVIDENCE", "id": evidence}]}
        ],
        "compliance": "COMPLIANT",
    }
    first = json.loads(tools["submit_rule_decision"].invoke(args))
    assert first["ok"] is True and first["decisionRevision"] == 1
    request = next(b for kind, b in client.calls if kind == "decision")
    decision = request["decision"]
    assert decision["engineeringRuleVersion"] == "v1"
    assert decision["legalPortfolioVersionId"] == PINS["legalPortfolioVersionId"]
    assert decision["repositorySnapshotId"] == PINS["repositorySnapshotId"]
    assert decision["repositoryCommit"] == COMMIT and decision["scopeId"] == "ASSESSMENT"
    assert request["expectedDecisionRevision"] == 0
    assert request["idempotencyKey"].startswith(f"decision:{THREAD}:")
    tools["submit_rule_decision"].invoke(args)
    replay = [b for kind, b in client.calls if kind == "decision"][-1]
    assert replay["idempotencyKey"] == request["idempotencyKey"]
    assert replay["expectedDecisionRevision"] == 1
    # Semantic content is exactly what the model authored.
    assert decision["applicability"] == "APPLICABLE" and decision["compliance"] == "COMPLIANT"
    assert decision["rationale"] == "The duty applies."


def test_rejected_decision_is_returned_as_structured_feedback_not_raised(tmp_path) -> None:
    client = FakeClient()
    client.reject_decision = AssessmentApiError(
        422, "ASSESSMENT_DECISION_VALIDATION_FAILED", {"failures": "CRITERIA_INCOMPLETE:C-1,UNKNOWN_LEGAL_CONTEXT:LR-9"}
    )
    tools = _tools(_run(tmp_path, client))
    out = json.loads(
        tools["submit_rule_decision"].invoke(
            {
                "engineering_rule_id": "ER-1",
                "applicability": "NOT_APPLICABLE",
                "rationale": "Out of scope.",
                "legal_context_ids": ["LR-9"],
                "references": [{"type": "CONFIRMED_FACT", "id": "77777777-7777-4777-8777-777777777777"}],
            }
        )
    )
    assert out["ok"] is False and out["code"] == "ASSESSMENT_DECISION_VALIDATION_FAILED"
    assert out["failures"] == ["CRITERIA_INCOMPLETE:C-1", "UNKNOWN_LEGAL_CONTEXT:LR-9"]
    assert out["retryable"] is False


def test_fact_tool_advances_the_local_case_revision_from_the_server_answer(tmp_path) -> None:
    client = FakeClient()
    run = _run(tmp_path, client)
    tools = _tools(run)
    out = json.loads(tools["accept_case_fact"].invoke({"kind": "USE_CASE", "statement": "A notice service.", "evidence_ids": ["66666666-6666-4666-8666-666666666666"]}))
    assert out["ok"] and out["caseRevision"] == 1 and run.case_revision == 1
    body = next(b for kind, b in client.calls if kind == "fact")
    assert body["expectedCaseRevision"] == 0


def test_search_coverage_is_built_from_the_runtime_trace_not_from_model_text(tmp_path) -> None:
    client = FakeClient()
    run = _run(tmp_path, client)
    tools = _tools(run)
    run.trace.on_tool_start(
        {"name": "search_code_graph"},
        "",
        run_id="graph",
        inputs={"name_pattern": "notify"},
    )
    run.trace.on_tool_end("(no results)", run_id="graph")
    run.trace.on_tool_start(
        {"name": "grep"}, "", run_id="grep", inputs={"pattern": "notify", "path": "/src"}
    )
    run.trace.on_tool_end(
        '{"results":[{"path":"src/notices.py"},{"path":"src/legacy.py"}],"hasMore":true}',
        run_id="grep",
    )
    run.trace.on_tool_start(
        {"name": "read_file"}, "", run_id="read", inputs={"file_path": "/src/retention.py"}
    )
    run.trace.on_tool_end("RETENTION_DAYS = 7", run_id="read")
    out = json.loads(
        tools["record_search_coverage"].invoke(
            {
                "inspected_entry_points": ["src/retention.py", "src/never_read.py"],
                "known_gaps": ["dynamic dispatch not traced"],
                "direct_source_fallbacks": [{"path": "src/retention.py", "reason": "graph had no node"}, {"path": "src/ghost.py", "reason": "x"}],
            }
        )
    )
    assert out["ok"] is True
    body = next(b for kind, b in client.calls if kind == "evidence")
    assert body["type"] == "SEARCH_COVERAGE"
    assert body["repositoryCommit"] == COMMIT
    assert {"kind": "SOURCE_DIRECTORY", "path": "src"} in body["scopes"]
    assert {"kind": "SOURCE_FILE", "path": "src/retention.py"} in body["scopes"]
    assert {"kind": "GRAPH_INDEX", "path": "."} in body["scopes"]
    assert body["queries"] == [
        {"tool": "search_code_graph", "query": "notify", "resultCount": 0, "truncated": False},
        {"tool": "grep", "query": "notify", "resultCount": 2, "truncated": True},
    ]
    # Only paths that were actually read can be claimed as inspected / fallback reads.
    assert body["inspectedEntryPoints"] == ["src/retention.py"]
    assert body["directSourceFallbacks"] == [{"path": "src/retention.py", "reason": "graph had no node"}]
    assert body["knownGaps"] == ["dynamic dispatch not traced"]
    again = json.loads(tools["record_search_coverage"].invoke({}))
    assert again["code"] == "NO_SEARCH_ACTIVITY"  # the trace was consumed


def test_failed_search_is_recorded_as_a_coverage_gap(tmp_path) -> None:
    client = FakeClient()
    run = _run(tmp_path, client)
    tools = _tools(run)
    run.trace.on_tool_start(
        {"name": "search_code_graph"}, "", run_id="graph", inputs={"name_pattern": "notice"}
    )
    run.trace.on_tool_end(
        "Codebase Memory graph is unavailable: no repository sandbox is active.", run_id="graph"
    )

    out = json.loads(tools["record_search_coverage"].invoke({}))
    body = next(body for kind, body in client.calls if kind == "evidence")

    assert out["ok"] is True
    assert body["queries"] == [
        {"tool": "search_code_graph", "query": "notice", "resultCount": 0, "truncated": False}
    ]
    assert body["knownGaps"] == ["The search_code_graph search did not return a usable result."]


# ---- the agent graph ------------------------------------------------------------------------------


def test_root_graph_has_one_delegate_the_read_only_researcher_without_governed_tools(tmp_path) -> None:
    client = FakeClient()
    run = _run(tmp_path, client)
    model = RootScriptedModel(
        responses=[
            _call("task", {"description": "Where is keep_days used?", "subagent_type": RESEARCHER_NAME}, "t1"),
            AIMessage(content="candidate findings: src/retention.py:3"),  # researcher answer
            AIMessage(content="root done"),
        ]
    )
    agent = create_assessment_root_agent(run=run, model=model, governance=(), checkpointer=InMemorySaver(), graph_tools=[])
    agent.invoke(
        {"messages": [{"role": "user", "content": "start"}]},
        config={"configurable": {"thread_id": THREAD}},
    )

    root_tools = set(model.bound_tool_names[0])
    child_tools = set(model.bound_tool_names[1])
    assert set(ROOT_TOOL_NAMES) <= root_tools and "task" in root_tools
    # The researcher is the only task target and holds no governed assessment tool at all.
    assert not (child_tools & set(ROOT_TOOL_NAMES))
    assert "task" not in child_tools
    task_tool = next(t for bound in model.bound_tools[:1] for t in bound if getattr(t, "name", "") == "task")
    agent_types = task_tool.description.split("Available agent types", 1)[1].split("Specify subagent_type", 1)[0]
    listed = [line[2:].split(":")[0] for line in agent_types.splitlines() if line.startswith("- ")]
    assert listed == [RESEARCHER_NAME]  # no general-purpose delegate
    # The pinned repository is read-only for Root and researcher alike; only scratch is writable.
    rules = [(p.operations, p.paths, p.mode) for p in root_permissions()]
    assert rules[-1] == (["write"], ["/**"], "deny")


def test_runner_binds_the_server_thread_and_settles_the_execution(tmp_path) -> None:
    client = FakeClient()
    saver = InMemorySaver()
    seen_configs: list[dict[str, Any]] = []

    from langchain_core.callbacks import BaseCallbackHandler

    class Spy(BaseCallbackHandler):
        def on_chain_start(self, serialized, inputs, *, metadata=None, **kwargs):  # noqa: ANN001
            if metadata and metadata.get("thread_id"):
                seen_configs.append(metadata)

    def factory(claim, context):
        return FilesystemBackend(root_dir=_repo(tmp_path), virtual_mode=True), None

    model = RootScriptedModel(
        responses=[
            _call("get_assessment_context", {}, "c1"),
            AIMessage(content="all rules covered"),
        ]
    )
    result = run_assessment_root(
        client,
        ASSESSMENT,
        backend_factory=factory,
        model=model,
        checkpointer=saver,
        governance=(),
        extra_callbacks=[Spy()],
    )
    assert result["state"] == "SUCCEEDED" and result["threadId"] == THREAD
    assert ("finish", "SUCCEEDED") in client.calls
    assert {m["thread_id"] for m in seen_configs} == {THREAD}
    # The checkpoint lives under the server thread and only that thread.
    assert [c.config["configurable"]["thread_id"] for c in saver.list(None)] and all(
        c.config["configurable"]["thread_id"] == THREAD for c in saver.list(None)
    )


def test_runner_rejects_transitional_wait_without_a_native_checkpoint(tmp_path) -> None:
    client = FakeClient(open_requests=["99999999-9999-4999-8999-999999999999"])
    model = RootScriptedModel(responses=[AIMessage(content="waiting")])
    result = run_assessment_root(
        client,
        ASSESSMENT,
        backend_factory=lambda claim, ctx: (FilesystemBackend(root_dir=_repo(tmp_path), virtual_mode=True), None),
        model=model,
        governance=(),
    )
    assert result["state"] == "FAILED" and ("finish", "FAILED") in client.calls


def test_runner_settles_a_crash_as_a_failed_execution_with_the_same_thread(tmp_path) -> None:
    client = FakeClient()

    class Boom(RootScriptedModel):
        def _generate(self, messages, **kwargs):  # noqa: ANN001
            raise RuntimeError("provider down")

    result = run_assessment_root(
        client,
        ASSESSMENT,
        backend_factory=lambda claim, ctx: (FilesystemBackend(root_dir=_repo(tmp_path), virtual_mode=True), None),
        model=Boom(responses=[]),
        governance=(),
    )
    assert result["state"] == "FAILED" and result["threadId"] == THREAD
    assert ("finish", "FAILED") in client.calls


def test_task_delegation_is_reported_as_subagent_activity_with_root_lineage(tmp_path) -> None:
    client = FakeClient()
    model = RootScriptedModel(
        responses=[
            _call("task", {"description": "look", "subagent_type": RESEARCHER_NAME}, "task-call-1"),
            AIMessage(content="findings"),
            AIMessage(content="done"),
        ]
    )
    run_assessment_root(
        client,
        ASSESSMENT,
        backend_factory=lambda claim, ctx: (FilesystemBackend(root_dir=_repo(tmp_path), virtual_mode=True), None),
        model=model,
        governance=(),
    )
    activity = [body for kind, body in client.calls if kind == "activity"]
    assert [a["labelKey"] for a in activity] == ["assessment.activity.taskStarted", "assessment.activity.taskFinished"]
    for event in activity:
        assert event["actorType"] == "SUBAGENT" and event["parentExecutionId"] == EXECUTION
        assert event["executionId"] != EXECUTION and event["taskId"]
    assert activity[0]["executionId"] == activity[1]["executionId"]


# ---- boundary -------------------------------------------------------------------------------------


def test_boundary_is_registered_once_and_rejects_malformed_commands() -> None:
    from types import SimpleNamespace

    from assessment_root.boundary import ASSESSMENT_ROOT_COMMAND, AssessmentRootBoundary
    from tools.common.capabilities.agent_runtime.boundary import NonRetryableAgentBoundaryError
    from tools.common.capabilities.agent_runtime.invocation import AGENT_INVOCATION_BOUNDARIES

    registered = [b for b in AGENT_INVOCATION_BOUNDARIES if b.source_event == ASSESSMENT_ROOT_COMMAND]
    assert len(registered) == 1 and registered[0].target == "assessment_root.boundary:AssessmentRootBoundary"
    boundary = AssessmentRootBoundary(SimpleNamespace(nestjs_api_base_url="http://x", worker_api_key="k"), client=FakeClient())
    with pytest.raises(NonRetryableAgentBoundaryError):
        boundary.handle({}, "corr")


def test_boundary_skips_a_held_lease_and_a_stale_delivery_without_error(monkeypatch) -> None:
    from types import SimpleNamespace

    from assessment_root.boundary import AssessmentRootBoundary
    import contextlib
    monkeypatch.setattr("assessment_root.boundary.postgres_checkpointer", lambda: contextlib.nullcontext(InMemorySaver()))

    for code in ("ASSESSMENT_EXECUTION_LEASE_HELD", "ASSESSMENT_NOT_ACTIVE"):
        def runner(client, assessment_id, **kwargs):  # noqa: ANN001
            raise AssessmentApiError(409, code)

        boundary = AssessmentRootBoundary(
            SimpleNamespace(nestjs_api_base_url="http://x", worker_api_key="k"), client=FakeClient(), runner=runner
        )
        assert boundary.handle({"assessmentId": ASSESSMENT}, "corr")["state"] == "SKIPPED"


def test_root_human_tool_uses_native_interrupt_and_replays_the_same_request(tmp_path) -> None:
    from langgraph.types import Command

    class HumanClient(FakeClient):
        def post_human_request(self, body):
            result = super().post_human_request(body)
            if self.case_revision == 0:
                self.open_requests = [result["requestId"]]
            return result

    client = HumanClient()
    run = _run(tmp_path, client)
    saver = InMemorySaver()
    model = RootScriptedModel(responses=[_call("open_human_request", {
        "engineering_rule_id": "ER-1", "question": "Who owns the operational policy?",
        "unresolved_fact": "Operational policy owner", "decision_impact": ["Determines responsibility"],
        "resolution_attempts": ["Reviewed the available sources and accepted facts"],
    }, "human-call"), AIMessage(content="Investigating the confirmed owner.")])
    agent = create_assessment_root_agent(run=run, model=model, governance=(), checkpointer=saver, graph_tools=[])
    config = {"configurable": {"thread_id": THREAD}}
    result = agent.invoke({"messages": [{"role": "user", "content": "Investigate"}]}, config)
    assert result["__interrupt__"][0].value["requestIds"] == client.open_requests
    checkpoint_id = agent.get_state(config).config["configurable"]["checkpoint_id"]
    assert checkpoint_id
    client.open_requests = []
    client.case_revision = 1
    agent.invoke(Command(resume={result["__interrupt__"][0].id: {"resolved": True}}), config)
    calls = [body for kind, body in client.calls if kind == "human"]
    assert len(calls) == 2 and calls[0]["idempotencyKey"] == calls[1]["idempotencyKey"]
    assert run.case_revision == 1 and not agent.get_state(config).next


@pytest.mark.parametrize("rejected", [False, True])
def test_unresolvable_fact_tool_blocks_then_resumes_without_reapplying_the_claim(tmp_path, rejected) -> None:
    from langgraph.types import Command

    class BlockedClient(FakeClient):
        def post_human_request(self, body):
            result = super().post_human_request(body)
            if self.case_revision == 0:
                self.open_requests = [result["requestId"]]
            return result

        def report_unresolvable_human_fact(self, body):
            self.calls.append(("unresolvable", body))
            if rejected:
                raise AssessmentApiError(409, "ASSESSMENT_EVIDENCE_REFERENCE_INVALID")
            return {"lifecycleState": "BLOCKED"}

    client = BlockedClient()
    run = _run(tmp_path, client)
    saver = InMemorySaver()
    model = RootScriptedModel(responses=[_call("report_human_fact_unresolvable", {
        "engineering_rule_id": "ER-1", "question": "Who owned the historical operational policy?",
        "unresolved_fact": "Historical policy owner", "decision_impact": ["Determines responsibility"],
        "resolution_attempts": ["Reviewed all accepted sources"],
        "unavailability_rationale": "The records were permanently destroyed and no other source exists under the contract.",
        "evidence_ids": ["66666666-6666-4666-8666-666666666666"],
    }, "blocked-call"), AIMessage(content="Investigating newly recovered facts.")])
    agent = create_assessment_root_agent(run=run, model=model, governance=(), checkpointer=saver, graph_tools=[])
    config = {"configurable": {"thread_id": THREAD}}
    result = agent.invoke({"messages": [{"role": "user", "content": "Investigate"}]}, config)
    assert result["__interrupt__"][0].value["requestIds"] == client.open_requests
    if rejected:
        assert result["__interrupt__"][0].value["claimRejected"]["code"] == "ASSESSMENT_EVIDENCE_REFERENCE_INVALID"
    claim = next(body for kind, body in client.calls if kind == "unresolvable")
    assert claim["expectedCaseRevision"] == 0 and claim["expectedRequestRevision"] == 0
    assert "lifecycleState" not in claim and "threadId" not in claim
    client.open_requests = []
    client.case_revision = 1
    agent.invoke(Command(resume={result["__interrupt__"][0].id: {"resolved": True}}), config)
    assert sum(kind == "unresolvable" for kind, _ in client.calls) == 1
    assert run.case_revision == 1 and not agent.get_state(config).next


def test_production_root_requires_a_durable_checkpointer(monkeypatch) -> None:
    from assessment_root.boundary import postgres_checkpointer
    monkeypatch.delenv("LANGGRAPH_CHECKPOINT_DATABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="required"):
        with postgres_checkpointer():
            pass
