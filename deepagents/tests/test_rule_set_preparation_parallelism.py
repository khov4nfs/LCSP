"""Provider-free regression for native document-level preparation parallelism."""

from __future__ import annotations

import hashlib
import json
import threading
from pathlib import Path
from typing import Any

import pytest
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from middleware import usage_metering
from pydantic import PrivateAttr
from rule_set_preparation.agent import create_rule_set_preparation_agent
from rule_set_preparation.legal_source_files import materialize_legal_source
from rule_set_preparation.tools import RuleSetPreparationContext
from test_rule_set_preparation_agent import _call
from test_rule_set_preparation_native_isolation_preparation import (
    RuleSetPreparationScriptedModel,
)

RUN_ID = "11111111-1111-4111-8111-111111111111"
LEGAL_SOURCE_ID = "22222222-2222-4222-8222-222222222222"
DOCUMENTS = ("134-2025-QH15", "LAW-71-2025-QH15")


def _sha(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode()).hexdigest()


def _bundle() -> dict[str, Any]:
    documents = []
    for document_id in DOCUMENTS:
        content = f"Operative provision from {document_id}."
        documents.append(
            {
                "documentId": document_id,
                "title": document_id,
                "sourceUrl": "https://example.invalid/source",
                "sourceSha256": _sha(document_id),
                "sourceEffectStatus": "IN_FORCE",
                "chunks": [
                    {
                        "chunkId": f"chunk-{document_id}",
                        "locator": "article-1::clause-1",
                        "content": content,
                        "contentSha256": _sha(content),
                        "legalStatus": "IN_FORCE",
                        "hierarchy": {"path": ["article-1", "clause-1"]},
                    }
                ],
            }
        )
    return {
        "preparationRunId": RUN_ID,
        "executionState": "RUNNING",
        "legalSourceVersionId": LEGAL_SOURCE_ID,
        "legalSourceVersion": "SYNTHETIC-TWO-DOCUMENT-V1",
        "documents": documents,
    }


class _Api:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def validate_compliance_rule_set(
        self, run_id: str, packet: dict[str, Any]
    ) -> dict[str, Any]:
        self.calls.append("validate")
        return {"outcome": "PASSED", "failures": []}

    def submit_compliance_rule_set(
        self, run_id: str, key: str, packet: dict[str, Any]
    ) -> dict[str, Any]:
        self.calls.append("submit")
        return {
            "preparationRunId": run_id,
            "lifecycleState": "ACTIVE",
            "validation": {"outcome": "PASSED"},
        }


class _ParallelPreparationModel(RuleSetPreparationScriptedModel):
    """One fake model drives both parent and child graphs without a provider."""

    _document_barrier: threading.Barrier = PrivateAttr(
        default_factory=lambda: threading.Barrier(2)
    )
    _lock: threading.Lock = PrivateAttr(default_factory=threading.Lock)
    _parent_prompts: list[list[Any]] = PrivateAttr(default_factory=list)
    _child_prompts: list[list[Any]] = PrivateAttr(default_factory=list)

    @property
    def parent_prompts(self) -> list[list[Any]]:
        return self._parent_prompts

    @property
    def child_prompts(self) -> list[list[Any]]:
        return self._child_prompts

    def _generate(self, messages: list[Any], **kwargs: Any) -> ChatResult:
        prompt = list(messages)
        system_prompt = str(getattr(prompt[0], "content", "")) if prompt else ""
        if "read-only legal-source-reader subagent" in system_prompt:
            with self._lock:
                self._child_prompts.append(prompt)
            self._document_barrier.wait(timeout=5)
            description = str(getattr(prompt[-1], "content", ""))
            document_id = next(
                document for document in DOCUMENTS if document in description
            )
            content = f"Operative provision from {document_id}."
            result = {
                "documentId": document_id,
                "findings": [
                    {
                        "statement": content,
                        "sourceRefs": [
                            {
                                "documentId": document_id,
                                "locator": "article-1::clause-1",
                                "contentSha256": _sha(content),
                            }
                        ],
                    }
                ],
                "gaps": [],
            }
            return ChatResult(
                generations=[
                    ChatGeneration(message=AIMessage(content=json.dumps(result)))
                ]
            )

        with self._lock:
            self._parent_prompts.append(prompt)
            response = self.responses.pop(0)
        return ChatResult(generations=[ChatGeneration(message=response)])


@pytest.fixture(autouse=True)
def _allow_provider_free_model(monkeypatch: pytest.MonkeyPatch) -> None:
    original = usage_metering.assert_model_identity
    monkeypatch.setattr(
        usage_metering,
        "assert_model_identity",
        lambda model, response=None: (
            None
            if isinstance(model, _ParallelPreparationModel)
            else original(model, response)
        ),
    )


def test_two_document_tasks_run_natively_in_parallel_and_parent_synthesizes(
    tmp_path: Path,
) -> None:
    materialize_legal_source(_bundle(), tmp_path)
    packet = {"legalRequirements": [], "assessmentRules": [], "contextRelations": []}
    model = _ParallelPreparationModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "task",
                        "args": {
                            "description": "Read document 134-2025-QH15 only at /legal-source/134-2025-QH15.",
                            "subagent_type": "legal-source-reader",
                        },
                        "id": "read-134",
                    },
                    {
                        "name": "task",
                        "args": {
                            "description": "Read document LAW-71-2025-QH15 only at /legal-source/LAW-71-2025-QH15.",
                            "subagent_type": "legal-source-reader",
                        },
                        "id": "read-71",
                    },
                ],
            ),
            _call("validate_compliance_rule_set", {"packet": packet}, "validate"),
            _call("submit_compliance_rule_set", {"packet": packet}, "submit"),
        ]
    )
    api = _Api()

    result = create_rule_set_preparation_agent(
        context=RuleSetPreparationContext(RUN_ID, api),
        legal_source_root=tmp_path,
        model=model,
    ).invoke({"messages": [{"role": "user", "content": "prepare"}]})

    assert len(model.child_prompts) == 2
    assert {
        next(document for document in DOCUMENTS if document in str(prompt[-1].content))
        for prompt in model.child_prompts
    } == set(DOCUMENTS)
    assert all(
        "/legal-source/" in str(prompt[-1].content) for prompt in model.child_prompts
    )
    assert len(model.parent_prompts) == 3
    assert api.calls == ["validate", "submit"]
    assert (
        len(
            [
                message
                for message in result["messages"]
                if isinstance(message, ToolMessage)
                and message.name == "submit_compliance_rule_set"
            ]
        )
        == 1
    )

    child_tool_sets = [
        set(names)
        for names in model.bound_tool_names
        if "LegalSourceReaderResult" in names
    ]
    assert child_tool_sets
    assert all(
        {"ls", "glob", "grep", "read_file", "LegalSourceReaderResult"} <= names
        for names in child_tool_sets
    )
    assert all(
        "validate_compliance_rule_set" not in names
        and "submit_compliance_rule_set" not in names
        for names in child_tool_sets
    )
    parent_tool_sets = [
        set(names)
        for names in model.bound_tool_names
        if "validate_compliance_rule_set" in names
    ]
    assert parent_tool_sets and all(
        {"task", "validate_compliance_rule_set", "submit_compliance_rule_set"} <= names
        for names in parent_tool_sets
    )

    task_results = [
        message
        for message in model.parent_prompts[1]
        if isinstance(message, ToolMessage)
        and message.tool_call_id in {"read-134", "read-71"}
    ]
    assert len(task_results) == 2
    refs = {
        (ref["documentId"], ref["locator"], ref["contentSha256"])
        for message in task_results
        for finding in json.loads(str(message.content))["findings"]
        for ref in finding["sourceRefs"]
    }
    assert refs == {
        (document, "article-1::clause-1", _sha(f"Operative provision from {document}."))
        for document in DOCUMENTS
    }
