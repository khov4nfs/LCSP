"""Offline capability probe for a read-only native Deep Agents researcher."""

from pathlib import Path

from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend
from deepagents.middleware.filesystem import FilesystemMiddleware, FilesystemPermission
from langchain_core.messages import AIMessage, ToolMessage

from test_native_researcher_task_preparation import (
    CHILD_RESULT,
    ScriptedModel,
    _task_call,
)


def test_native_researcher_read_only_surface_rejects_mutation_and_returns_read(
    tmp_path: Path,
) -> None:
    source = tmp_path / "source.txt"
    source.write_text("SYNTHETIC_READ_ONLY_SOURCE", encoding="utf-8")
    before = {path.relative_to(tmp_path): path.read_bytes() for path in tmp_path.rglob("*") if path.is_file()}
    backend = FilesystemBackend(root_dir=tmp_path, virtual_mode=True)
    read_only_filesystem = FilesystemMiddleware(
        backend=backend,
        tools=["ls", "read_file", "glob", "grep"],
        _permissions=[FilesystemPermission(["write"], ["/**"], mode="deny")],
    )
    parent = ScriptedModel(responses=[_task_call(), AIMessage(content="parent received researcher")])
    child = ScriptedModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "write_file",
                        "args": {"file_path": "/forbidden.txt", "content": "MUTATED"},
                        "id": "write-probe-1",
                    }
                ],
            ),
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "edit_file",
                        "args": {
                            "file_path": "/source.txt",
                            "old_string": "SYNTHETIC_READ_ONLY_SOURCE",
                            "new_string": "MUTATED",
                        },
                        "id": "edit-probe-1",
                    }
                ],
            ),
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "delete",
                        "args": {"file_path": "/source.txt"},
                        "id": "delete-probe-1",
                    }
                ],
            ),
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "execute",
                        "args": {"command": "touch /execute.txt"},
                        "id": "execute-probe-1",
                    }
                ],
            ),
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "read_file",
                        "args": {"file_path": "/source.txt", "offset": 0, "limit": 100},
                        "id": "read-probe-1",
                    }
                ],
            ),
            AIMessage(content=CHILD_RESULT),
        ]
    )
    agent = create_deep_agent(
        model=parent,
        backend=backend,
        permissions=[FilesystemPermission(["write"], ["/**"], mode="deny")],
        subagents=[
            {
                "name": "repository-researcher",
                "description": "Inspect one bounded synthetic source and return findings.",
                "model": child,
                "tools": [],
                "middleware": [read_only_filesystem],
                "permissions": [FilesystemPermission(["write"], ["/**"], mode="deny")],
                "system_prompt": "Use only the approved read tools and never mutate content.",
                "mode": "isolated",
            }
        ],
    )

    result = agent.invoke({"messages": [{"role": "user", "content": "start"}]})

    child_tools = {name for bound in child.bound_tool_names for name in bound}
    assert child_tools == {"ls", "read_file", "glob", "grep"}
    child_tool_messages = [
        message
        for prompt in child.prompts
        for message in prompt
        if isinstance(message, ToolMessage)
    ]
    rejected = {message.name: str(message.content) for message in child_tool_messages if message.name != "read_file"}
    assert set(rejected) == {"write_file", "edit_file", "delete", "execute"}
    assert all(message.status == "error" for message in child_tool_messages if message.name != "read_file")
    assert all("not a valid tool" in rejected[name] for name in rejected)
    read_results = [message for message in child_tool_messages if message.name == "read_file"]
    assert len(read_results) == 1
    assert "SYNTHETIC_READ_ONLY_SOURCE" in str(read_results[0].content)

    parent_tool_messages = [
        message for message in parent.prompts[1] if isinstance(message, ToolMessage)
    ]
    assert len(parent_tool_messages) == 1
    assert parent_tool_messages[0].content == CHILD_RESULT
    assert result["messages"][-1].content == "parent received researcher"
    after = {path.relative_to(tmp_path): path.read_bytes() for path in tmp_path.rglob("*") if path.is_file()}
    assert after == before


def test_native_permissions_are_not_a_backend_authorization_boundary(tmp_path: Path) -> None:
    backend = FilesystemBackend(root_dir=tmp_path, virtual_mode=True)
    FilesystemMiddleware(
        backend=backend,
        tools=["ls", "read_file", "glob", "grep"],
        _permissions=[FilesystemPermission(["write"], ["/**"], mode="deny")],
    )

    write_result = backend.write("/direct-backend-write.txt", "DIRECT_BACKEND_WRITE")

    assert write_result.error is None
    assert (tmp_path / "direct-backend-write.txt").read_text(encoding="utf-8") == "DIRECT_BACKEND_WRITE"
