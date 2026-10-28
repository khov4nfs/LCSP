"""Drive the REAL Managed Deep Agent stack through scripted sequences of good and bad authoring tool calls.

The model is a pure function of the messages the middleware chose to show it. Each step is one model turn that emits one message
(a normal tool call, an unknown tool, or an unparseable one). Checks run when the step's result arrives, so they see exactly what
the next model request would contain, digest included.
"""
from dataclasses import dataclass, field
from typing import Any, Callable

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from orchestration.agent_stream import AgentStreamSession, activate_agent_stream

from authoring_memory_harness import FIXTURE48, PLAN48, Probe, ProbeFinished, last_result, run_agent, text_of, visible_text

__all__ = ["Step", "ScriptProbe", "run_script", "FIXTURE48", "PLAN48", "visible_text", "text_of", "claim_index", "digest_of", "BLOCK", "MARKER"]


MARKER = "RULE AUTHORING STATE"
BLOCK = "OUTSTANDING AUTHORING REJECTION"


def digest_of(view: list[Any]) -> str:
    """The runtime-generated authoring state message the model sees at the end of a request ('' when absent)."""
    return next((text_of(m) for m in reversed(view) if isinstance(m, HumanMessage) and text_of(m).startswith(MARKER)), "")


@dataclass
class Step:
    """One model turn. ``args`` may be a callable of the context (it runs when the step is emitted, never earlier)."""
    tool: str
    args: Any = field(default_factory=dict)
    check: Callable[..., None] | None = None  # check(ctx, result, view, tool_text) when this step's result arrives
    message: Callable[[Any], AIMessage] | None = None  # build a non-standard AIMessage (unknown tool, unparseable arguments)
    label: str = ""


class ScriptProbe(Probe):
    def __init__(self, ctx: Any, steps: list[Step], **kw):
        super().__init__(**kw)
        self.ctx, self.steps, self.index, self.pending = ctx, steps, 0, None
        self.results: list[dict | None] = []
        self.texts: list[str | None] = []
        self.views: list[list[Any]] = []

    def __call__(self, view: list[Any], model: Any) -> AIMessage:
        if self.pending is not None:
            step = self.pending
            tools = [m for m in view if isinstance(m, ToolMessage)]
            tool_text = text_of(tools[-1]) if tools else None
            result = last_result(view)
            self.results.append(result)
            self.texts.append(tool_text)
            self.views.append(list(view))
            if step.check is not None:
                step.check(self.ctx, result, view, tool_text)
            self.pending = None
        if self.index >= len(self.steps):
            raise ProbeFinished()
        step = self.steps[self.index]
        self.index += 1
        self.pending = step
        args = step.args(self.ctx) if callable(step.args) else step.args
        if step.message is not None:
            self.turns += 1
            self.calls.append((step.tool, args))
            return step.message(args)
        return self.emit(step.tool, **args)


def run_script(ctx: Any, steps: list[Step], tmp_path: Any, monkeypatch: Any, events: list | None = None, **kw) -> ScriptProbe:
    """Run the steps through the real agent. ``events`` receives every durable stream event the run published."""
    probe = ScriptProbe(ctx, steps, **kw)
    sink = events if events is not None else []
    session = AgentStreamSession(assessment_id=None, run_id="offline", correlation_id="offline", boundary_name="rule-set-preparation", emit_payload=sink.append,
                                 boundary_type="RULE_SET_PREPARATION", preparation_run_id="00000000-0000-4000-8000-000000000001")
    with activate_agent_stream(session):
        run_agent(ctx, probe, tmp_path, monkeypatch)
    return probe


def claim_index(fixture: dict) -> dict:
    claims = {c["claimId"]: c for c in fixture["frozenInventory"]["graph"]["claims"]}
    return claims
