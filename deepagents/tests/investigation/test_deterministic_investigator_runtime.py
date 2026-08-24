from __future__ import annotations

from dataclasses import dataclass

from tools.planner.investigation.deterministic_investigator import (
    _TERMINATION_MODE,
    _ProgressBoundLLMClient,
    DeterministicCodeContextLawGuidedInvestigator,
)
from tools.planner.investigation.evidence_ledger import EvidenceLedger
from tools.planner.investigation.investigator import FINISH_TOOL_NAME
from tools.planner.investigation.models import (
    ENGINEERING_EVIDENCE_CLAIM_TYPES,
    ENGINEERING_LIMITATION_CODES,
    EvidenceClaim,
    InvestigationPacket,
)
from tools.common.llm import LLMToolCall, LLMToolResponse


@dataclass
class RepeatingClient:
    call: LLMToolCall

    def complete(self, *args, **kwargs):
        raise AssertionError("not used")

    def complete_with_tools(self, **kwargs) -> LLMToolResponse:
        del kwargs
        return LLMToolResponse(
            content="",
            input_tokens=1,
            output_tokens=1,
            model="test-model",
            provider="test-provider",
            request_id="req-1",
            tool_calls=(self.call,),
        )


def _packet() -> InvestigationPacket:
    return InvestigationPacket(
        engineering_rule_id="eng-1",
        concept="CONTROL",
        investigation_goals=("Inspect the control",),
        initial_results=(),
        required_evidence=("CONTROL_STATE",),
    )


def _invoke(client: _ProgressBoundLLMClient) -> LLMToolResponse:
    return client.complete_with_tools(
        prompt="{}",
        tools=[],
        workflow_run_id="wf-1",
        node_name="investigate_engineering_rule",
        correlationId="corr-1",
    )


def test_repeated_graph_action_is_replaced_by_no_progress_finish() -> None:
    token = _TERMINATION_MODE.set(None)
    try:
        client = _ProgressBoundLLMClient(
            RepeatingClient(
                LLMToolCall(
                    name="inspect_data_path",
                    arguments={"start_ref": "node:1", "direction": "FORWARD"},
                    call_id="call-1",
                )
            ),
            _packet(),
        )

        first = _invoke(client)
        second = _invoke(client)

        assert first.tool_calls[0].name == "inspect_data_path"
        assert second.tool_calls[0].name == FINISH_TOOL_NAME
        assert second.tool_calls[0].arguments["claims"][0]["criterion"] == "CONTROL_STATE"
        assert (
            second.tool_calls[0].arguments["claims"][0]["claimType"]
            == ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"]
        )
        assert _TERMINATION_MODE.get() == "NO_PROGRESS_FINISH"
    finally:
        _TERMINATION_MODE.reset(token)


def test_inspection_compatibility_allows_one_repeat_before_no_progress_finish() -> None:
    token = _TERMINATION_MODE.set(None)
    try:
        client = _ProgressBoundLLMClient(
            RepeatingClient(
                LLMToolCall(
                    name="inspect_observation",
                    arguments={"observation_id": "obs:0001", "section": "nodes"},
                    call_id="call-inspect",
                )
            ),
            _packet(),
        )

        assert _invoke(client).tool_calls[0].name == "inspect_observation"
        assert _invoke(client).tool_calls[0].name == "inspect_observation"
        assert _invoke(client).tool_calls[0].name == FINISH_TOOL_NAME
    finally:
        _TERMINATION_MODE.reset(token)


def test_budget_forced_finish_cannot_close_required_criterion() -> None:
    claims = [
        EvidenceClaim(
            claim_id="claim:met",
            engineering_rule_id="eng-1",
            claim_type=ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"],
            value=True,
            evidence_refs=("evidence:1",),
            graph_path_refs=("edge:1",),
            source_anchor_refs=("source-anchor:1",),
            confidence=0.95,
            criterion="CONTROL_STATE",
        )
    ]

    DeterministicCodeContextLawGuidedInvestigator._log_finish(
        packet=_packet(),
        claims=claims,
        workflow_run_id="wf-1",
        correlation_id="corr-1",
        forced=True,
        ledger=EvidenceLedger(),
    )

    assert len(claims) == 1
    assert claims[0].criterion == "CONTROL_STATE"
    assert claims[0].claim_type == ENGINEERING_EVIDENCE_CLAIM_TYPES["unresolved"]
    assert claims[0].value is None
    assert claims[0].confidence == 0.0
    assert claims[0].evidence_refs == ("evidence:1",)
    assert (
        ENGINEERING_LIMITATION_CODES["engineering_evidence_insufficient"]
        in claims[0].limitations
    )
    assert (
        ENGINEERING_LIMITATION_CODES["search_coverage_incomplete"]
        in claims[0].limitations
    )


def test_natural_finish_keeps_validated_closed_claim() -> None:
    claims = [
        EvidenceClaim(
            claim_id="claim:met",
            engineering_rule_id="eng-1",
            claim_type=ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"],
            value=True,
            evidence_refs=("evidence:1",),
            confidence=0.95,
            criterion="CONTROL_STATE",
        )
    ]

    DeterministicCodeContextLawGuidedInvestigator._log_finish(
        packet=_packet(),
        claims=claims,
        workflow_run_id="wf-1",
        correlation_id="corr-1",
        forced=False,
        ledger=EvidenceLedger(),
    )

    assert claims[0].claim_type == ENGINEERING_EVIDENCE_CLAIM_TYPES["requirement_met"]
    assert claims[0].value is True
    assert claims[0].confidence == 0.95