"""Selected-item execution within the existing Rule Set Preparation boundary."""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

from anthropic_stream_usage import anthropic_async_client_scope, anthropic_first_output_timeout
from langchain.agents import create_agent
from langchain.agents.structured_output import ToolStrategy
from langgraph.errors import NodeCancelledError
from middleware.agent_run_budget import AgentRunBudgetMiddleware, _positive_env
from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
from middleware.usage_metering import AgentRoleMiddleware
from middleware.usage_metering import _safe_provider_error_code
from model_policy import resolve_agent_model
from provider_credentials import llm_provider_timeout_seconds
from orchestration.graph_execution import agent_graph_config
from orchestration.agent_stream import publish_agent_stream_event
from runtime_instruction_bundle import runtime_instruction_snapshot
from tools.common.capabilities.platform.api_client import SELECTED_RULE_OUTPUT_REJECTIONS, WorkerCallbackError
from tools.common.capabilities.platform.correlation import get_correlationId

logger = logging.getLogger(__name__)


async def _invoke_selected_rule(agent: Any, payload: dict[str, Any]) -> dict[str, Any]:
    """Business purpose: Bound the paid preparation of one selected rule by elapsed time.

    Business rules:
    - The configured provider timeout also bounds the entire selected graph, including retries and active streams.
    - Anthropic streams must begin model output within a configurable startup window; metadata and keepalives cannot consume the whole run deadline.
    - Use native async cancellation so a timed-out provider invocation is not left running in a detached worker.
    Execution flow:
    1. Start the selected graph with its existing concurrency configuration.
    2. Await its result within the configured deadline and close scoped provider connections before the loop exits.
    Failure cases:
    - Expiry raises TimeoutError to the existing failure settlement; provider and cancellation errors propagate.
    Side effects:
    - Executes the governed model graph and cancels its asynchronous work on expiry; persistence remains with the caller.
    """
    async with anthropic_async_client_scope(), asyncio.timeout(llm_provider_timeout_seconds()):
        with anthropic_first_output_timeout(min(llm_provider_timeout_seconds(), _positive_env("LCSP_SELECTED_RULE_FIRST_OUTPUT_TIMEOUT_SECONDS", 60))):
            return await agent.ainvoke(payload, config=agent_graph_config({"max_concurrency": 1, "recursion_limit": 16}))


def run_selected_rule_preparation(api: Any, run_id: str, *, model: Any | None = None) -> dict[str, Any]:
    """Business purpose: Prepare one explicitly selected canonical rule and persist its independent result revision.

    Business rules:
    - Claim once before model work; use only the persisted selection input and a fresh context-pinned instruction snapshot.
    - Existing role, model governance, usage metering and cancellation remain authoritative; the provider timeout bounds total graph time.
    - A rejected/ambiguous result callback never causes another paid invocation or a fabricated success.
    Execution flow:
    1. Claim the selected run; stop duplicate delivery before model construction.
    2. Load fresh instructions, record their exact text and construct the governed agent.
    3. Invoke the bounded structured-output graph using only this rule's pinned input.
    4. Persist the result or safe failure through the existing API client and publish progress.
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
            publish_agent_stream_event("CUSTOM_PROGRESS", status="RUNNING", data={"activity_kind": "SELECTED_RULE_PREPARATION", "result_revision": claim["revision"]})
            response = asyncio.run(_invoke_selected_rule(agent, {"messages": [{"role": "user", "content": json.dumps(claim["input"], ensure_ascii=False)}]}))
            output = response.get("structured_response")
            if not isinstance(output, dict):
                raise ValueError("SELECTED_RULE_STRUCTURED_RESULT_MISSING")
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
        if settling and not rejected_output:
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
        api.complete_selected_rule_preparation(run_id, "FAILED", None, "SELECTED_RULE_PREPARATION_FAILED")
        publish_agent_stream_event("CUSTOM_PROGRESS", status="FAILED", data={"activity_kind": "SELECTED_RULE_PREPARATION_FAILED", "error_type": type(error).__name__, "provider_error_code": provider_code})
        return {"state": "FAILED", "resultId": claim["resultId"]}
    else:
        publish_agent_stream_event("CUSTOM_PROGRESS", status="SUCCEEDED", data={"activity_kind": "SELECTED_RULE_PREPARED", "result_revision": claim["revision"]})
        return {"state": "SUCCEEDED", "resultId": claim["resultId"]}
