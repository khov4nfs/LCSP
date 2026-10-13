"""Run one claimed Rule Set Preparation: claim -> read pinned legal_source -> author -> submit."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

from langgraph.errors import GraphRecursionError

from orchestration.graph_execution import agent_graph_config
from rule_set_preparation.agent import create_rule_set_preparation_agent
from tools.common.capabilities.platform.api_client import WorkerCallbackError
from tools.common.capabilities.platform.logging import get_logger
from rule_set_preparation.legal_source_files import materialize_legal_source
from rule_set_preparation.tools import RuleSetPreparationContext

# Reasons mirror packages/contracts RULE_SET_PREPARATION_FAILURE_REASONS.
NO_SUBMISSION = "NO_SUBMISSION"
MODEL_ERROR = "MODEL_ERROR"
SOURCE_VERSION_UNAVAILABLE = "SOURCE_VERSION_UNAVAILABLE"
RUNTIME_ERROR = "RUNTIME_ERROR"

HTTP_CONFLICT = 409

logger = get_logger(__name__)

_TASK = (
    "Prepare the complete compliance rule set for the pinned Legal Source. Read /legal-source/INDEX.md first, "
    "author the LegalRequirements, AssessmentRules and context relations, validate until the packet "
    "passes, then submit it once."
)


def run_rule_set_preparation(
    api: Any,
    run_id: str,
    *,
    model: Any | None = None,
    work_dir: Path | None = None,
    callbacks: list[Any] | None = None,
) -> dict[str, Any]:
    """Execute one run and return ``{"state": ..., "submission": ..., "failureReason": ...}``.

    The API owns every state transition: an activated or invalid submission is recorded by
    the submit transaction itself; this function records ``FAILED`` only when the agent
    produced no submission (model/runtime/legal-source error).
    """
    try:
        bundle = api.claim_rule_set_preparation(run_id)
    except WorkerCallbackError as error:
        if error.status_code == HTTP_CONFLICT:
            # A duplicated or redelivered command: the run is already claimed (or finished). The
            # claim is the single paid-run gate, so this delivery stops here and records nothing.
            logger.info("RULE_SET_PREPARATION_ALREADY_CLAIMED", run_id=run_id)
            return {"state": "ALREADY_CLAIMED", "submission": None, "failureReason": None}
        _fail(api, run_id, SOURCE_VERSION_UNAVAILABLE)
        return {"state": "FAILED", "submission": None, "failureReason": SOURCE_VERSION_UNAVAILABLE}
    except Exception:
        _fail(api, run_id, SOURCE_VERSION_UNAVAILABLE)
        return {"state": "FAILED", "submission": None, "failureReason": SOURCE_VERSION_UNAVAILABLE}

    context = RuleSetPreparationContext(run_id=run_id, api=api)
    with tempfile.TemporaryDirectory(prefix="lcsp-rule-set-preparation-") as scratch:
        root = work_dir or Path(scratch)
        try:
            materialize_legal_source(bundle, root)
            agent = create_rule_set_preparation_agent(
                context=context, legal_source_root=root, model=model
            )
            agent.invoke(
                {"messages": [{"role": "user", "content": _TASK}]},
                config=agent_graph_config({"callbacks": callbacks or []}),
            )
        except Exception as error:  # noqa: BLE001
            logger.warning(
                "RULE_SET_PREPARATION_AGENT_FAILED",
                run_id=run_id,
                error_type=type(error).__name__,
                error_message=str(error)[:500],
            )
            if context.submission is None:
                reason = RUNTIME_ERROR if isinstance(error, GraphRecursionError) else MODEL_ERROR
                _fail(api, run_id, reason)
                return {
                    "state": "FAILED",
                    "submission": None,
                    "failureReason": reason,
                    "error": {"type": type(error).__name__, "message": str(error)[:300]},
                    "trace": context.trace,
                }

    if context.submission is None:
        _fail(api, run_id, NO_SUBMISSION)
        return {"state": "FAILED", "submission": None, "failureReason": NO_SUBMISSION, "trace": context.trace}
    outcome = context.submission.get("validation", {}).get("outcome")
    return {
        "state": "SUCCEEDED" if outcome == "PASSED" else "FAILED",
        "submission": context.submission,
        "failureReason": None if outcome == "PASSED" else "RULE_SET_VALIDATION_FAILED",
    }


def _fail(api: Any, run_id: str, reason: str) -> None:
    try:
        api.fail_rule_set_preparation(run_id, reason)
    except Exception:
        # The run stays RUNNING; the caller's retry/reconciliation sees the same state.
        pass
