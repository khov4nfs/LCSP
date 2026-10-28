"""Drive the REAL Managed Deep Agent request path (DraftHistoryMiddleware included) with a model that sees only its own view.

The probe is deterministic and provider-free. It keeps its *plan* (what it intends to author) like an LLM keeps its
instructions, but every claim ID it uses and every correction it applies must be found in the messages the middleware
actually shows it. It is never handed IDs out of band.
"""
import json
import re
from pathlib import Path
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import Field

from middleware import usage_metering
from rule_set_preparation.agent import create_rule_set_preparation_agent
from test_rule_set_preparation_native_isolation_preparation import RuleSetPreparationScriptedModel

FIXTURE48 = Path(__file__).with_name("fixtures").joinpath("retained-authoring-memory-failure-7fefb641.json")
HEX = re.compile(r"[0-9a-f]{64}")

# requirement key -> (operative, applicability, qualifier, exception, context) claim-ID prefixes of the live-frozen inventory:
# 48 claims, 46 RELEVANT (00b8e0 and 8d3414 were intentionally excluded by the model and are outside the accounting denominator).
from semantic_pipeline_harness import authoring_fixture, authoring_plan
# Historical fixture remains immutable; current positive replay uses verified-closure-compatible source assertions.
PLAN48 = authoring_plan()



class ProbeFinished(BaseException):
    """The probe has nothing left to do; raising ends the run, because a tool-free reply would make the middleware loop forever."""


class ProbeBudgetExceeded(RuntimeError):
    """The probe kept acting without converging: the observable symptom of a reread loop."""


class ViewDrivenModel(RuleSetPreparationScriptedModel):
    """Model whose next action is a pure function of the messages the middleware chose to show it."""

    policy: Any = Field(default=None, repr=False)
    views: list[list[Any]] = Field(default_factory=list, repr=False)
    prompts: list[list[Any]] = Field(default_factory=list, repr=False)
    bound_tools: list[list[Any]] = Field(default_factory=list, repr=False)
    bound_tool_names: list[list[str]] = Field(default_factory=list, repr=False)

    def _generate(self, messages: list[Any], **kwargs: Any) -> ChatResult:
        self.views.append(list(messages))
        return ChatResult(generations=[ChatGeneration(message=self.policy(list(messages), self))])


def text_of(message: Any) -> str:
    content = message.content
    return content if isinstance(content, str) else "".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in content)


def visible_text(view: list[Any]) -> str:
    return "\n".join(text_of(m) for m in view if isinstance(m, (ToolMessage, HumanMessage)))


def find_ids(view: list[Any], prefixes: list[str]) -> dict[str, str]:
    text = visible_text(view)
    return {p: m.group(0) for p in prefixes if (m := re.search(re.escape(p) + r"[0-9a-f]{%d}" % (64 - len(p)), text))}


def view_chars(view: list[Any]) -> int:
    return sum(len(text_of(m)) for m in view)


def last_result(view: list[Any]) -> dict | None:
    tail = view[-1] if view else None
    if isinstance(tail, HumanMessage):  # the runtime-generated digest rides after the newest tool result
        tail = next((m for m in reversed(view) if isinstance(m, ToolMessage)), None)
    if not isinstance(tail, ToolMessage):
        return None
    try:
        return json.JSONDecoder().raw_decode(text_of(tail).lstrip())[0]
    except ValueError:
        return None


class Probe:
    """Common call bookkeeping."""

    def __init__(self, max_turns: int = 140):
        self.turns, self.max_turns, self.calls = 0, max_turns, []

    def emit(self, name: str, **args: Any) -> AIMessage:
        self.turns += 1
        if self.turns > self.max_turns:
            raise ProbeBudgetExceeded(f"{self.turns} model turns without converging; calls by tool: {self.tally()}")
        self.calls.append((name, args))
        return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": f"probe-{self.turns}"}])

    def tally(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for name, _ in self.calls:
            out[name] = out.get(name, 0) + 1
        return out


class NavigateAndAuthorProbe(Probe):
    """The live post-freeze path: start authoring, navigate the inventory, then author every planned Requirement and Rule."""

    def __init__(self, plan=PLAN48, pages: int = 3, page_size: int = 20, extra_reads: int = 2, stop_after: int | None = None, **kw):
        super().__init__(**kw)
        self.plan, self.pages, self.page_size, self.stop_after = plan, pages, page_size, stop_after
        self.queue = [("start_rule_authoring", {})] + [("get_claim_inventory", {"kind": "CLAIMS", "limit": page_size, "offset": i * page_size}) for i in range(pages)]
        self.queue += [("get_claim_inventory", {"kind": "UNACCOUNTED_CLAIMS", "limit": page_size}), ("get_claim_inventory", {"kind": "REQUIREMENTS", "limit": page_size})][:extra_reads]
        self.index, self.rule_index, self.rereads, self.cycle, self.awaiting, self.stage = 0, 0, 0, 0, None, "plan"
        self.first_author_view_missing: list[str] = []
        claims = authoring_fixture()["frozenInventory"]["graph"]["claims"]
        self.assessable = [p[0] for p in plan if all(next(c for c in claims if c["claimId"].startswith(prefix))["assessability"] not in {"EXTERNAL_FULFILLMENT", "NON_ASSESSABLE"} for prefix in p[1])]

    def __call__(self, view: list[Any], model: Any) -> AIMessage:
        result = last_result(view)
        if self.awaiting and result is not None:
            if result.get("outcome") == "PASSED" or result.get("preparationState"):
                if self.awaiting == "requirement":
                    self.index += 1
                elif self.awaiting == "rule":
                    self.rule_index += 1
                elif self.awaiting == "validate":
                    self.stage = "submit"
                elif self.awaiting == "submit":
                    self.stage = "done"
            elif self.awaiting == "validate":
                raise AssertionError(f"Rule validation failed: {json.dumps(result)[:800]}")
            self.awaiting = None
        if self.queue:
            name, args = self.queue.pop(0)
            return self.emit(name, **args)
        if self.stop_after is not None and self.index >= self.stop_after:
            raise ProbeFinished()
        if self.index < len(self.plan):
            key, op, app, qual, exc, ctx = self.plan[self.index]
            wanted = op + app + qual + exc + ctx
            ids = find_ids(view, wanted)
            if len(ids) < len(wanted):
                anchors = find_ids(view, op)
                if len(anchors) == len(op):
                    return self.emit("get_semantic_closure", operative_claim_ids=[anchors[p] for p in op])
                self.rereads += 1
                return self.emit("get_rule_authoring_context", offset=0, limit=100)
            self.awaiting = "requirement"
            pick = lambda prefixes: [ids[p] for p in prefixes]
            return self.emit("author_legal_requirement", requirement_key=key, title=key, operative_claim_ids=pick(op), applicability_claim_ids=pick(app),
                             qualifier_claim_ids=pick(qual), exception_claim_ids=pick(exc), context_claim_ids=pick(ctx))
        if self.rule_index < len(self.assessable):
            key = self.assessable[self.rule_index]
            self.awaiting = "rule"
            return self.emit("author_assessment_rule", assessment_rule_id=f"AR-{key}", concept=key, legal_requirement_ids=[key])
        if self.stage == "plan":
            self.awaiting = "validate"
            return self.emit("validate_compliance_rule_set")
        if self.stage == "submit":
            self.awaiting = "submit"
            return self.emit("submit_compliance_rule_set")
        raise ProbeFinished()


class RejectionRetentionProbe(Probe):
    """Makes one correctable mistake, does unrelated work, then retries: does it still know what it was told?"""

    def __init__(self, definition_prefix: str, operative_prefix: str, applicability_prefix: str, fillers: int = 5, **kw):
        super().__init__(**kw)
        self.prefixes = (definition_prefix, operative_prefix, applicability_prefix)
        self.fillers, self.stage, self.retry_was_corrected, self.attempts = fillers, "start", None, 0

    def __call__(self, view: list[Any], model: Any) -> AIMessage:
        definition, operative, applicability = self.prefixes
        ids = find_ids(view, list(self.prefixes))
        if self.stage == "start":
            self.stage = "read"
            return self.emit("start_rule_authoring")
        if self.stage == "read":
            if len(ids) < 3:
                return self.emit("get_claim_inventory", kind="CLAIMS", limit=20, offset=0 if self.calls[-1][0] == "start_rule_authoring" else 20 * (self.turns % 3))
            self.stage = "mistake"
        if self.stage == "mistake":
            self.stage = "fillers"
            self.attempts += 1
            return self.emit("author_legal_requirement", requirement_key="R-retry", title="t", operative_claim_ids=[ids[operative]],
                             applicability_claim_ids=[ids[applicability], ids[definition]])  # a DEFINITION offered as applicability
        if self.stage == "fillers":
            if self.fillers > 0:
                self.fillers -= 1
                return self.emit("get_claim_inventory", kind="CLAIMS", limit=20, offset=20 * (self.fillers % 3))
            self.stage = "retry"
        if self.stage == "retry":
            text = visible_text(view)
            knows = "context_claim_ids" in text and "CLAIM_REQUIREMENT_MISMATCH" in text
            self.retry_was_corrected = knows
            self.stage = "done"
            self.attempts += 1
            known = find_ids(view, list(self.prefixes))
            if knows:
                return self.emit("author_legal_requirement", requirement_key="R-retry", title="t", operative_claim_ids=[known[operative]],
                                 applicability_claim_ids=[known[applicability]], context_claim_ids=[known[definition]])
            return self.emit("author_legal_requirement", requirement_key="R-retry", title="t", operative_claim_ids=[known[operative]],
                             applicability_claim_ids=[known[applicability], known[definition]])
        raise ProbeFinished()


def run_agent(ctx: Any, probe: Probe, tmp_path: Path, monkeypatch: Any, prompt: str = "The claim inventory is frozen. Author the Rule Set and submit it.") -> ViewDrivenModel:
    model = ViewDrivenModel(policy=probe)
    original = usage_metering.assert_model_identity
    monkeypatch.setattr(usage_metering, "assert_model_identity", lambda m, response=None: None if isinstance(m, ViewDrivenModel) else original(m, response))
    graph = create_rule_set_preparation_agent(context=ctx, legal_source_root=tmp_path, model=model)
    try:
        graph.invoke({"messages": [{"role": "user", "content": prompt}]})
    except ProbeFinished:
        pass
    return model
