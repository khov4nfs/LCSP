"""Drive the REAL Assessment Root graph, tools, HTTP client and API with a scripted model.

Used by tests/assessment-domain-vertical.mjs. Only the model is scripted (each step is a function
of the previous tool result, because evidence/fact IDs are server-minted); the Deep Agents graph,
native task() delegation, governed tools, WorkerApiClient-style HTTP, API and PostgreSQL are real.

usage: scripted_root.py <apiBase> <workerKey> <assessmentId> <repoDir> <mode>
modes: full | complete | selected | resume
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from collections.abc import Generator
from typing import Any, Callable

from deepagents.backends import FilesystemBackend
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.checkpoint.postgres import PostgresSaver

import assessment_root.runner as assessment_root_runner
from assessment_root.client import AssessmentRuntimeClient
from assessment_root.researcher import RESEARCHER_NAME
from assessment_root.runner import run_assessment_root
from test_native_researcher_task_preparation import ScriptedModel

Step = Callable[[list[Any]], AIMessage | None]


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


class BoundedReadStep:
    """Keep one scripted read active until every governed continuation is consumed."""

    def __init__(self, protocol: Generator, label: str, captured: dict[str, Any]) -> None:
        self.protocol = protocol
        self.label = label
        self.captured = captured
        self.pending: dict[str, Any] | None = None
        self.sequence = 0

    def __call__(self, messages: list[Any]) -> AIMessage | None:
        """Business purpose: Drive bounded reads through actual native tool turns.
        Business rules:
        - Consume only the reply matching this step's emitted call identity, name and arguments.
        - Rejected reads and missing replies fail the fixture rather than inventing complete data.
        Execution flow:
        1. Match and decode the pending native reply, if any.
        2. Advance the read protocol or finish when its complete value is assembled.
        3. Emit the next governed tool call and retain its identity.
        Failure cases:
        - Missing, mismatched or rejected replies raise AssertionError.
        Side effects:
        - Updates scripted read state and test receipts; invokes no API outside the native graph.
        """
        result = None
        if self.pending is not None:
            call = self.pending
            emitted = next((
                item for message in reversed(messages) if isinstance(message, AIMessage)
                for item in message.tool_calls if item["id"] == call["id"]
            ), None)
            assert emitted is not None and all(emitted[key] == call[key] for key in ("id", "name", "args"))
            reply = next((
                message for message in reversed(messages)
                if isinstance(message, ToolMessage) and message.tool_call_id == call["id"]
            ), None)
            assert reply is not None and reply.name == call["name"] and reply.status != "error"
            result = json.loads(reply.content)
            assert result["ok"] is True, result
            self.captured.setdefault("boundedReads", []).append({
                "tool": call["name"], "callId": call["id"], "arguments": call["args"],
                "replyBytes": len(reply.content.encode("utf-8")),
                "detailKind": result.get("detail", {}).get("kind"),
            })
        try:
            name, arguments = next(self.protocol) if self.pending is None else self.protocol.send(result)
        except StopIteration:
            return None
        self.sequence += 1
        self.pending = {"name": name, "args": arguments, "id": f"{self.label}-{self.sequence}"}
        return _call(name, arguments, self.pending["id"])


def _detail_value(
    rule_id: str, overview: dict[str, Any], pointer: str, *, max_items: int = 10, max_chars: int = 2000,
) -> Generator:
    """Business purpose: Reconstruct a complete selected legal value from bounded replies.
    Business rules:
    - Every page retains the overview's rule/version/pin/token identity.
    - Indexes are navigation only; fragments require complete length and digest verification.
    Execution flow:
    1. Read the selected pointer and follow its exact continuation offsets.
    2. Recursively read indexed children or concatenate all text/JSON fragments.
    3. Return the complete value only after counts, identity and integrity agree.
    Failure cases:
    - Changed identities, malformed indexes, duplicate children or incomplete fragments fail the fixture.
    Side effects:
    - Yields native read requests and assembles observed values in test memory only.
    """
    offset, collected = 0, []
    first_view = None
    while True:
        reply = yield "get_assessment_rule_detail", {
            "assessment_rule_id": rule_id, "detail_token": overview["detailToken"],
            "pointer": pointer, "offset": offset, "max_items": max_items, "max_chars": max_chars,
        }
        assert reply["detailRequired"] is True and reply["detailTool"] == "get_assessment_rule_detail"
        for key in ("assessmentRuleId", "assessmentRuleVersion", "ruleSetVersionId", "detailToken"):
            assert reply[key] == overview[key]
        view = reply["detail"]
        assert view["pointer"] == pointer
        if view["kind"] == "VALUE":
            assert offset == 0 and first_view is None
            return view["value"]
        first_view = first_view or view
        assert view["kind"] == first_view["kind"] and view["offset"] == offset
        if view["kind"] in {"TEXT_FRAGMENT", "JSON_FRAGMENT"}:
            assert view["offsetUnit"] == "UNICODE_CODE_POINTS"
            assert all(view[key] == first_view[key] for key in ("totalCharacters", "sha256"))
            collected.append(view["text"])
            end = offset + len(view["text"])
            if view["nextOffset"] is None:
                text = "".join(collected)
                assert end == view["totalCharacters"] == len(text)
                assert hashlib.sha256(text.encode("utf-8")).hexdigest() == view["sha256"]
                return text if view["kind"] == "TEXT_FRAGMENT" else json.loads(text)
            assert view["text"] and view["nextOffset"] == end < view["totalCharacters"]
        else:
            assert view["kind"] in {"OBJECT_INDEX", "ARRAY_INDEX"} and view["offsetUnit"] == "ENTRIES"
            assert view["totalEntries"] == first_view["totalEntries"]
            for entry in view["entries"]:
                key = entry["key"] if view["kind"] == "OBJECT_INDEX" else entry["index"]
                assert entry["pointer"] == pointer + "/" + str(key).replace("~", "~0").replace("/", "~1")
                child = yield from _detail_value(
                    rule_id, overview, entry["pointer"], max_items=max_items, max_chars=max_chars,
                )
                collected.append((key, child))
            end = offset + len(view["entries"])
            if view["nextOffset"] is None:
                assert end == view["totalEntries"] == len(collected)
                if view["kind"] == "OBJECT_INDEX":
                    assert len({key for key, _ in collected}) == len(collected)
                    return dict(collected)
                assert [key for key, _ in collected] == list(range(len(collected)))
                return [value for _, value in collected]
            assert view["entries"] and view["nextOffset"] == end < view["totalEntries"]
        offset = view["nextOffset"]


def _rule_value(captured: dict[str, Any], rule_id: str, pointer: str, *, version: str | None = None) -> Generator:
    """Business purpose: Read one complete legal field without assuming a full-rule reply.
    Business rules:
    - The field belongs to the current authorized rule and pinned Rule Set.
    - A bounded overview is followed through its token; it never substitutes for the selected value.
    Execution flow:
    1. Read the rule overview and verify its identity against captured server context.
    2. Resolve the complete field from a full reply or governed detail navigation.
    Failure cases:
    - Unauthorized identifiers, changed versions or malformed pointers fail the fixture.
    Side effects:
    - Yields native reads only; does not call the API or production internals directly.
    """
    audit = captured["context"].get("auditRequest")
    assert audit is None or rule_id in audit["selectedRuleIds"]
    overview = yield "get_assessment_rule", {"assessment_rule_id": rule_id}
    if overview.get("detailRequired"):
        assert overview["assessmentRuleId"] == rule_id
        assert overview["ruleSetVersionId"] == captured["context"]["pins"]["ruleSetVersionId"]
        assert version is None or overview["assessmentRuleVersion"] == version
        return (yield from _detail_value(rule_id, overview, pointer))
    assert overview["assessmentRule"]["assessmentRuleId"] == rule_id
    assert version is None or overview["assessmentRule"]["assessmentRuleVersion"] == version
    value = overview
    for escaped in pointer.split("/")[1:]:
        key = escaped.replace("~1", "/").replace("~0", "~")
        value = value[int(key)] if isinstance(value, list) else value[key]
    return value


def _catalog_read(captured: dict[str, Any]) -> Generator:
    """Business purpose: Discover the complete authorized catalog through actual pages.
    Business rules:
    - The selected audit owns membership; pinned rule count does not expand it.
    - Missing summary criteria are read through the rule's detail link.
    Execution flow:
    1. Read fresh context, then request one catalog row per page to exercise continuation.
    2. Verify stable catalog identity and hydrate any explicitly deferred criterion IDs.
    3. Publish the assembled test catalog after every authorized row is observed.
    Failure cases:
    - Changed totals, duplicate or unauthorized rows and non-progressing offsets fail the fixture.
    Side effects:
    - Stores model-observed pages and their assembled test projection only.
    """
    captured["context"] = yield "get_assessment_context", {}
    rows, pages, offset = [], [], 0
    while True:
        page = yield "get_pinned_rule_set", {"offset": offset, "limit": 1}
        assert page["ruleSetVersionId"] == captured["context"]["pins"]["ruleSetVersionId"]
        assert page["assessmentRuleCount"] == captured["context"]["coverageSummary"]["totalRuleCount"]
        if pages:
            assert all(page[key] == pages[0][key] for key in (
                "ruleSetVersionId", "assessmentRuleCount", "totalPinnedRuleCount", "legalRequirementCount",
            ))
        pages.append(page)
        for row in page["assessmentRules"]:
            item = dict(row)
            if item.get("detailRequired"):
                criteria = yield from _rule_value(
                    captured, item["assessmentRuleId"], "/assessmentRule/criteria",
                    version=item["assessmentRuleVersion"],
                )
                item["criterionIds"] = [criterion["criterionId"] for criterion in criteria]
            rows.append(item)
        end = offset + len(page["assessmentRules"])
        if page["nextOffset"] is None:
            assert end == page["assessmentRuleCount"] == len(rows)
            break
        assert page["assessmentRules"] and page["nextOffset"] == end < page["assessmentRuleCount"]
        offset = page["nextOffset"]
    ids = [row["assessmentRuleId"] for row in rows]
    assert len(set(ids)) == len(ids)
    audit = captured["context"].get("auditRequest")
    assert audit is None or set(ids) == set(audit["selectedRuleIds"])
    captured["catalogPages"] = pages
    captured["rule_set"] = {**pages[0], "assessmentRules": rows, "nextOffset": None}


def _scope_read(captured: dict[str, Any], rule_id: str) -> Generator:
    """Business purpose: Supply the decision script with complete applicability anchors.
    Business rules:
    - Only the model-observed complete applicabilityElements value may supply anchors.
    Execution flow:
    1. Read the selected rule's applicability field through the bounded protocol.
    2. Store the reconstructed value for the subsequent scripted decision.
    Failure cases:
    - A rejected or incomplete read prevents the decision step.
    Side effects:
    - Updates test capture memory only.
    """
    row = next(row for row in captured["rule_set"]["assessmentRules"] if row["assessmentRuleId"] == rule_id)
    elements = yield from _rule_value(
        captured, rule_id, "/applicabilityElements", version=row["assessmentRuleVersion"],
    )
    assert isinstance(elements, list)
    captured[f"scope_{rule_id}"] = {"applicabilityElements": elements}


def _coverage_read(captured: dict[str, Any]) -> Generator:
    """Business purpose: Reload complete per-rule coverage after a native restart.
    Business rules:
    - Context remains the compact authoritative summary; coverage is read with its snapshot token.
    - Every observed page must retain the same case revision and authorized total.
    Execution flow:
    1. Read fresh context and its coverage token.
    2. Follow all coverage pages with one row per page.
    3. Store the complete observed rows separately from the unchanged context reply.
    Failure cases:
    - Stale tokens, duplicate rows, missing continuation or mismatched counts fail the fixture.
    Side effects:
    - Read-only native tool requests and in-memory test capture.
    """
    context = yield "get_assessment_context", {}
    captured["context"] = context
    summary = context["coverageSummary"]
    rows, pages, offset = [], [], 0
    while True:
        page = yield summary["pageTool"], {"snapshot_token": summary["snapshotToken"], "offset": offset, "limit": 1}
        assert page["snapshotToken"] == summary["snapshotToken"]
        assert page["caseRevision"] == context["caseRevision"]
        assert page["totalRuleCount"] == summary["totalRuleCount"] and page["offset"] == offset
        rows.extend(page["coverage"])
        pages.append(page)
        end = offset + len(page["coverage"])
        if page["nextOffset"] is None:
            assert end == summary["totalRuleCount"] == len(rows)
            break
        assert page["coverage"] and page["nextOffset"] == end < summary["totalRuleCount"]
        offset = page["nextOffset"]
    assert len({row["assessmentRuleId"] for row in rows}) == len(rows)
    audit = context.get("auditRequest")
    assert audit is None or {row["assessmentRuleId"] for row in rows} == set(audit["selectedRuleIds"])
    captured["coverage"] = rows
    captured["coveragePages"] = pages


class DynamicScriptedModel(ScriptedModel):
    """Each queued step is a function of the conversation so far."""

    steps: list[Any] = []
    model_name: str = "assessment-root-vertical"

    def _get_ls_params(self, **kwargs: Any) -> dict[str, str]:
        return {"ls_provider": self.model_name, "ls_model_type": "chat"}

    def _generate(self, messages, **kwargs):  # noqa: ANN001
        from langchain_core.outputs import ChatGeneration, ChatResult

        self.prompts.append(list(messages))
        while self.steps:
            step = self.steps[0]
            response = step(messages)
            if not isinstance(step, BoundedReadStep) or response is None:
                self.steps.pop(0)
            if response is not None:
                return ChatResult(generations=[ChatGeneration(message=response)])
        raise AssertionError("scripted Root received an unexpected model turn")


def full_script(captured: dict[str, Any], first_rule: str = "ER-RET", *, selected_only: bool = False) -> list[Step]:
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
                    "assessment_rule_id": rule,
                    "applicability": "APPLICABLE",
                    "rationale": f"{rule} applies to the notice service.",
                    "legal_context_ids": [{"ER-RET": "LR-RET", "ER-XREF": "LR-XREF"}[rule]],
                    "references": refs,
                    "criteria": [
                        {"criterion_id": criterion, "outcome": outcome, "rationale": "Based on the cited source.", "references": refs}
                        for criterion in next(r for r in captured["rule_set"]["assessmentRules"] if r["assessmentRuleId"] == rule)["criterionIds"]
                    ],
                    "compliance": "COMPLIANT" if outcome == "MET" else "NON_COMPLIANT",
                }
            else:
                args = {
                    "assessment_rule_id": rule,
                    "applicability": "NOT_APPLICABLE",
                    "rationale": "The definition is context, not an assessable duty here.",
                    "legal_context_ids": ["LR-DEF"],
                    "references": [{"type": "CONFIRMED_FACT", "id": fact["use_case"]}],
                }
            requirement = {"ER-RET": "LR-RET", "ER-XREF": "LR-XREF", "ER-DEF": "LR-DEF"}[rule]
            args["applicability_basis"] = [{
                "legal_requirement_id": requirement, "kind": "APPLICABILITY_CONDITION", "index": 0,
                "finding": "ESTABLISHED" if applicable else "REFUTED",
                "rationale": "The accepted fixture evidence establishes the scripted applicability finding.",
                "references": args["references"],
            }]
            if applicable:
                detail = captured[f"scope_{rule}"]
                args["applicability_basis"].extend({
                    "legal_requirement_id": element["legalRequirementId"], "kind": "OPERATIVE_SCOPE",
                    "index": element["index"], "finding": "ESTABLISHED",
                    "rationale": "The synthetic notice-service fixture establishes its scripted operator and activity.",
                    "references": args["references"],
                } for element in detail["applicabilityElements"] if element["kind"] == "OPERATIVE_SCOPE")
            return _call("submit_rule_decision", args, key)

        return step

    steps: list[Step] = [
        BoundedReadStep(_catalog_read(captured), "catalog", captured),
        lambda m: _call("grep", {"pattern": "keep_days", "path": "/"}, "s3"),
        lambda m: _call("cite_repository_source", cite_args("src/retention.py", 3, 3), "s4"),
        lambda m: (
            ev.__setitem__("source", keep("evidence", m)["evidenceId"]),
            _call("task", {"description": "Where is keep_days configured?", "subagent_type": RESEARCHER_NAME}, "s5"),
        )[1],
        # (researcher answers here: one model turn consumed by the child graph)
        lambda m: AIMessage(content="Findings: src/retention.py:3 sets keep_days. No other uses found."),
        lambda m: _call("record_search_coverage", {"known_gaps": ["dynamic configuration not traced"]}, "s6"),
        lambda m: (keep("coverage", m), _call("accept_case_fact", {"kind": "USE_CASE", "statement": "The system stores notices with a receipt timestamp.", "evidence_ids": [ev["source"]]}, "s7"))[1],
        lambda m: (fact.__setitem__("use_case", keep("fact", m)["factId"]), _call("start_rule_investigation", {"assessment_rule_id": first_rule}, "s8"))[1],
        # A deliberately incomplete first attempt: the validator must reject it and say why.
        lambda m: _call(
            "submit_rule_decision",
            {
                "assessment_rule_id": first_rule,
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
        lambda m: captured.__setitem__("rejected", last(m)),
        BoundedReadStep(_scope_read(captured, first_rule), "scope-first", captured),
        decide(first_rule, applicable=True, outcome="MET", key="s10"),
    ]
    if not selected_only:
        steps.extend([
            lambda m: (captured.__setitem__("decision_ret", last(m)), _call("start_rule_investigation", {"assessment_rule_id": "ER-XREF"}, "s11"))[1],
            BoundedReadStep(_scope_read(captured, "ER-XREF"), "scope-xref", captured),
            decide("ER-XREF", applicable=True, outcome="NOT_MET", key="s12"),
            lambda m: (captured.__setitem__("decision_xref", last(m)), _call("start_rule_investigation", {"assessment_rule_id": "ER-DEF"}, "s13"))[1],
            decide("ER-DEF", applicable=False, outcome=None, key="s14"),
            lambda m: (captured.__setitem__("decision_def", last(m)), AIMessage(content="All three rules decided."))[1],
        ])
    return steps


def selected_script(captured: dict[str, Any], rule_id: str) -> list[Step]:
    """Accept exactly one selected rule and complete only that request's gate."""
    steps = full_script(captured, first_rule=rule_id, selected_only=True)
    steps.extend([
        lambda m: (captured.__setitem__("selected_decision", _tool_results(m)[-1]), _call("request_finalization", {}, "selected-finalization"))[1],
        lambda m: (captured.__setitem__("selected_finalization", _tool_results(m)[-1]), AIMessage(content="The selected rule result is accepted."))[1],
    ])
    return steps


def resume_script(captured: dict[str, Any]) -> list[Step]:
    return [
        BoundedReadStep(_coverage_read(captured), "resume-coverage", captured),
        lambda m: AIMessage(content="Context and complete coverage reloaded after restart."),
    ]


def main() -> int:
    from orchestration.runtime_control import active_runtime_run_id, active_runtime_incarnation_id
    active_runtime_run_id.set(os.getenv("LCSP_TEST_ROOT_RUNTIME_RUN_ID"))
    active_runtime_incarnation_id.set(os.getenv("LCSP_TEST_ROOT_INCARNATION_ID"))
    base, key, assessment_id, repo_dir, mode = sys.argv[1:6]
    captured: dict[str, Any] = {}
    steps = (
        selected_script(captured, os.environ["ASSESSMENT_SELECTED_RULE_ID"])
        if mode == "selected"
        else full_script(captured)
        if mode in {"full", "complete"}
        else resume_script(captured)
    )
    if mode == "complete":
        # The normal response above must continue in the same graph to the API-owned terminal.
        steps += [
            lambda m: _call("request_finalization", {}, "finalize"),
            lambda m: _call("submit_final_report", {
                "summary": "Accepted decisions and evidence complete the assessment.",
                "findings": [{"assessment_rule_id": rule, "summary": "This finding follows its accepted decision.",
                              "recommendations": []} for rule in ["ER-DEF", "ER-RET", "ER-XREF"]],
            }, "report"),
        ]
    model = DynamicScriptedModel(responses=[], steps=steps)
    client = AssessmentRuntimeClient(base, key)
    root_logger = assessment_root_runner.logger

    class RootFailureCapture:
        def __getattr__(self, name: str) -> Any:
            return getattr(root_logger, name)

        def error(self, event: str, *args: Any, **kwargs: Any) -> Any:
            if event == "ASSESSMENT_ROOT_RUN_FAILED":
                captured["rootError"] = {
                    key: kwargs.get(key)
                    for key in ("error_type", "error_message", "error_traceback")
                }
            return root_logger.error(event, *args, **kwargs)

    assessment_root_runner.logger = RootFailureCapture()
    root_graph_config = assessment_root_runner.agent_graph_config

    def capture_graph_config(config=None):  # noqa: ANN001
        graph_config = root_graph_config(config)
        configurable = graph_config.get("configurable", {})
        captured["graphConfig"] = {
            "threadId": configurable.get("thread_id"),
            "checkpointNamespace": configurable.get("checkpoint_ns"),
        }
        return graph_config

    assessment_root_runner.agent_graph_config = capture_graph_config
    print("PHASE_START CHECKPOINT_SETUP", flush=True)
    from approved_bundle_fixture import offline_instruction_bundle
    with offline_instruction_bundle(), PostgresSaver.from_conn_string(os.environ["LANGGRAPH_CHECKPOINT_DATABASE_URL"]) as saver:
        saver.setup()
        print("PHASE_COMPLETE CHECKPOINT_SETUP", flush=True)
        print("PHASE_START AGENT_RUNTIME_WAIT", flush=True)
        result = run_assessment_root(
            client,
            assessment_id,
            backend_factory=lambda claim, context: (FilesystemBackend(root_dir=repo_dir, virtual_mode=True), None),
            model=model,
            checkpointer=saver,
            governance=(),
        )
        print("PHASE_COMPLETE AGENT_RUNTIME_WAIT", flush=True)
    print("PHASE_COMPLETE CHECKPOINT_SHUTDOWN", flush=True)
    print(json.dumps({"result": result, "captured": captured, "remainingSteps": len(model.steps)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
