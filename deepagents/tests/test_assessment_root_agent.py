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

from assessment_root.agent import create_assessment_root_agent, root_permissions
from assessment_root.client import AssessmentApiError
from assessment_root.researcher import RESEARCHER_NAME
from assessment_root.runner import run_assessment_root
from assessment_root.tools import ROOT_TOOL_NAMES, RootRun, build_root_tools
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
        return {"requestId": "99999999-9999-4999-8999-999999999999", "caseRevision": self.case_revision}

    def post_activity(self, body: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("activity", body))
        return {"eventId": "e", "sequence": 1}

    def finish(self, state: str) -> dict[str, Any]:
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
    assert request["idempotencyKey"].startswith(f"{EXECUTION}:ER-1:")
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
    run.trace.entries.extend(
        [
            {"tool": "grep", "args": {"pattern": "keep_days", "path": "/src"}, "resultCount": 3, "truncated": False},
            {"tool": "read_file", "args": {"file_path": "/src/retention.py"}, "resultCount": 4, "truncated": False},
        ]
    )
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
    assert {"kind": "SOURCE_DIRECTORY", "path": "src"} in body["scopes"]
    assert {"kind": "SOURCE_FILE", "path": "src/retention.py"} in body["scopes"]
    assert body["queries"] == [{"tool": "grep", "query": "keep_days", "resultCount": 3, "truncated": False}]
    # Only paths that were actually read can be claimed as inspected / fallback reads.
    assert body["inspectedEntryPoints"] == ["src/retention.py"]
    assert body["directSourceFallbacks"] == [{"path": "src/retention.py", "reason": "graph had no node"}]
    assert body["knownGaps"] == ["dynamic dispatch not traced"]
    again = json.loads(tools["record_search_coverage"].invoke({}))
    assert again["code"] == "NO_SEARCH_ACTIVITY"  # the trace was consumed


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


def test_runner_reports_an_open_human_request_as_an_interrupt_not_a_failure(tmp_path) -> None:
    client = FakeClient(open_requests=["99999999-9999-4999-8999-999999999999"])
    model = RootScriptedModel(responses=[AIMessage(content="waiting")])
    result = run_assessment_root(
        client,
        ASSESSMENT,
        backend_factory=lambda claim, ctx: (FilesystemBackend(root_dir=_repo(tmp_path), virtual_mode=True), None),
        model=model,
        governance=(),
    )
    assert result["state"] == "INTERRUPTED" and ("finish", "INTERRUPTED") in client.calls


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


def test_boundary_skips_a_held_lease_and_a_stale_delivery_without_error() -> None:
    from types import SimpleNamespace

    from assessment_root.boundary import AssessmentRootBoundary

    for code in ("ASSESSMENT_EXECUTION_LEASE_HELD", "ASSESSMENT_NOT_ACTIVE"):
        def runner(client, assessment_id, **kwargs):  # noqa: ANN001
            raise AssessmentApiError(409, code)

        boundary = AssessmentRootBoundary(
            SimpleNamespace(nestjs_api_base_url="http://x", worker_api_key="k"), client=FakeClient(), runner=runner
        )
        assert boundary.handle({"assessmentId": ASSESSMENT}, "corr")["state"] == "SKIPPED"
