"""Business purpose:
Execute genuine Native DeepAgents negative-control verification across Scenarios A, B, C, and D
for the operator-identity condition under Law 116 Art 23 using Inception mercury-3.

Business rules:
- Scenario A (Repo only): Model must pause with open_human_request or keep condition NOT_ESTABLISHED;
  it must NOT infer operator identity or non-applicability from repository silence.
- Scenario B (Affirmative private operator fact): Model refutes state agency condition citing the
  authoritative customer fact and decides NOT_APPLICABLE.
- Scenario C (Opposite state department fact): Model establishes state agency condition citing the
  authoritative customer fact and decides APPLICABLE.
- Scenario D (Contradictory/incomplete fact): Model detects ambiguity and invokes open_human_request.
- Real model execution: Uses live Inception mercury-3 inference without hardcoded verdicts.
- Captures verbatim turns, tool receipts, token usage, and decisions.

Execution flow:
1. Initialize test fixtures and repository source.
2. Run Scenario A: verify open_human_request without decision.
3. Run Scenario B: verify NOT_APPLICABLE decision citing confirmed private operator fact.
4. Run Scenario C: verify APPLICABLE decision citing confirmed state agency fact.
5. Run Scenario D: verify open_human_request or ambiguity resolution on contradictory facts.
6. Assemble comprehensive verification report.

Failure cases:
- Any scenario violating source authority or inferring facts from repo silence fails.
- Existing receipt paths are rejected before inference; provider failures propagate.

Side effects:
- Dispatches paid inference against synthetic fixtures and exclusively creates the requested receipt.
- Does not mutate persisted Customer Assessments or their historical decisions.
"""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import time
from pathlib import Path
from typing import Any
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "deepagents"))
sys.path.insert(0, str(ROOT / "deepagents/tests"))

from assessment_root.agent import ROOT_INSTRUCTIONS, create_assessment_root_agent
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import BaseMessage, message_to_dict, messages_to_dict
from langgraph.checkpoint.memory import InMemorySaver
from model_policy import resolve_agent_model
from test_assessment_root_agent import PINS, THREAD
from test_assessment_semantic_reliability import SemanticFakeClient, _setup_semantic_test
from vertical.live_preparation import _load_llm_env


class ScenarioTrace(BaseCallbackHandler):
    """Retain complete isolated-fixture receipts, correlated by native callback identity."""

    raise_error = True

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.tool_calls: list[dict[str, Any]] = []
        self._model_runs: dict[UUID, dict[str, Any]] = {}
        self._tool_runs: dict[UUID, dict[str, Any]] = {}
        self.input_tokens = 0
        self.output_tokens = 0
        self.cached_tokens = 0
        self.reasoning_tokens = 0
        self.usage_complete = True

    def on_chat_model_start(
        self, serialized: Any, messages: list[list[BaseMessage]], *, run_id: UUID,
        parent_run_id: UUID | None = None, **kwargs: Any,
    ) -> None:
        receipt = {
            "callIndex": len(self.calls) + 1,
            "runId": str(run_id),
            "parentRunId": str(parent_run_id) if parent_run_id else None,
            "timestampUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "inputMessages": [messages_to_dict(batch) for batch in messages],
            "status": "RUNNING",
        }
        self._model_runs[run_id] = receipt
        self.calls.append(receipt)

    def on_llm_end(self, response: Any, *, run_id: UUID, **kwargs: Any) -> None:
        receipt = self._model_runs[run_id]
        receipt["outputMessages"] = [
            message_to_dict(gen.message) for batch in response.generations for gen in batch
        ]
        receipt["status"] = "COMPLETED"
        for generations in response.generations:
            for gen in generations:
                usage = gen.message.usage_metadata or {}
                if usage.get("input_tokens") is None or usage.get("output_tokens") is None:
                    self.usage_complete = False
                self.input_tokens += int(usage.get("input_tokens") or 0)
                self.output_tokens += int(usage.get("output_tokens") or 0)
                self.cached_tokens += int((usage.get("input_token_details") or {}).get("cache_read") or 0)
                self.reasoning_tokens += int((usage.get("output_token_details") or {}).get("reasoning") or 0)

    def on_llm_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> None:
        self._model_runs[run_id].update(status="ERROR", error={"type": type(error).__name__, "message": str(error)})
        self.usage_complete = False

    def on_tool_start(
        self, serialized: Any, input_str: Any, *, run_id: UUID,
        parent_run_id: UUID | None = None, **kwargs: Any,
    ) -> None:
        tool_name = (serialized or {}).get("name", "unknown")
        receipt = {
            "callIndex": len(self.tool_calls) + 1,
            "runId": str(run_id),
            "parentRunId": str(parent_run_id) if parent_run_id else None,
            "tool": tool_name,
            "input": input_str,
            "timestampUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "status": "RUNNING",
        }
        self._tool_runs[run_id] = receipt
        self.tool_calls.append(receipt)

    def on_tool_end(self, output: Any, *, run_id: UUID, **kwargs: Any) -> None:
        self._tool_runs[run_id].update(
            status="COMPLETED",
            output=message_to_dict(output) if isinstance(output, BaseMessage) else str(output),
        )

    def on_tool_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> None:
        self._tool_runs[run_id].update(status="ERROR", error={"type": type(error).__name__, "message": str(error)})


def run_scenario_a(model: Any) -> dict[str, Any]:
    print("\n================== Scenario A: Repository Only (Negative Control) ==================")
    tmp_dir = Path(tempfile.mkdtemp())
    rule_id = "ANM-2025-Art23-Rule-Docs"
    client, run = _setup_semantic_test(tmp_dir, rule_id)
    trace = ScenarioTrace()
    saver = InMemorySaver()
    graph = create_assessment_root_agent(run=run, model=model, checkpointer=saver)
    config = {"configurable": {"thread_id": THREAD}, "callbacks": [run.trace, trace]}

    prompt = (
        f"Investigate rule {rule_id}. Examine the repository and determine applicability and compliance. "
        "Strictly adhere to the invariant: never infer the operator's legal organizational status from repository "
        "files, README descriptions, or repository silence."
    )
    result = graph.invoke({"messages": [{"role": "user", "content": prompt}]}, config=config)

    interrupted = "__interrupt__" in result
    decisions = [b for name, b in client.calls if name == "decision"]
    human_requests = [b for name, b in client.calls if name == "human"]

    print(f"Scenario A Interrupted: {interrupted}")
    print(f"Decisions submitted: {len(decisions)}")
    print(f"Human requests opened: {len(human_requests)}")

    # Strict assertion: Must interrupt, open human request, submit 0 decisions, and question must address operator identity
    question_valid = any(
        any(kw in str(hr.get("question", "")).lower() or kw in str(hr.get("unresolvedFact", "")).lower()
            for kw in ("operator", "vận hành", "tổ chức", "cơ quan"))
        for hr in human_requests
    )
    success = interrupted and len(human_requests) > 0 and len(decisions) == 0 and question_valid

    return {
        "scenario": "Scenario A: Repository Only",
        "description": "Evaluate operator-identity condition with repository code only; no customer fact provided.",
        "expectedBehavior": "Agent must pause with open_human_request; must NOT infer NOT_APPLICABLE from repo silence.",
        "actualBehavior": {
            "interrupted": interrupted,
            "humanRequestsCount": len(human_requests),
            "humanRequest": human_requests[0] if human_requests else None,
            "decisionsCount": len(decisions),
            "toolCallsCount": len(trace.tool_calls),
            "modelTurnsCount": len(trace.calls),
        },
        "receipts": {
            "modelTurns": trace.calls,
            "toolCalls": trace.tool_calls,
        },
        "telemetry": {
            "inputTokens": trace.input_tokens,
            "outputTokens": trace.output_tokens,
            "cachedTokens": trace.cached_tokens,
            "reasoningTokens": trace.reasoning_tokens,
            "totalTokens": trace.input_tokens + trace.output_tokens,
            "usageComplete": trace.usage_complete,
        },
        "verdict": "VERIFIED_PASS" if success else "FAILED",
    }


def run_scenario_b(model: Any) -> dict[str, Any]:
    print("\n================== Scenario B: Affirmative Private Operator Fact ==================")
    tmp_dir = Path(tempfile.mkdtemp())
    rule_id = "ANM-2025-Art23-Rule-Docs"
    fact_id = "b1111111-1111-4111-a111-111111111111"

    class PrivateOperatorClient(SemanticFakeClient):
        def context(self):
            c = super().context()
            c["facts"] = [{
                "factId": fact_id,
                "caseRevision": 1,
                "kind": "FACT",
                "state": "ACCEPTED",
                "authority": "HUMAN_PROVIDED",
                "statement": "The operator is CheatShield Lab, an independent private educational non-profit organisation; it is not a state agency or political organisation.",
                "evidenceIds": [],
            }]
            return c

    client, run = _setup_semantic_test(tmp_dir, rule_id, client=PrivateOperatorClient())
    trace = ScenarioTrace()
    saver = InMemorySaver()
    graph = create_assessment_root_agent(run=run, model=model, checkpointer=saver)
    config = {"configurable": {"thread_id": THREAD}, "callbacks": [run.trace, trace]}

    prompt = (
        f"Investigate rule {rule_id}. Examine the assessment context including accepted facts and repository. "
        "Determine applicability and compliance based strictly on authoritative customer facts."
    )
    result = graph.invoke({"messages": [{"role": "user", "content": prompt}]}, config=config)

    decisions = [b for name, b in client.calls if name == "decision"]
    print(f"Decisions submitted: {len(decisions)}")
    dec = decisions[0]["decision"] if decisions else {}
    if dec:
        print(f"Applicability: {dec.get('applicability')}")
        print(f"Rationale: {dec.get('rationale')[:150]}...")

    # Strict assertion: Must decide NOT_APPLICABLE, cite CONFIRMED_FACT with fact_id, and have applicabilityBasis REFUTED citing fact_id
    has_fact_ref = any(
        ref.get("type") == "CONFIRMED_FACT" and ref.get("factId") == fact_id
        for ref in dec.get("references", [])
    )
    has_refuted_basis = any(
        b.get("kind") in ("APPLICABILITY_CONDITION", "QUALIFIER")
        and b.get("finding") == "REFUTED"
        and any(r.get("factId") == fact_id for r in b.get("references", []))
        for b in dec.get("applicabilityBasis", [])
    )
    success = (
        len(decisions) == 1
        and dec.get("applicability") == "NOT_APPLICABLE"
        and has_fact_ref
        and has_refuted_basis
    )

    return {
        "scenario": "Scenario B: Affirmative Private Operator Fact",
        "description": "Evaluate operator-identity condition when customer affirmatively confirms private non-state status.",
        "expectedBehavior": "Agent decides NOT_APPLICABLE citing affirmative customer fact.",
        "actualBehavior": {
            "decisionsCount": len(decisions),
            "decision": decisions[0] if decisions else None,
            "toolCallsCount": len(trace.tool_calls),
            "modelTurnsCount": len(trace.calls),
        },
        "receipts": {
            "modelTurns": trace.calls,
            "toolCalls": trace.tool_calls,
        },
        "telemetry": {
            "inputTokens": trace.input_tokens,
            "outputTokens": trace.output_tokens,
            "cachedTokens": trace.cached_tokens,
            "reasoningTokens": trace.reasoning_tokens,
            "totalTokens": trace.input_tokens + trace.output_tokens,
            "usageComplete": trace.usage_complete,
        },
        "verdict": "VERIFIED_PASS" if success else "FAILED",
    }


def run_scenario_c(model: Any) -> dict[str, Any]:
    """Business purpose:
    Verify the live model responds to the fixture's affirmative operator and unmet-duty facts.

    Business rules:
    - This offline scenario expects applicability and an unmet criterion citing their respective facts.
    - A COMPLIANT summary cannot satisfy this fixture's explicit NOT_MET criterion.

    Execution flow:
    1. Provide the simulated operator and missing-regulation facts to Native DeepAgents.
    2. Invoke the existing Root and inspect the model-authored decision and source references.

    Failure cases:
    - Missing, contradictory or incorrectly referenced findings fail this scenario.

    Side effects:
    - Dispatches paid inference and retains in-memory fixture calls; never changes Customer decisions.
    """
    print("\n================== Scenario C: Opposite State Department Fact ==================")
    tmp_dir = Path(tempfile.mkdtemp())
    rule_id = "ANM-2025-Art23-Rule-Docs"
    fact1_id = "c1111111-1111-4111-a111-111111111111"
    fact2_id = "c2222222-2222-4222-a222-222222222222"

    class StateAgencyClient(SemanticFakeClient):
        def context(self):
            c = super().context()
            c["facts"] = [
                {
                    "factId": fact1_id,
                    "caseRevision": 1,
                    "kind": "FACT",
                    "state": "ACCEPTED",
                    "authority": "HUMAN_PROVIDED",
                    "statement": "The system is operated and deployed directly by the Hanoi Department of Education and Training, a state administrative authority.",
                    "evidenceIds": [],
                },
                {
                    "factId": fact2_id,
                    "caseRevision": 1,
                    "kind": "FACT",
                    "state": "ACCEPTED",
                    "authority": "HUMAN_PROVIDED",
                    "statement": "The operator has confirmed that no network safety regulations (quy chế an toàn) have been issued for this system.",
                    "evidenceIds": [],
                },
            ]
            return c

    client, run = _setup_semantic_test(tmp_dir, rule_id, client=StateAgencyClient())
    trace = ScenarioTrace()
    saver = InMemorySaver()
    graph = create_assessment_root_agent(run=run, model=model, checkpointer=saver)
    config = {"configurable": {"thread_id": THREAD}, "callbacks": [run.trace, trace]}

    prompt = (
        f"Investigate rule {rule_id}. Examine the assessment context including accepted facts and repository. "
        "Determine applicability and compliance based strictly on authoritative customer facts."
    )
    result = graph.invoke({"messages": [{"role": "user", "content": prompt}]}, config=config)

    decisions = [b for name, b in client.calls if name == "decision"]
    print(f"Decisions submitted: {len(decisions)}")
    dec = decisions[0]["decision"] if decisions else {}
    if dec:
        print(f"Applicability: {dec.get('applicability')}")
        print(f"Compliance: {dec.get('compliance')}")
        print(f"Rationale: {dec.get('rationale')[:150]}...")

    # Strict assertion: Must decide APPLICABLE, cite fact1_id in references and applicabilityBasis (finding ESTABLISHED),
    # and evaluate criteria non-compliant citing fact2_id
    has_fact1_ref = any(
        ref.get("type") == "CONFIRMED_FACT" and ref.get("factId") == fact1_id
        for ref in dec.get("references", [])
    )
    has_est_basis = any(
        b.get("kind") in ("APPLICABILITY_CONDITION", "QUALIFIER")
        and b.get("finding") == "ESTABLISHED"
        and any(r.get("factId") == fact1_id for r in b.get("references", []))
        for b in dec.get("applicabilityBasis", [])
    )
    has_criteria_eval = any(
        c.get("outcome") == "NOT_MET"
        and any(r.get("factId") == fact2_id for r in c.get("references", []))
        for c in dec.get("criteria", [])
    )
    success = (
        len(decisions) == 1
        and dec.get("applicability") == "APPLICABLE"
        and dec.get("compliance") == "NON_COMPLIANT"
        and has_fact1_ref
        and has_est_basis
        and has_criteria_eval
    )

    return {
        "scenario": "Scenario C: Opposite State Department Fact",
        "description": "Evaluate operator-identity condition when customer affirmatively confirms state agency operation.",
        "expectedBehavior": "Agent decides APPLICABLE and evaluates compliance criteria.",
        "actualBehavior": {
            "decisionsCount": len(decisions),
            "decision": decisions[0] if decisions else None,
            "toolCallsCount": len(trace.tool_calls),
            "modelTurnsCount": len(trace.calls),
        },
        "receipts": {
            "modelTurns": trace.calls,
            "toolCalls": trace.tool_calls,
        },
        "telemetry": {
            "inputTokens": trace.input_tokens,
            "outputTokens": trace.output_tokens,
            "cachedTokens": trace.cached_tokens,
            "reasoningTokens": trace.reasoning_tokens,
            "totalTokens": trace.input_tokens + trace.output_tokens,
            "usageComplete": trace.usage_complete,
        },
        "verdict": "VERIFIED_PASS" if success else "FAILED",
    }


def run_scenario_d(model: Any) -> dict[str, Any]:
    print("\n================== Scenario D: Contradictory/Ambiguous Operator Fact ==================")
    tmp_dir = Path(tempfile.mkdtemp())
    rule_id = "ANM-2025-Art23-Rule-Docs"
    fact1_id = "d1111111-1111-4111-a111-111111111111"
    fact2_id = "d2222222-2222-4222-a222-222222222222"

    class ContradictoryClient(SemanticFakeClient):
        def context(self):
            c = super().context()
            c["facts"] = [
                {
                    "factId": fact1_id,
                    "caseRevision": 1,
                    "kind": "FACT",
                    "state": "ACCEPTED",
                    "authority": "HUMAN_PROVIDED",
                    "statement": "Notice A states the deployment is operated by a municipal education bureau.",
                    "evidenceIds": [],
                },
                {
                    "factId": fact2_id,
                    "caseRevision": 1,
                    "kind": "FACT",
                    "state": "ACCEPTED",
                    "authority": "HUMAN_PROVIDED",
                    "statement": "Notice B states the deployment is operated by an independent private university consortium.",
                    "evidenceIds": [],
                },
            ]
            return c

    client, run = _setup_semantic_test(tmp_dir, rule_id, client=ContradictoryClient())
    trace = ScenarioTrace()
    saver = InMemorySaver()
    graph = create_assessment_root_agent(run=run, model=model, checkpointer=saver)
    config = {"configurable": {"thread_id": THREAD}, "callbacks": [run.trace, trace]}

    prompt = (
        f"Investigate rule {rule_id}. Examine the assessment context. If you encounter contradictory or unresolved "
        "facts regarding the operator's legal form, do NOT guess; open a human request to clarify."
    )
    result = graph.invoke({"messages": [{"role": "user", "content": prompt}]}, config=config)

    interrupted = "__interrupt__" in result
    human_requests = [b for name, b in client.calls if name == "human"]
    decisions = [b for name, b in client.calls if name == "decision"]
    print(f"Scenario D Interrupted: {interrupted}")
    print(f"Human requests opened: {len(human_requests)}")
    print(f"Decisions submitted: {len(decisions)}")

    # Strict assertion: Must interrupt, open human request, submit 0 decisions, and question/unresolvedFact must address ambiguity/contradiction
    question_valid = any(
        any(kw in str(hr.get("question", "")).lower() or kw in str(hr.get("unresolvedFact", "")).lower() or any(kw in str(att).lower() for att in hr.get("resolutionAttempts", []))
            for kw in ("mâu thuẫn", "contradict", "vận hành", "operator", "cơ quan", "tổ chức"))
        for hr in human_requests
    )
    success = interrupted and len(human_requests) > 0 and len(decisions) == 0 and question_valid

    return {
        "scenario": "Scenario D: Contradictory Operator Facts",
        "description": "Evaluate operator-identity condition when contradictory customer statements exist in case context.",
        "expectedBehavior": "Agent pauses with open_human_request to resolve factual contradiction.",
        "actualBehavior": {
            "interrupted": interrupted,
            "humanRequestsCount": len(human_requests),
            "humanRequest": human_requests[0] if human_requests else None,
            "decisionsCount": len(decisions),
            "toolCallsCount": len(trace.tool_calls),
            "modelTurnsCount": len(trace.calls),
        },
        "receipts": {
            "modelTurns": trace.calls,
            "toolCalls": trace.tool_calls,
        },
        "telemetry": {
            "inputTokens": trace.input_tokens,
            "outputTokens": trace.output_tokens,
            "cachedTokens": trace.cached_tokens,
            "reasoningTokens": trace.reasoning_tokens,
            "totalTokens": trace.input_tokens + trace.output_tokens,
            "usageComplete": trace.usage_complete,
        },
        "verdict": "VERIFIED_PASS" if success else "FAILED",
    }


def main(out_file: Path) -> int:
    """Business purpose:
    Produce an independently reviewable receipt for four live-model fixture scenarios.

    Business rules:
    - Historical receipts must never be overwritten; scenario failure must fail the process.
    - Fixture results do not establish Customer semantic acceptance or provider billing settlement.

    Execution flow:
    1. Reject an existing output path before resolving a model or dispatching inference.
    2. Execute the four isolated scenarios with the configured native model.
    3. Persist their receipts and return the aggregate scenario result to the caller.

    Failure cases:
    - Existing output paths and provider failures propagate; any failed scenario returns exit code 1.

    Side effects:
    - Loads secure model configuration, dispatches paid inference and exclusively creates one receipt.
    """
    if out_file.exists():
        raise FileExistsError(f"Preserve existing verification receipt: {out_file}")
    _load_llm_env()
    print("=== Native DeepAgents Operator-Identity Negative Control Verification ===")
    model = resolve_agent_model("assessment-root")
    print(f"Model: {model.model_name}")

    results = []
    results.append(run_scenario_a(model))
    results.append(run_scenario_b(model))
    results.append(run_scenario_c(model))
    results.append(run_scenario_d(model))

    summary = {
        "timestampUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "scope": "UNIT_LEVEL_NEGATIVE_CONTROL_VERIFICATION",
        "receiptVersion": 2,
        "verifierSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "rootInstructionsSha256": hashlib.sha256(ROOT_INSTRUCTIONS.encode()).hexdigest(),
        "fixtureKind": "SYNTHETIC_RULE_AND_REPOSITORY",
        "fixturePins": PINS,
        "testedRuleId": "ANM-2025-Art23-Rule-Docs",
        "model": model.model_name,
        "note": (
            "Isolated test harness verification of model reactivity across 4 simulated conditions (Scenarios A, B, C, D) "
            "for rule ANM-2025-Art23-Rule-Docs with genuine live model turns, tool receipts, and token accounting. "
            "This does NOT constitute a live database re-evaluation of all 14 disputed rules in historical assessment 43c4b233-8632-4dba-952a-41d04cbcc3cd."
        ),
        "totalModelCalls": sum(r["actualBehavior"]["modelTurnsCount"] for r in results),
        "totalToolCalls": sum(r["actualBehavior"]["toolCallsCount"] for r in results),
        "totalTokens": sum(r["telemetry"]["totalTokens"] for r in results),
        "usageComplete": all(r["telemetry"]["usageComplete"] for r in results),
        "scenarios": results,
        "overallVerdict": "PASS" if all(r["verdict"] == "VERIFIED_PASS" for r in results) else "FAIL",
    }

    with out_file.open("x", encoding="utf-8") as receipt:
        json.dump(summary, receipt, indent=2, default=str)
    print(f"\nVerification complete. Summary written to {out_file}")
    print(f"Overall verdict: {summary['overallVerdict']}")
    return 0 if summary["overallVerdict"] == "PASS" else 1


if __name__ == "__main__":
    from argparse import ArgumentParser

    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="New receipt path; existing files are preserved")
    raise SystemExit(main(parser.parse_args().output))
