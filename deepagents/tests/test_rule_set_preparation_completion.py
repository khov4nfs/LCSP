"""Native, provider-free regressions for the preparation terminal contract."""

from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

import pytest
from langchain_core.messages import AIMessage
from rule_set_preparation import runner
from rule_set_preparation.legal_source_files import INDEX_PATH
from rule_set_preparation.tools import RuleSetPreparationContext, build_rule_set_tools
from test_rule_set_preparation_agent import (
    DOC,
    RUN_ID,
    FakeApi,
    _call,
    _model,
    _packet,
    _tool_messages,
)
from test_rule_set_preparation_native_isolation_preparation import (
    RuleSetPreparationScriptedModel,
)


@pytest.fixture(autouse=True)
def _quiet_offline_diagnostics(monkeypatch) -> None:
    from middleware import usage_metering

    # Fake model repr contains the retained conversation; assertions inspect it instead.
    original_assert_model_identity = usage_metering.assert_model_identity
    monkeypatch.setattr(usage_metering, "logger", SimpleNamespace(
        info=lambda *a, **kw: None, warning=lambda *a, **kw: None,
        error=lambda *a, **kw: None, debug=lambda *a, **kw: None,
    ))
    monkeypatch.setattr(
        usage_metering,
        "assert_model_identity",
        lambda model, response=None: None
        if isinstance(model, RuleSetPreparationScriptedModel)
        else original_assert_model_identity(model, response),
    )


@pytest.mark.parametrize("normal_stops", [1, 4])
def test_premature_normal_stop_continues_same_preparation(tmp_path: Path, monkeypatch, normal_stops) -> None:
    packet = _packet()
    model = _model([
        _call("read_file", {"file_path": INDEX_PATH}, "index"),
        _call("read_file", {"file_path": f"/legal-source/{DOC}/art-1__cl-1.md"}, "provision"),
        *[AIMessage(content='[[tool_calls]] [{"name":"validate_compliance_rule_set"}]',
                    response_metadata={"finish_reason": "stop"}) for _ in range(normal_stops)],
        _call("validate_compliance_rule_set", {"packet": packet}, "validate"),
        _call("submit_compliance_rule_set", {"packet": packet}, "submit"),
        AIMessage(content="submitted"),
    ])
    materialized, contexts = [], []
    materialize, create = runner.materialize_legal_source, runner.create_rule_set_preparation_agent

    def record_materialize(bundle, root):
        materialized.append(root)
        return materialize(bundle, root)

    def record_create(**kwargs):
        contexts.append(kwargs["context"])
        return create(**kwargs)

    monkeypatch.setattr(runner, "materialize_legal_source", record_materialize)
    monkeypatch.setattr(runner, "create_rule_set_preparation_agent", record_create)
    api = FakeApi()
    result = runner.run_rule_set_preparation(api, RUN_ID, model=model, work_dir=tmp_path)

    assert result["state"] == "SUCCEEDED"
    assert api.names() == ["claim", "validate", "submit"]
    assert materialized == [tmp_path] and len(contexts) == 1
    assert contexts[0].submission == result["submission"]
    assert api.calls[-1][1] == (RUN_ID, contexts[0].idempotency_key, packet)
    continued = model.prompts[2 + normal_stops]
    assert any(getattr(m, "tool_call_id", None) == "index" for m in continued)
    assert any(getattr(m, "tool_call_id", None) == "provision" for m in continued)
    assert sum(isinstance(m, AIMessage) and "[[tool_calls]]" in m.content for m in continued) == normal_stops
    assert sum(t.get("event") == "NORMAL_STOP_BEFORE_TERMINAL" for t in contexts[0].trace) == normal_stops


def test_preparation_stream_trace_emits_redacted_meaningful_native_tool_activity(
    monkeypatch,
) -> None:
    emitted = []
    monkeypatch.setattr(
        runner,
        "publish_agent_stream_event",
        lambda event_type, **fields: emitted.append((event_type, fields)),
    )
    trace = runner.PreparationStreamTrace()
    trace.on_tool_start(
        {"name": "read_file"},
        "",
        run_id="read-1",
        inputs={
            "file_path": "/legal-source/134-2025-QH15/article-1.md",
            "content": "private source text must not be emitted",
        },
    )
    trace.on_tool_end(
        SimpleNamespace(content='{"outcome":"PASSED","content":"private"}'),
        run_id="read-1",
    )
    trace.on_tool_start(
        {"name": "task"},
        "",
        run_id="task-1",
        inputs={
            "subagent_type": "legal-source-reader",
            "description": "Analyze /legal-source/LAW-71-2025-QH15 only",
        },
    )
    trace.on_tool_start(
        {"name": "read_file"},
        "",
        run_id="reader-file-1",
        parent_run_id="task-1",
        inputs={"file_path": "/legal-source/LAW-71-2025-QH15/article-1.md"},
    )

    assert [event_type for event_type, _ in emitted] == [
        "SEMANTIC_TOOL_CALL",
        "TOOL_RESULT",
        "SEMANTIC_TOOL_CALL",
        "SEMANTIC_TOOL_CALL",
    ]
    assert emitted[0][1]["data"] == {
        "native_tool": "read_file",
        "scope": "/legal-source",
        "source_path": "/legal-source/134-2025-QH15/article-1.md",
    }
    assert emitted[1][1]["data"] == {
        "native_tool": "read_file",
        "outcome": "PASSED",
    }
    assert emitted[2][1]["data"] == {
        "native_tool": "task",
        "subagent_type": "legal-source-reader",
        "source_path": "/legal-source/LAW-71-2025-QH15",
    }
    assert emitted[3][1]["subagent_name"] == "legal-source-reader"
    assert emitted[3][1]["data"]["source_path"] == "/legal-source/LAW-71-2025-QH15/article-1.md"
    assert "private" not in repr(emitted)


def test_source_blocked_is_explicit_and_terminal(tmp_path: Path, monkeypatch) -> None:
    materialize = runner.materialize_legal_source

    def unreadable(bundle, root):
        result = materialize(bundle, root)
        (root / "legal-source" / "INDEX.md").unlink()
        return result

    monkeypatch.setattr(runner, "materialize_legal_source", unreadable)
    api = FakeApi()
    model = _model([
        _call("read_file", {"file_path": INDEX_PATH}, "missing-index"),
        _call("report_rule_set_source_blocked", {"reason": "SOURCE_UNREADABLE", "path": INDEX_PATH}, "blocked"),
    ])
    result = runner.run_rule_set_preparation(api, RUN_ID, model=model, work_dir=tmp_path)
    assert result["state"] == "FAILED" and result["failureReason"] == runner.NO_SUBMISSION
    assert api.names() == ["claim", "fail"]
    assert result["trace"][-1] == {"tool": "source_blocked", "reason": "SOURCE_UNREADABLE", "path": INDEX_PATH}
    assert len(model.prompts) == 2
    assert "not found" in _tool_messages(model)["missing-index"].content.lower()


def test_submission_ends_natively_without_another_provider_turn(tmp_path):
    model = _model([
        _call("validate_compliance_rule_set", {"packet": _packet()}, "validate"),
        _call("submit_compliance_rule_set", {"packet": _packet()}, "submit"),
    ])
    api = FakeApi()
    result = runner.run_rule_set_preparation(api, RUN_ID, model=model, work_dir=tmp_path)
    assert result["state"] == "SUCCEEDED"
    assert api.names() == ["claim", "validate", "submit"]
    assert len(model.prompts) == 2


def test_legal_source_root_and_descendants_are_readable_only(tmp_path: Path) -> None:
    (tmp_path / "outside.txt").write_text("OUTSIDE-PRIVATE")
    path = f"/legal-source/{DOC}"
    model = _model([
        _call("ls", {"path": "/legal-source"}, "ls"),
        _call("grep", {"pattern": "Records", "path": "/legal-source", "output_mode": "content"}, "grep-root"),
        _call("grep", {"pattern": "Records", "path": path, "output_mode": "content"}, "grep-nested"),
        _call("glob", {"pattern": "**/*.md", "path": "/legal-source"}, "glob"),
        _call("read_file", {"file_path": INDEX_PATH}, "index"),
        _call("read_file", {"file_path": f"{path}/art-1__cl-1.md"}, "chunk"),
        _call("grep", {"pattern": "OUTSIDE", "path": "/", "output_mode": "content"}, "outside-grep"),
        _call("read_file", {"file_path": "/outside.txt"}, "outside-read"),
        _call("write_file", {"file_path": "/legal-source/mutated.md", "content": "MUTATED"}, "write"),
        _call("validate_compliance_rule_set", {"packet": _packet()}, "validate"),
        _call("submit_compliance_rule_set", {"packet": _packet()}, "submit"),
        AIMessage(content="submitted"),
    ])
    result = runner.run_rule_set_preparation(FakeApi(), RUN_ID, model=model, work_dir=tmp_path)
    assert result["state"] == "SUCCEEDED"
    messages = _tool_messages(model)
    for call_id in ["ls", "glob", "index", "chunk", "grep-root", "grep-nested"]:
        assert "permission denied" not in messages[call_id].content
    for call_id in ["grep-root", "grep-nested", "chunk"]:
        assert "Records must be retained" in messages[call_id].content
    assert "INDEX.md" in messages["ls"].content and "art-1__cl-1.md" in messages["glob"].content
    for call_id in ["outside-grep", "outside-read"]:
        assert "OUTSIDE-PRIVATE" not in messages[call_id].content
        assert "permission denied" in messages[call_id].content
    assert "not a valid tool" in messages["write"].content
    assert not (tmp_path / "legal-source" / "mutated.md").exists()


@pytest.mark.parametrize("pattern", ["phải", "không được", "có trách nhiệm", "thông báo", "đăng ký"])
def test_exact_production_grep_calls_do_not_hit_permission_denial(tmp_path: Path, pattern: str) -> None:
    model = _model([
        _call("grep", {"pattern": pattern, "path": "/legal-source", "glob": "*.md",
                       "output_mode": "files_with_matches"}, "production-grep"),
        _call("validate_compliance_rule_set", {"packet": _packet()}, "validate"),
        _call("submit_compliance_rule_set", {"packet": _packet()}, "submit"),
        AIMessage(content="submitted"),
    ])
    result = runner.run_rule_set_preparation(FakeApi(), RUN_ID, model=model, work_dir=tmp_path)
    assert result["state"] == "SUCCEEDED"
    grep = _tool_messages(model)["production-grep"]
    assert grep.status != "error" and "permission denied" not in grep.content


@pytest.mark.parametrize("reason,path", [
    ("UNFINISHED_WORK", INDEX_PATH),
    ("SOURCE_UNREADABLE", "/outside.txt"),
    ("SOURCE_PINS_INCONSISTENT", "/legal-source/../outside.txt"),
])
def test_invalid_source_blocking_signal_does_not_end_preparation(tmp_path: Path, reason: str, path: str) -> None:
    model = _model([
        _call("report_rule_set_source_blocked", {"reason": reason, "path": path}, "invalid-block"),
        AIMessage(content="I could not read the source."),
        _call("validate_compliance_rule_set", {"packet": _packet()}, "validate"),
        _call("submit_compliance_rule_set", {"packet": _packet()}, "submit"),
        AIMessage(content="submitted"),
    ])
    api = FakeApi()
    result = runner.run_rule_set_preparation(api, RUN_ID, model=model, work_dir=tmp_path)
    assert result["state"] == "SUCCEEDED"
    assert api.names() == ["claim", "validate", "submit"]
    assert "error" in _tool_messages(model)["invalid-block"].content


def test_only_the_exact_passed_packet_can_be_submitted_once() -> None:
    api = FakeApi()
    context = RuleSetPreparationContext(RUN_ID, api)
    validate, submit, _ = build_rule_set_tools(context)
    packet = _packet()
    assert "error" in submit.invoke({"packet": packet})
    assert api.names() == []
    validate.invoke({"packet": packet})
    changed = deepcopy(packet)
    changed["legalRequirements"][0]["title"] = "Changed after validation"
    assert "error" in submit.invoke({"packet": changed})
    assert api.names() == ["validate"]
    submit.invoke({"packet": packet})
    assert "alreadySubmitted" in submit.invoke({"packet": packet})
    assert api.names() == ["validate", "submit"]
    assert api.calls[-1][1] == (RUN_ID, context.idempotency_key, packet)


def test_failed_revalidation_revokes_previous_packet_pass() -> None:
    class ChangedValidationApi(FakeApi):
        def validate_compliance_rule_set(self, run_id, packet):
            self.calls.append(("validate", (run_id, packet)))
            return {"outcome": "PASSED" if len(self.calls) == 1 else "FAILED", "failures": []}

    api = ChangedValidationApi()
    context = RuleSetPreparationContext(RUN_ID, api)
    validate, submit, _ = build_rule_set_tools(context)
    validate.invoke({"packet": _packet()})
    validate.invoke({"packet": _packet()})
    assert "error" in submit.invoke({"packet": _packet()})
    assert api.names() == ["validate", "validate"]
    assert context.submission is None


@pytest.mark.parametrize("source_blocked", [False, True])
def test_validation_failed_then_normal_stop_is_observable_and_not_terminal(tmp_path: Path, source_blocked: bool) -> None:
    class ValidationFeedbackApi(FakeApi):
        def validate_compliance_rule_set(self, run_id, packet):
            self.calls.append(("validate", (run_id, packet)))
            return {"outcome": "FAILED", "failures": [{"code": "SOURCE_REF_NOT_FOUND"}]} if len(self.calls) == 2 else {"outcome": "PASSED", "failures": []}

    api = ValidationFeedbackApi()
    model = _model([
        _call("validate_compliance_rule_set", {"packet": _packet()}, "invalid"),
        AIMessage(content="Validation failed."),
        *([_call("report_rule_set_source_blocked", {"reason": "SOURCE_PINS_INCONSISTENT", "path": INDEX_PATH}, "blocked")]
          if source_blocked else [
              _call("validate_compliance_rule_set", {"packet": _packet()}, "passed"),
              _call("submit_compliance_rule_set", {"packet": _packet()}, "submit"),
              AIMessage(content="submitted"),
          ]),
    ])
    contexts = []
    create = runner.create_rule_set_preparation_agent

    def record_create(**kwargs):
        contexts.append(kwargs["context"])
        return create(**kwargs)

    from unittest.mock import patch
    with patch.object(runner, "create_rule_set_preparation_agent", side_effect=record_create):
        result = runner.run_rule_set_preparation(api, RUN_ID, model=model, work_dir=tmp_path)
    continuation = next(t for t in contexts[0].trace if t.get("event") == "NORMAL_STOP_BEFORE_TERMINAL")
    assert continuation["validationCalls"] == 1
    assert continuation["validationOutcome"] == "FAILED"
    assert continuation["submissionAttempted"] is False
    if source_blocked:
        assert result["failureReason"] == runner.NO_SUBMISSION
        assert api.names() == ["claim", "validate", "fail"]
    else:
        assert result["state"] == "SUCCEEDED"
        assert api.names() == ["claim", "validate", "validate", "submit"]
