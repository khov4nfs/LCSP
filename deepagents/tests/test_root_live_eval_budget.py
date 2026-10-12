from types import SimpleNamespace

import pytest
from deepagents.backends import FilesystemBackend
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import InMemorySaver

from assessment_root.agent import create_assessment_root_agent
from assessment_root.runner import run_assessment_root
from assessment_root.tools import RootRun
from test_assessment_root_agent import ASSESSMENT, THREAD, EXECUTION, FakeClient, RootScriptedModel
from vertical.live_root import MAX_CALLS, MAX_INPUT_TOKENS, ReviewTrace


def test_live_eval_budget_and_authoritative_tool_output_capture():
    trace = ReviewTrace()
    for _ in range(MAX_CALLS):
        trace.on_chat_model_start({}, [])
    with pytest.raises(RuntimeError, match="model-call budget"):
        trace.on_chat_model_start({}, [])
    assert trace.attempted_calls == MAX_CALLS
    trace.on_tool_start({"name": "submit_final_report"}, "{}", run_id="report")
    trace.on_tool_end('{"ok":true,"artifactId":"server-minted"}', run_id="report")
    assert trace.tools[-1]["output"] == '{"ok":true,"artifactId":"server-minted"}'
    assert trace.tools[-1]["outputTruncated"] is False
    response = SimpleNamespace(generations=[[SimpleNamespace(message=SimpleNamespace(
        content="", tool_calls=[], usage_metadata={"input_tokens": MAX_INPUT_TOKENS + 1, "output_tokens": 1},
    ))]])
    trace = ReviewTrace()
    trace.on_chat_model_start({}, [])
    # A completed response must reach the graph, even if it crosses the threshold.
    trace.on_llm_end(response)
    assert trace.calls == 1 and trace.input_tokens == MAX_INPUT_TOKENS + 1
    with pytest.raises(RuntimeError, match="input-token budget"):
        trace.on_chat_model_start({}, [])
    assert trace.attempted_calls == 1


def test_native_root_terminal_response_is_not_failed_by_eval_budget(tmp_path):
    client = FakeClient()
    trace = ReviewTrace()
    result = run_assessment_root(
        client,
        ASSESSMENT,
        backend_factory=lambda claim, context: (FilesystemBackend(root_dir=tmp_path, virtual_mode=True), None),
        model=RootScriptedModel(responses=[AIMessage(
            content="Assessment complete.",
            usage_metadata={"input_tokens": MAX_INPUT_TOKENS + 1, "output_tokens": 1, "total_tokens": MAX_INPUT_TOKENS + 2},
        )]),
        governance=(),
        extra_callbacks=[trace],
    )
    assert result["state"] == "SUCCEEDED"
    assert trace.calls == 1 and trace.attempted_calls == 1
    assert trace.messages[-1]["content"] == "Assessment complete."


def test_budget_failure_resumes_native_pending_model_without_repeating_tool(tmp_path):
    (tmp_path / "notice.py").write_text("notice = True\n")
    client = FakeClient()
    saver = InMemorySaver()
    backend = FilesystemBackend(root_dir=tmp_path, virtual_mode=True)
    first = run_assessment_root(
        client, ASSESSMENT, backend_factory=lambda claim, context: (backend, None),
        model=RootScriptedModel(responses=[AIMessage(
            content="", tool_calls=[{"name": "cite_repository_source", "args": {"path": "notice.py", "start_line": 1, "end_line": 1}, "id": "cite"}],
            usage_metadata={"input_tokens": MAX_INPUT_TOKENS + 1, "output_tokens": 1, "total_tokens": MAX_INPUT_TOKENS + 2},
        )]),
        checkpointer=saver, governance=(), extra_callbacks=[ReviewTrace()],
    )
    assert first["state"] == "FAILED"
    second = run_assessment_root(
        client, ASSESSMENT, backend_factory=lambda claim, context: (backend, None),
        model=RootScriptedModel(responses=[AIMessage(content="Finished using accepted evidence.")]),
        checkpointer=saver, governance=(), extra_callbacks=[ReviewTrace()],
    )
    assert second["state"] == "SUCCEEDED" and second["threadId"] == first["threadId"]
    assert len([call for call in client.calls if call[0] == "evidence"]) == 1
    agent = create_assessment_root_agent(
        run=RootRun(client=client, assessment_id=ASSESSMENT, thread_id=THREAD, execution_id=EXECUTION, backend=backend),
        model=RootScriptedModel(responses=[]), checkpointer=saver, governance=(),
    )
    saved = agent.get_state({"configurable": {"thread_id": THREAD}})
    assert not saved.next
    assert sum(message.type == "human" for message in saved.values["messages"]) == 1
