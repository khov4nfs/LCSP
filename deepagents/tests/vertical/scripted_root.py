"""Drive the REAL Assessment Root graph, tools, HTTP client and API with a scripted model.

Used by tests/assessment-domain-vertical.mjs. Only the model is scripted (each step is a function
of the previous tool result, because evidence/fact IDs are server-minted); the Deep Agents graph,
native task() delegation, governed tools, WorkerApiClient-style HTTP, API and PostgreSQL are real.

usage: scripted_root.py <apiBase> <workerKey> <assessmentId> <repoDir> <mode>
modes: full | resume
"""

from __future__ import annotations

import json
import sys
from typing import Any, Callable

from deepagents.backends import FilesystemBackend
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver

from assessment_root.client import AssessmentRuntimeClient
from assessment_root.researcher import RESEARCHER_NAME
from assessment_root.runner import run_assessment_root
from test_native_researcher_task_preparation import ScriptedModel

Step = Callable[[list[Any]], AIMessage]


def _tool_results(messages: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for message in messages:
        if isinstance(message, ToolMessage):
            try:
                out.append(json.loads(message.content))
            except (ValueError, TypeError):
                out.append({"raw": str(message.content)})
    return out


def _call(name: str, args: dict[str, Any], call_id: str) -> AIMessage:
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": call_id}])


class DynamicScriptedModel(ScriptedModel):
    """Each queued step is a function of the conversation so far."""

    steps: list[Any] = []
    model_name: str = "assessment-root-vertical"

    def _get_ls_params(self, **kwargs: Any) -> dict[str, str]:
        return {"ls_provider": self.model_name, "ls_model_type": "chat"}

    def _generate(self, messages, **kwargs):  # noqa: ANN001
        from langchain_core.outputs import ChatGeneration, ChatResult

        self.prompts.append(list(messages))
        if not self.steps:
            raise AssertionError("scripted Root received an unexpected model turn")
        step = self.steps.pop(0)
        return ChatResult(generations=[ChatGeneration(message=step(messages))])


def full_script(captured: dict[str, Any]) -> list[Step]:
    def last(messages: list[Any]) -> dict[str, Any]:
        return _tool_results(messages)[-1]

    def keep(key: str, messages: list[Any]) -> dict[str, Any]:
        value = last(messages)
        captured[key] = value
        return value

    def cite_args(path: str, start: int, end: int) -> dict[str, Any]:
        return {"path": path, "start_line": start, "end_line": end}

    ev: dict[str, str] = {}
    fact: dict[str, str] = {}

    def decide(rule: str, *, applicable: bool, outcome: str | None, key: str) -> Step:
        def step(messages: list[Any]) -> AIMessage:
            if applicable:
                refs = [{"type": "ASSESSMENT_EVIDENCE", "id": ev["source"]}]
                args = {
                    "engineering_rule_id": rule,
                    "applicability": "APPLICABLE",
                    "rationale": f"{rule} applies to the notice service.",
                    "legal_context_ids": [{"ER-RET": "LR-RET", "ER-XREF": "LR-XREF"}[rule]],
                    "references": refs,
                    "criteria": [
                        {"criterion_id": "C-1", "outcome": outcome, "rationale": "Based on the cited source.", "references": refs}
                    ],
                    "compliance": "COMPLIANT" if outcome == "MET" else "NON_COMPLIANT",
                }
            else:
                args = {
                    "engineering_rule_id": rule,
                    "applicability": "NOT_APPLICABLE",
                    "rationale": "The definition is context, not an assessable duty here.",
                    "legal_context_ids": ["LR-DEF"],
                    "references": [{"type": "CONFIRMED_FACT", "id": fact["use_case"]}],
                }
            return _call("submit_rule_decision", args, key)

        return step

    steps: list[Step] = [
        lambda m: _call("get_assessment_context", {}, "s1"),
        lambda m: (keep("context", m), _call("get_pinned_portfolio", {}, "s2"))[1],
        lambda m: (keep("portfolio", m), _call("grep", {"pattern": "keep_days", "path": "/"}, "s3"))[1],
        lambda m: _call("cite_repository_source", cite_args("src/retention.py", 3, 3), "s4"),
        lambda m: (
            ev.__setitem__("source", keep("evidence", m)["evidenceId"]),
            _call("task", {"description": "Where is keep_days configured?", "subagent_type": RESEARCHER_NAME}, "s5"),
        )[1],
        # (researcher answers here: one model turn consumed by the child graph)
        lambda m: AIMessage(content="Findings: src/retention.py:3 sets keep_days. No other uses found."),
        lambda m: _call("record_search_coverage", {"known_gaps": ["dynamic configuration not traced"]}, "s6"),
        lambda m: (keep("coverage", m), _call("accept_case_fact", {"kind": "USE_CASE", "statement": "The system stores notices with a receipt timestamp.", "evidence_ids": [ev["source"]]}, "s7"))[1],
        lambda m: (fact.__setitem__("use_case", keep("fact", m)["factId"]), _call("start_rule_investigation", {"engineering_rule_id": "ER-RET"}, "s8"))[1],
        # A deliberately incomplete first attempt: the validator must reject it and say why.
        lambda m: _call(
            "submit_rule_decision",
            {
                "engineering_rule_id": "ER-RET",
                "applicability": "APPLICABLE",
                "rationale": "Applies.",
                "legal_context_ids": ["LR-NOT-LINKED"],
                "references": [{"type": "ASSESSMENT_EVIDENCE", "id": ev["source"]}],
                "criteria": [
                    {
                        "criterion_id": "C-9",
                        "outcome": "MET",
                        "rationale": "Wrong criterion.",
                        "references": [{"type": "ASSESSMENT_EVIDENCE", "id": ev["source"]}],
                    }
                ],
                "compliance": "COMPLIANT",
            },
            "s9",
        ),
        lambda m: (captured.__setitem__("rejected", last(m)), decide("ER-RET", applicable=True, outcome="MET", key="s10")(m))[1],
        lambda m: (captured.__setitem__("decision_ret", last(m)), _call("start_rule_investigation", {"engineering_rule_id": "ER-XREF"}, "s11"))[1],
        decide("ER-XREF", applicable=True, outcome="NOT_MET", key="s12"),
        lambda m: (captured.__setitem__("decision_xref", last(m)), _call("start_rule_investigation", {"engineering_rule_id": "ER-DEF"}, "s13"))[1],
        decide("ER-DEF", applicable=False, outcome=None, key="s14"),
        lambda m: (captured.__setitem__("decision_def", last(m)), AIMessage(content="All three rules decided."))[1],
    ]
    return steps


def resume_script(captured: dict[str, Any]) -> list[Step]:
    return [
        lambda m: _call("get_assessment_context", {}, "r1"),
        lambda m: (captured.__setitem__("context", _tool_results(m)[-1]), AIMessage(content="Context reloaded after restart."))[1],
    ]


def main() -> int:
    base, key, assessment_id, repo_dir, mode = sys.argv[1:6]
    captured: dict[str, Any] = {}
    steps = full_script(captured) if mode == "full" else resume_script(captured)
    model = DynamicScriptedModel(responses=[], steps=steps)
    client = AssessmentRuntimeClient(base, key)
    result = run_assessment_root(
        client,
        assessment_id,
        backend_factory=lambda claim, context: (FilesystemBackend(root_dir=repo_dir, virtual_mode=True), None),
        model=model,
        # A fresh in-memory checkpointer per process models a restart: only server state survives.
        checkpointer=InMemorySaver(),
        governance=(),
    )
    print(json.dumps({"result": result, "captured": captured, "remainingSteps": len(model.steps)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
