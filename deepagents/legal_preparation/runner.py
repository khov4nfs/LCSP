"""Run one claimed Legal Preparation: claim -> read pinned corpus -> author -> submit."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

from legal_preparation.agent import create_legal_preparation_agent
from tools.common.capabilities.platform.logging import get_logger
from legal_preparation.corpus_files import materialize_corpus
from legal_preparation.tools import LegalPreparationContext

# Reasons mirror packages/contracts LEGAL_PREPARATION_FAILURE_REASONS.
NO_SUBMISSION = "NO_SUBMISSION"
MODEL_ERROR = "MODEL_ERROR"
CORPUS_UNAVAILABLE = "CORPUS_UNAVAILABLE"
RUNTIME_ERROR = "RUNTIME_ERROR"

logger = get_logger(__name__)

_TASK = (
    "Prepare the complete legal portfolio for the pinned corpus. Read /corpus/INDEX.md first, "
    "author the LegalRules, EngineeringRules and context relations, validate until the packet "
    "passes, then submit it once."
)


def run_legal_preparation(
    api: Any,
    run_id: str,
    *,
    model: Any | None = None,
    work_dir: Path | None = None,
    recursion_limit: int = 150,
    callbacks: list[Any] | None = None,
) -> dict[str, Any]:
    """Execute one run and return ``{"state": ..., "submission": ..., "failureReason": ...}``.

    The API owns every state transition: an activated or invalid submission is recorded by
    the submit transaction itself; this function records ``FAILED`` only when the agent
    produced no submission (model/runtime/corpus error).
    """
    try:
        bundle = api.claim_legal_preparation(run_id)
    except Exception:
        _fail(api, run_id, CORPUS_UNAVAILABLE)
        return {"state": "FAILED", "submission": None, "failureReason": CORPUS_UNAVAILABLE}

    context = LegalPreparationContext(run_id=run_id, api=api)
    with tempfile.TemporaryDirectory(prefix="lcsp-legal-preparation-") as scratch:
        root = work_dir or Path(scratch)
        try:
            materialize_corpus(bundle, root)
            agent = create_legal_preparation_agent(
                context=context, corpus_root=root, model=model
            )
            agent.invoke(
                {"messages": [{"role": "user", "content": _TASK}]},
                config={"recursion_limit": recursion_limit, "callbacks": callbacks or []},
            )
        except Exception as error:  # noqa: BLE001
            logger.warning(
                "LEGAL_PREPARATION_AGENT_FAILED",
                run_id=run_id,
                error_type=type(error).__name__,
                error_message=str(error)[:500],
            )
            if context.submission is None:
                _fail(api, run_id, MODEL_ERROR)
                return {
                    "state": "FAILED",
                    "submission": None,
                    "failureReason": MODEL_ERROR,
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
        "failureReason": None if outcome == "PASSED" else "PORTFOLIO_VALIDATION_FAILED",
    }


def _fail(api: Any, run_id: str, reason: str) -> None:
    try:
        api.fail_legal_preparation(run_id, reason)
    except Exception:
        # The run stays RUNNING; the caller's retry/reconciliation sees the same state.
        pass
