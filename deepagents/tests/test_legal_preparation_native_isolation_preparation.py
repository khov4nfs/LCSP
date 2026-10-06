"""Offline native probe for the draft W2 Legal Preparation isolation surface."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from deepagents import (
    GeneralPurposeSubagentProfile,
    HarnessProfile,
    create_deep_agent,
    register_harness_profile,
)
from deepagents.backends import FilesystemBackend
from deepagents.middleware.filesystem import FilesystemMiddleware, FilesystemPermission
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from test_native_researcher_task_preparation import ScriptedModel


TESTS_DIR = Path(__file__).parent
ACCEPTED_DIR = TESTS_DIR / "fixtures" / "legal_portfolio_context"
PINNED_VERSION = "SYNTHETIC-CORPUS-V1"
FORBIDDEN_TOOL_ATTEMPTS = (
    ("write_file", {"file_path": "/mutated.txt", "content": "MUTATED"}),
    ("execute", {"command": "touch /mutated.txt"}),
    ("task", {"description": "research", "subagent_type": "repository-researcher"}),
    ("ask_human", {"question": "forbidden"}),
    ("submit_rule_decision", {"decision": "forbidden"}),
    ("write_shared_memory", {"content": "forbidden"}),
)


class LegalPreparationScriptedModel(ScriptedModel):
    """Reuse the existing provider-free model with a test-only harness profile."""

    model_name: str = "legal-preparation-native-probe"

    def _get_ls_params(self, **kwargs: Any) -> dict[str, str]:
        return {"ls_provider": self.model_name, "ls_model_type": "chat"}


def _load_pinned_source() -> tuple[dict[str, Any], bytes]:
    pins = json.loads((ACCEPTED_DIR / "pins.json").read_text(encoding="utf-8"))
    pin = next(source for source in pins["sources"] if source["corpusVersion"] == PINNED_VERSION)
    source_bytes = (ACCEPTED_DIR / pin["sourceFile"]).read_bytes()
    assert len(source_bytes) == pin["byteLength"]
    assert f"sha256:{hashlib.sha256(source_bytes).hexdigest()}" == pin["sourceSha256"]
    return pin, source_bytes


def _tool_call(name: str, args: dict[str, Any], call_id: str) -> AIMessage:
    return AIMessage(
        content="",
        tool_calls=[{"name": name, "args": args, "id": call_id}],
    )


def test_native_legal_preparation_reads_one_pinned_corpus_without_other_tools(
    tmp_path: Path,
) -> None:
    pin, source_bytes = _load_pinned_source()
    source_text = source_bytes.decode("utf-8")
    staged_source = tmp_path / pin["sourceFile"]
    staged_source.write_bytes(source_bytes)
    before = staged_source.read_bytes()

    request = (
        "Read only the pinned legal source and return source-grounded preparation context: "
        f"corpus={pin['corpusVersion']} document={pin['documentId']} "
        f"source_sha256={pin['sourceSha256']} path=/{pin['sourceFile']}"
    )
    responses = [
        _tool_call(
            "read_file",
            {"file_path": f"/{pin['sourceFile']}", "offset": 0, "limit": 2_000},
            "read-pinned-source",
        ),
        _tool_call(
            "read_file",
            {"file_path": "/synthetic-notice-v2.txt", "offset": 0, "limit": 100},
            "read-other-source",
        ),
        *(
            _tool_call(name, args, f"forbidden-{index}")
            for index, (name, args) in enumerate(FORBIDDEN_TOOL_ATTEMPTS)
        ),
        AIMessage(content="LEGAL_PREPARATION_PROBE_COMPLETE"),
    ]
    model = LegalPreparationScriptedModel(responses=list(responses))
    backend = FilesystemBackend(root_dir=tmp_path, virtual_mode=True)
    read_only_filesystem = FilesystemMiddleware(
        backend=backend,
        tools=["read_file"],
        _permissions=[
            FilesystemPermission(["read"], [f"/{pin['sourceFile']}"], mode="allow"),
            FilesystemPermission(["read"], ["/**"], mode="deny"),
            FilesystemPermission(["write"], ["/**"], mode="deny"),
        ],
    )
    register_harness_profile(
        model.model_name,
        HarnessProfile(
            general_purpose_subagent=GeneralPurposeSubagentProfile(enabled=False),
        ),
    )
    agent = create_deep_agent(
        model=model,
        backend=backend,
        system_prompt="LEGAL_PREPARATION_ONLY_SOURCE_GROUNDED_CONTEXT",
        tools=[],
        middleware=[read_only_filesystem],
        subagents=[],
    )

    result = agent.invoke({"messages": [{"role": "user", "content": request}]})

    assert result["messages"][-1].content == "LEGAL_PREPARATION_PROBE_COMPLETE"
    assert {
        name
        for bound in model.bound_tool_names
        for name in bound
    } == {"read_file"}
    initial_prompt = model.prompts[0]
    assert [type(message) for message in initial_prompt] == [SystemMessage, HumanMessage]
    assert [message.content for message in initial_prompt] == [
        "LEGAL_PREPARATION_ONLY_SOURCE_GROUNDED_CONTEXT",
        request,
    ]

    tool_messages: dict[str, ToolMessage] = {}
    for prompt in model.prompts:
        for message in prompt:
            if isinstance(message, ToolMessage):
                tool_messages[message.tool_call_id or message.id or message.name] = message

    pinned_read = tool_messages["read-pinned-source"]
    assert pinned_read.name == "read_file"
    assert pinned_read.status == "success"
    header, separator, native_text = str(pinned_read.content).partition("\n")
    assert header == "@@ lines 1-20 of 20 @@"
    assert separator
    assert native_text == source_text.rstrip("\r\n")

    other_read = tool_messages["read-other-source"]
    assert other_read.status == "error"
    assert "permission denied" in str(other_read.content)

    for index, (name, _) in enumerate(FORBIDDEN_TOOL_ATTEMPTS):
        rejected = tool_messages[f"forbidden-{index}"]
        assert rejected.name == name
        assert rejected.status == "error"
        assert "not a valid tool" in str(rejected.content)

    assert staged_source.read_bytes() == before
