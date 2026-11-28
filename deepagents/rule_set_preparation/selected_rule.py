"""Selected-item execution within the existing Rule Set Preparation boundary."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import Any

from anthropic_stream_usage import anthropic_async_client_scope, anthropic_first_output_timeout
from langchain.agents import create_agent
from langchain.agents.structured_output import ToolStrategy
from langgraph.errors import NodeCancelledError
from middleware.agent_run_budget import AgentRunBudgetMiddleware, _positive_env
from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
from middleware.usage_metering import (
    AgentRoleMiddleware,
    AgentRunState,
    _safe_provider_error_code,
    activate_agent_run_state,
)
from model_policy import resolve_agent_model
from provider_credentials import llm_provider_timeout_seconds
from orchestration.graph_execution import agent_graph_config
from orchestration.agent_stream import publish_agent_stream_event
from runtime_instruction_bundle import runtime_instruction_snapshot
from tools.common.capabilities.platform.api_client import (
    SELECTED_RULE_OUTPUT_REJECTIONS, SELECTED_RULE_SCOPE_REVIEW_REQUIRED, WorkerCallbackError,
)
from tools.common.capabilities.platform.correlation import get_correlationId

logger = logging.getLogger(__name__)


_MIN_REPAIR_SECONDS = 30
_MAX_REPAIRS_CEILING = 3


def _max_repairs() -> int:
    """Business purpose: Bound the paid pre-settlement repair attempts for one selected rule.

    Business rules:
    - Default is one repair; zero disables it; the ceiling prevents an unbounded paid loop.
    Execution flow:
    1. Read LCSP_SELECTED_RULE_MAX_REPAIRS and clamp it to 0..3.
    Failure cases:
    - A non-integer value raises RuntimeError at configuration time.
    Side effects:
    - Pure read of the environment.
    """
    raw = (os.getenv("LCSP_SELECTED_RULE_MAX_REPAIRS") or "").strip()
    if not raw:
        return 1
    try:
        return max(0, min(int(raw), _MAX_REPAIRS_CEILING))
    except ValueError as error:
        raise RuntimeError("LCSP_SELECTED_RULE_MAX_REPAIRS must be an integer") from error


async def _invoke_selected_rule(agent: Any, payload: dict[str, Any], timeout: float | None = None) -> dict[str, Any]:
    """Business purpose: Bound the paid preparation of one selected rule by elapsed time.

    Business rules:
    - The configured provider timeout (or the time left of it for a repair pass) also bounds the entire selected graph, including retries and active streams.
    - Anthropic streams must begin model output within a configurable startup window; metadata and keepalives cannot consume the whole run deadline.
    - Use native async cancellation so a timed-out provider invocation is not left running in a detached worker.
    Execution flow:
    1. Start the selected graph with its existing concurrency configuration.
    2. Await its result within the deadline and close scoped provider connections before the loop exits.
    Failure cases:
    - Expiry raises TimeoutError to the existing failure settlement; provider and cancellation errors propagate.
    Side effects:
    - Executes the governed model graph and cancels its asynchronous work on expiry; persistence remains with the caller.
    """
    deadline = llm_provider_timeout_seconds() if timeout is None else timeout
    async with anthropic_async_client_scope(), asyncio.timeout(deadline):
        with anthropic_first_output_timeout(min(deadline, _positive_env("LCSP_SELECTED_RULE_FIRST_OUTPUT_TIMEOUT_SECONDS", 60))):
            return await agent.ainvoke(payload, config=agent_graph_config({"max_concurrency": 1, "recursion_limit": 16}))


def _structured_output(response: dict[str, Any]) -> dict[str, Any]:
    """Business purpose: Accept only a structured selected-rule draft from the model graph.

    Business rules:
    - A missing structured result is never fabricated into a success.
    Execution flow:
    1. Read the graph's structured response and require an object.
    Failure cases:
    - A missing or non-object result raises ValueError and settles only this item as FAILED.
    Side effects:
    - Pure; no persistence or external call.
    """
    output = response.get("structured_response")
    if not isinstance(output, dict):
        raise ValueError("SELECTED_RULE_STRUCTURED_RESULT_MISSING")
    return output


def _draft_rejection(api: Any, run_id: str, output: dict[str, Any]) -> WorkerCallbackError | None:
    """Business purpose: Find out, before settlement, whether the API would reject a drafted result.

    Business rules:
    - Only a definitive structural rejection (400/422 with the known codes) makes the draft repairable.
    - An unavailable or inconclusive dry run never blocks settlement; the authoritative completion callback still decides.
    Execution flow:
    1. Ask the API to dry-run the shared settlement validation for this run.
    2. Return the rejection, or None when accepted or inconclusive.
    Failure cases:
    - Transport, 5xx, conflict and unknown errors are logged without values and treated as inconclusive.
    Side effects:
    - One read-only API call; no model work and no persistence.
    """
    try:
        api.validate_selected_rule_output(run_id, output)
    except WorkerCallbackError as error:
        if (error.status_code, error.error_code) == (422, SELECTED_RULE_SCOPE_REVIEW_REQUIRED):
            raise
        if (error.status_code, error.error_code) in SELECTED_RULE_OUTPUT_REJECTIONS:
            return error
        logger.warning("Selected rule draft validation inconclusive run_id=%s error_type=%s status_code=%s", run_id, type(error).__name__, error.status_code)
    return None


def _reject_unresolved_scope(output: dict[str, Any]) -> None:
    """Business purpose: Stop repair of a draft that already declares legal ambiguity.

    Business rules:
    - An explicit review signal is terminal for this attempt, not evidence of eligibility.
    Execution flow:
    1. Inspect the structured coverage reason before any repair or settlement.
    Failure cases:
    - A declared review requirement raises the dedicated non-repairable error.
    Side effects:
    - Pure validation; no model or API call.
    """
    requirements = output.get("legalRequirements")
    if not isinstance(requirements, list):
        return
    for requirement in requirements:
        coverage = requirement.get("coverage") if isinstance(requirement, dict) else None
        reason = coverage.get("nonAssessableReason") if isinstance(coverage, dict) else None
        if isinstance(reason, str) and reason.strip().startswith("LEGAL_REVIEW_REQUIRED:"):
            raise WorkerCallbackError(
                "Legal scope requires review", status_code=422,
                error_code=SELECTED_RULE_SCOPE_REVIEW_REQUIRED,
            )


def _repair_messages(claim_input: dict[str, Any], draft: dict[str, Any], rejection: WorkerCallbackError) -> list[dict[str, str]]:
    """Business purpose: Ask the model to correct only the structural defects the API reported in its own draft.

    Business rules:
    - Feedback carries bounded field paths only; the draft and pinned input are the model's own earlier data, never new customer or legal facts.
    - A repair may remove an unsupported artifact but must not invent legal meaning, sources or applicability to satisfy the schema. Source-supported unconditional duties retain their explicit mode without adding conditions.
    Execution flow:
    1. Replay the pinned input and the rejected draft.
    2. Add the rejected field paths and the structural invariants.
    Failure cases:
    - None; the caller still validates through the completion callback.
    Side effects:
    - Pure; builds the conversation for one extra model call.
    """
    paths = ", ".join(rejection.issue_paths) or "output"
    rule_id = claim_input.get("ruleId", "<ruleId>")
    feedback = (
        f"The previous result was rejected by structural validation at: {paths}. "
        "Return one corrected, complete result for the same selected rule. Change only what is needed to fix those fields and keep the legal analysis. "
        f"Invariants: every legalRequirementId, assessmentRuleId and relationId starts with \"{rule_id}:\"; every sourceRef is copied exactly from the supplied citations "
        "(documentId, locator, contentSha256) and operativeProposition sourceRefs are a subset of the requirement's sourceRefs; "
        "an AssessmentRule references only requirements returned in this result and never a NON_ASSESSABLE one; "
        "a COVERED_BY_ASSESSMENT_RULES requirement needs applicabilityConditions unless its explicit applicabilityMode is UNCONDITIONAL, which requires an empty condition list and source support. "
        "If a requirement or rule cannot be supported by the pinned source, remove it instead of inventing content."
    )
    return [
        {"role": "user", "content": json.dumps(claim_input, ensure_ascii=False)},
        {"role": "assistant", "content": json.dumps(draft, ensure_ascii=False)},
        {"role": "user", "content": feedback},
    ]


def run_selected_rule_preparation(api: Any, run_id: str, *, model: Any | None = None) -> dict[str, Any]:
    """Business purpose: Prepare one explicitly selected canonical rule and persist its independent result revision.

    Business rules:
    - Claim once before model work; use only the persisted selection input and a fresh context-pinned instruction snapshot.
    - Existing role, model governance, usage metering and cancellation remain authoritative; the provider timeout bounds total graph time.
    - A rejected/ambiguous result callback never causes another paid invocation or a fabricated success; the only extra invocation is the bounded pre-settlement repair of a draft the API already proved invalid.
    Execution flow:
    1. Claim the selected run; stop duplicate delivery before model construction.
    2. Load fresh instructions, record their exact text and construct the governed agent.
    3. Invoke the bounded structured-output graph using only this rule's pinned input.
    4. Dry-run the draft against the API's settlement validation; on a definitive structural rejection allow one bounded repair pass inside the remaining deadline.
    5. Persist the result or safe failure through the existing API client and publish progress.
    Failure cases:
    - Duplicate claims return ALREADY_CLAIMED; instruction, model, deadline and schema failures settle only this item as FAILED with safe diagnostics.
    - Known completion schema and result rejections settle the item as FAILED; uncertain completion is propagated without re-execution.
    - Cancellation records the item outcome and re-raises.
    Side effects:
    - Claims one canonical Preparation run, records instruction/result receipts, invokes the metered model, and emits existing Run Activity events and bounded failure diagnostics.
    """
    try:
        claim = api.claim_selected_rule_preparation(run_id)
    except WorkerCallbackError as error:
        if error.status_code == 409:
            return {"state": "ALREADY_CLAIMED"}
        raise

    if claim.get("refused"):
        return {"state": "FAILED", "resultId": claim["resultId"], "failureCode": claim["failureCode"]}

    settling = False
    output = None
    try:
        with runtime_instruction_snapshot() as bundle:
            content = bundle.instruction("preparation.selected")
            receipt = {
                "revision": f"preparation.selected@run:{run_id}",
                "content": content,
            }
            api.record_selected_rule_instructions(run_id, receipt)
            schema = json.loads(Path(__file__).with_name("selected-output.schema.json").read_text(encoding="utf-8"))
            agent = create_agent(
                model=model if model is not None else resolve_agent_model("rule-set-preparation"),
                tools=[], system_prompt=content,
                response_format=ToolStrategy(schema=schema, handle_errors=False),
                middleware=[AgentRoleMiddleware("rule-set-preparation"), AgentRunBudgetMiddleware(run_quotas={"model_calls": _positive_env("LCSP_RSP_MAX_MODEL_CALLS", 4)}), *MODEL_GOVERNANCE_MIDDLEWARE],
                checkpointer=False,
            )
            # Why: Instruction receipts record revision and content; the stream must not assume
            # an optional fingerprint was added by a particular API client implementation.
            publish_agent_stream_event("CUSTOM_PROGRESS", status="RUNNING", data={"activity_kind": "SELECTED_RULE_PREPARATION", "result_revision": claim["revision"]})
            # Why: Bind authoritative server-issued preparationRunId context to the model execution thread (G-06, ADR-028).
            # Mechanism: Initialize AgentRunState with preparation_run_id and activate it around the agent invocation.
            # Invariants: Every initial and repair call requires verified preparationRunId before admission.
            run_state = AgentRunState(
                run_id=run_id,
                preparation_run_id=run_id,
                agent_role="rule-set-preparation",
                api_client=api if hasattr(api, "request_invocation_admission") else None,
            )
            started = time.monotonic()
            with activate_agent_run_state(run_state):
                response = asyncio.run(_invoke_selected_rule(agent, {"messages": [{"role": "user", "content": json.dumps(claim["input"], ensure_ascii=False)}]}))
                output = _structured_output(response)
                _reject_unresolved_scope(output)
                for _ in range(_max_repairs()):
                    rejection = _draft_rejection(api, run_id, output)
                    remaining = llm_provider_timeout_seconds() - (time.monotonic() - started)
                    if rejection is None or remaining < _MIN_REPAIR_SECONDS:
                        break
                    logger.info("Selected rule draft repair run_id=%s correlation_id=%s validation_paths=%s", run_id, get_correlationId(), ",".join(rejection.issue_paths))
                    publish_agent_stream_event("CUSTOM_PROGRESS", status="RUNNING", data={"activity_kind": "SELECTED_RULE_REPAIR", "result_revision": claim["revision"]})
                    response = asyncio.run(_invoke_selected_rule(agent, {"messages": _repair_messages(claim["input"], output, rejection)}, timeout=remaining))
                    output = _structured_output(response)
                    _reject_unresolved_scope(output)
            settling = True
            api.complete_selected_rule_preparation(run_id, "SUCCEEDED", output, None)
    except NodeCancelledError:
        if not settling:
            api.complete_selected_rule_preparation(run_id, "CANCELLED", None, None)
        raise
    except Exception as error:
        rejected_output = (
            isinstance(error, WorkerCallbackError)
            and (error.status_code, error.error_code) in SELECTED_RULE_OUTPUT_REJECTIONS
        )
        scope_review = (
            isinstance(error, WorkerCallbackError)
            and (error.status_code, error.error_code) == (422, SELECTED_RULE_SCOPE_REVIEW_REQUIRED)
        )
        if settling and not rejected_output and not scope_review:
            raise
        provider_code = _safe_provider_error_code(error)
        causes = []
        current = error.__cause__
        while current is not None and len(causes) < 4:
            causes.append(type(current).__name__)
            current = current.__cause__
        logger.error(
            "Selected rule preparation failed run_id=%s error_type=%s provider_error_code=%s correlation_id=%s cause_types=%s",
            run_id, type(error).__name__, provider_code, get_correlationId(), ",".join(causes),
        )
        failure_code = SELECTED_RULE_SCOPE_REVIEW_REQUIRED if scope_review else "SELECTED_RULE_PREPARATION_FAILED"
        try:
            api.complete_selected_rule_preparation(run_id, "FAILED", output if scope_review else None, failure_code)
        except WorkerCallbackError as settlement_error:
            # Invalid structure may prevent retention of the unresolved draft; preserve the typed failure.
            # Never retry an uncertain write or ask the model to remove legal ambiguity.
            if not scope_review or (settlement_error.status_code, settlement_error.error_code) not in SELECTED_RULE_OUTPUT_REJECTIONS:
                raise
            api.complete_selected_rule_preparation(run_id, "FAILED", None, failure_code)
        publish_agent_stream_event("CUSTOM_PROGRESS", status="FAILED", data={"activity_kind": "SELECTED_RULE_PREPARATION_FAILED", "error_type": type(error).__name__, "provider_error_code": provider_code})
        return {"state": "FAILED", "resultId": claim["resultId"]}
    else:
        publish_agent_stream_event("CUSTOM_PROGRESS", status="SUCCEEDED", data={"activity_kind": "SELECTED_RULE_PREPARED", "result_revision": claim["revision"]})
        return {"state": "SUCCEEDED", "resultId": claim["resultId"]}
