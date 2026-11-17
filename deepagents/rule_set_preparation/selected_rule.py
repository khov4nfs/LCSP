"""Selected-item execution within the existing Rule Set Preparation boundary."""
from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path
from typing import Any

from langchain.agents import create_agent
from langchain.agents.structured_output import ToolStrategy
from langgraph.errors import NodeCancelledError
from middleware.agent_run_budget import AgentRunBudgetMiddleware, _positive_env
from middleware.model_governance import MODEL_GOVERNANCE_MIDDLEWARE
from middleware.usage_metering import AgentRoleMiddleware
from model_policy import resolve_agent_model
from orchestration.graph_execution import agent_graph_config
from orchestration.agent_stream import publish_agent_stream_event
from runtime_instruction_bundle import runtime_instruction_snapshot
from tools.common.capabilities.platform.api_client import WorkerCallbackError


def run_selected_rule_preparation(api: Any, run_id: str, *, model: Any | None = None) -> dict[str, Any]:
    """Business purpose: Prepare one explicitly selected canonical rule and persist its independent result revision.

    Business rules:
    - Claim once before model work; use only the persisted selection input and a fresh context-pinned instruction snapshot.
    - Existing role, model governance, usage metering, cancellation and bounded runtime remain authoritative.
    - A rejected/ambiguous result callback never causes another paid invocation or a fabricated success.
    Execution flow:
    1. Claim the selected run; stop duplicate delivery before model construction.
    2. Load fresh instructions, record their exact bytes/hash and construct the governed agent.
    3. Invoke the bounded structured-output graph using only this rule's pinned input.
    4. Persist the result or safe failure through the existing API client and publish progress.
    Failure cases:
    - Duplicate claims return ALREADY_CLAIMED; instruction, model and schema failures settle only this item as FAILED.
    - Cancellation records the item outcome and re-raises; ambiguous completion is propagated without re-execution.
    Side effects:
    - Claims one canonical Preparation run, records instruction/result receipts, invokes the metered model, and emits existing Run Activity events.
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
            metadata = bundle.manifest_metadata()
            bundle_hash = sha256(json.dumps(metadata, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            receipt = {
                "revision": f"preparation.selected@sha256:{sha256(content.encode('utf-8')).hexdigest()}",
                "fingerprint": sha256(content.encode("utf-8")).hexdigest(),
                "content": content,
                "bundleFingerprint": bundle_hash,
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
            publish_agent_stream_event("CUSTOM_PROGRESS", status="RUNNING", data={"activity_kind": "SELECTED_RULE_PREPARATION", "result_revision": claim["revision"], "instruction_sha256": receipt["fingerprint"]})
            response = agent.invoke({"messages": [{"role": "user", "content": json.dumps(claim["input"], ensure_ascii=False)}]}, config=agent_graph_config({"max_concurrency": 1, "recursion_limit": 16}))
            output = response.get("structured_response")
            if not isinstance(output, dict):
                raise ValueError("SELECTED_RULE_STRUCTURED_RESULT_MISSING")
            settling = True
            api.complete_selected_rule_preparation(run_id, "SUCCEEDED", output, None)
            publish_agent_stream_event("CUSTOM_PROGRESS", status="SUCCEEDED", data={"activity_kind": "SELECTED_RULE_PREPARED", "result_revision": claim["revision"]})
            return {"state": "SUCCEEDED", "resultId": claim["resultId"]}
    except NodeCancelledError:
        if not settling:
            api.complete_selected_rule_preparation(run_id, "CANCELLED", None, None)
        raise
    except Exception as error:
        rejected_output = isinstance(error, WorkerCallbackError) and error.status_code == 422
        if settling and not rejected_output:
            raise
        api.complete_selected_rule_preparation(run_id, "FAILED", None, "SELECTED_RULE_PREPARATION_FAILED")
        return {"state": "FAILED", "resultId": claim["resultId"]}
