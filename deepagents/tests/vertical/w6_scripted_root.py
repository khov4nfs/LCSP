"""Drive the REAL Assessment Root graph, tools, HTTP client and API with a scripted model.

Used by tests/w6-cutover-rehearsal.mjs to execute ONE explicitly started canary of a migrated
assessment. Only the model is scripted (no provider is ever called); the Deep Agents graph, the
governed tools, the HTTP client, the API, PostgreSQL and a REAL LangGraph PostgresSaver checkpointer
are real. The script is portfolio-agnostic: it learns the rule ids from the assessment's own
server-owned coverage and decides every rule NOT_APPLICABLE from one evidence-cited fact, so it
works on any migrated assessment whatever its pinned portfolio contains.

usage: w6_scripted_root.py <apiBase> <workerKey> <assessmentId> <repoDir> <checkpointDatabaseUrl>
"""

from __future__ import annotations

import json
import sys
from typing import Any, Callable

from deepagents.backends import FilesystemBackend
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.checkpoint.postgres import PostgresSaver

from assessment_root.client import AssessmentRuntimeClient
from assessment_root.runner import run_assessment_root
from test_native_researcher_task_preparation import ScriptedModel

Step = Callable[[list[Any]], AIMessage]

# One entry per model turn: lets a failed rehearsal be diagnosed from its own output.
TRACE: list[dict[str, Any]] = []
# The scripted turns. Module-level on purpose: the chat model copies its own pydantic fields, and the
# script must be able to append the per-rule turns once the Root has learned its rules.
PLAN: list[Any] = []


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
    """Each turn is a function of the conversation so far; turns are taken from the module-level PLAN."""

    model_name: str = "w6-rehearsal-scripted-root"

    def _get_ls_params(self, **kwargs: Any) -> dict[str, str]:
        return {"ls_provider": self.model_name, "ls_model_type": "chat"}

    def _generate(self, messages, **kwargs):  # noqa: ANN001
        from langchain_core.outputs import ChatGeneration, ChatResult

        self.prompts.append(list(messages))
        last = (_tool_results(messages) or [{}])[-1]
        turn = {"turn": len(self.prompts), "lastToolResult": {k: last.get(k) for k in ("ok", "code", "failures", "raw") if k in last}}
        TRACE.append(turn)
        if not PLAN:
            turn["error"] = "no scripted step left for this model turn"
            raise AssertionError("scripted Root received an unexpected model turn")
        step = PLAN.pop(0)
        try:
            message = step(messages)
        except Exception as error:  # noqa: BLE001 - recorded, then re-raised
            turn["error"] = f"{type(error).__name__}: {error}"
            raise
        turn["call"] = [c["name"] for c in (message.tool_calls or [])] or "final-text"
        return ChatResult(generations=[ChatGeneration(message=message)])


def script(captured: dict[str, Any]) -> None:
    """Fills PLAN. The per-rule turns are appended once the Root has learned its rules."""
    steps = PLAN
    ev: dict[str, str] = {}
    fact: dict[str, str] = {}
    per_rule: list[Step] = []

    def last(messages: list[Any]) -> dict[str, Any]:
        return _tool_results(messages)[-1]

    def investigate(rule: str, key: str) -> Step:
        return lambda m: _call("start_rule_investigation", {"engineering_rule_id": rule}, key)

    def decide(rule: str, key: str) -> Step:
        def step(messages: list[Any]) -> AIMessage:
            return _call(
                "submit_rule_decision",
                {
                    "engineering_rule_id": rule,
                    "applicability": "NOT_APPLICABLE",
                    "rationale": f"{rule} is context for this rehearsal, not an assessable duty here.",
                    # The rehearsal portfolio links ER-n to LR-n.
                    "legal_context_ids": ["LR-" + rule.split("-", 1)[1]],
                    "references": [{"type": "CONFIRMED_FACT", "id": fact["use_case"]}],
                },
                key,
            )

        return step

    def learn_rules(messages: list[Any]) -> AIMessage:
        # The Root learns its rules from server state, never from a hard-coded list.
        context = last(messages)
        captured["context"] = context
        for index, row in enumerate(context["coverage"]):
            rule = row["engineeringRuleId"]
            per_rule.extend([investigate(rule, f"i{index}"), decide(rule, f"d{index}")])
        per_rule.append(lambda m: AIMessage(content="Every rule of the pinned portfolio is decided."))
        steps.extend(per_rule[1:])  # everything after the step after_fact runs itself
        return _call("cite_repository_source", {"path": "src/retention.py", "start_line": 3, "end_line": 3}, "s2")

    def after_cite(messages: list[Any]) -> AIMessage:
        ev["source"] = last(messages)["evidenceId"]
        captured["evidence"] = last(messages)
        return _call(
            "accept_case_fact",
            {
                "kind": "USE_CASE",
                "statement": "The system stores notices with a receipt timestamp.",
                "evidence_ids": [ev["source"]],
            },
            "s3",
        )

    def after_fact(messages: list[Any]) -> AIMessage:
        fact["use_case"] = last(messages)["factId"]
        captured["fact"] = last(messages)
        return per_rule[0](messages)

    steps.extend(
        [
            lambda m: _call("get_assessment_context", {}, "s1"),
            learn_rules,
            after_cite,
            after_fact,
        ]
    )


def main() -> int:
    base, key, assessment_id, repo_dir, checkpoint_url = sys.argv[1:6]
    captured: dict[str, Any] = {}
    script(captured)
    model = DynamicScriptedModel(responses=[])
    client = AssessmentRuntimeClient(base, key)
    with PostgresSaver.from_conn_string(checkpoint_url) as checkpointer:
        checkpointer.setup()
        result = run_assessment_root(
            client,
            assessment_id,
            backend_factory=lambda claim, context: (FilesystemBackend(root_dir=repo_dir, virtual_mode=True), None),
            model=model,
            checkpointer=checkpointer,
            governance=(),
        )
    print(json.dumps({"result": result, "captured": captured, "remainingSteps": len(PLAN), "trace": TRACE}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
