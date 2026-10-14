"""Run one claimed Rule Set Preparation: claim -> read pinned legal_source -> author -> submit."""

from __future__ import annotations

import contextvars
import json
import re
import tempfile
import threading
from pathlib import Path
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.runnables.config import var_child_runnable_config
from langgraph.errors import GraphRecursionError
from orchestration.agent_stream import publish_agent_stream_event
from orchestration.graph_execution import agent_graph_config
from tools.common.capabilities.platform.api_client import WorkerCallbackError
from tools.common.capabilities.platform.logging import get_logger

from rule_set_preparation.agent import create_rule_set_preparation_agent
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

_ACTIVITY_TOOLS = frozenset(
    {
        "ls",
        "glob",
        "grep",
        "read_file",
        "task",
        "validate_compliance_rule_set",
        "submit_compliance_rule_set",
        "report_rule_set_source_blocked",
    }
)
_SOURCE_PATH_RE = re.compile(r"/legal-source/[A-Za-z0-9._/-]{1,200}")


class PreparationStreamTrace(BaseCallbackHandler):
    """Project native tool callbacks into the existing redacted agent stream."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._names: dict[str, str] = {}
        self._subagent_names: dict[str, str] = {}

    def on_tool_start(
        self,
        serialized,
        input_str,
        *,
        run_id,
        parent_run_id=None,
        inputs=None,
        **kwargs,
    ):
        serialized_name = serialized.get("name") if isinstance(serialized, dict) else None
        name = serialized_name or kwargs.get("name")
        if name not in _ACTIVITY_TOOLS:
            return
        native_run_id = str(run_id)
        with self._lock:
            parent_subagent = self._subagent_names.get(str(parent_run_id))
            self._names[native_run_id] = name
        args = inputs if isinstance(inputs, dict) else {}
        data: dict[str, Any] = {"native_tool": name}
        if name == "task":
            subagent = args.get("subagent_type")
            if isinstance(subagent, str) and subagent.strip():
                data["subagent_type"] = subagent.strip()[:120]
                with self._lock:
                    self._subagent_names[native_run_id] = subagent.strip()[:120]
            description = args.get("description")
            if isinstance(description, str):
                source_path = _SOURCE_PATH_RE.search(description)
                if source_path:
                    data["source_path"] = source_path.group(0)
        elif name in {"read_file", "grep", "glob", "ls"}:
            data["scope"] = "/legal-source"
            if parent_subagent:
                data["subagent_type"] = parent_subagent
            path_value = args.get("file_path") or args.get("path")
            if isinstance(path_value, str):
                source_path = _SOURCE_PATH_RE.search(path_value)
                if source_path:
                    data["source_path"] = source_path.group(0)
        publish_agent_stream_event(
            "SEMANTIC_TOOL_CALL",
            tool_name=name,
            tool_call_id=native_run_id,
            subagent_name=data.get("subagent_type") or parent_subagent,
            status="RUNNING",
            data=data,
        )

    def on_tool_end(self, output, *, run_id, **kwargs):
        with self._lock:
            name = self._names.pop(str(run_id), None)
            subagent = self._subagent_names.pop(str(run_id), None)
        if name not in _ACTIVITY_TOOLS:
            return
        data: dict[str, Any] = {"native_tool": name}
        if subagent:
            data["subagent_type"] = subagent
        content = getattr(output, "content", output)
        if isinstance(content, str):
            try:
                result = json.loads(content)
            except (TypeError, ValueError):
                result = None
            if isinstance(result, dict) and isinstance(result.get("outcome"), str):
                data["outcome"] = result["outcome"]
        publish_agent_stream_event(
            "TOOL_RESULT",
            tool_name=name,
            tool_call_id=str(run_id),
            subagent_name=subagent,
            status="COMPLETED",
            data=data,
        )

    def on_tool_error(self, error, *, run_id, **kwargs):
        with self._lock:
            name = self._names.pop(str(run_id), None)
            subagent = self._subagent_names.pop(str(run_id), None)
        if name not in _ACTIVITY_TOOLS:
            return
        data = {"native_tool": name, "error_type": type(error).__name__}
        if subagent:
            data["subagent_type"] = subagent
        publish_agent_stream_event(
            "TOOL_RESULT",
            tool_name=name,
            tool_call_id=str(run_id),
            subagent_name=subagent,
            status="FAILED",
            data=data,
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
    explicitly reported a blocked source or encountered a model/runtime/legal-source error.
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
    except Exception:  # noqa: BLE001 - unavailable source is a terminal worker outcome
        _fail(api, run_id, SOURCE_VERSION_UNAVAILABLE)
        return {"state": "FAILED", "submission": None, "failureReason": SOURCE_VERSION_UNAVAILABLE}

    context = RuleSetPreparationContext(run_id=run_id, api=api)
    with tempfile.TemporaryDirectory(prefix="lcsp-rule-set-preparation-") as scratch:
        root = work_dir or Path(scratch)
        try:
            materialize_legal_source(bundle, root)
            context.source_root = root
            publish_agent_stream_event(
                "CUSTOM_PROGRESS",
                status="RUNNING",
                data={
                    "activity_kind": "SOURCE_MATERIALIZED",
                    "source_chunk_count": len(bundle.get("chunks", []))
                    if isinstance(bundle, dict)
                    else None,
                },
            )
            agent = create_rule_set_preparation_agent(
                context=context, legal_source_root=root, model=model
            )
            stream_trace = PreparationStreamTrace()
            # An independent graph, not a subgraph of the Agent Server run: inheriting that run's
            # runnable config would make the agent and every legal-source-reader child write
            # checkpoints into its Postgres saver, which nothing resumes from (see agent.py).
            isolated = contextvars.copy_context()
            isolated.run(var_child_runnable_config.set, None)
            isolated.run(
                agent.invoke,
                {"messages": [{"role": "user", "content": _TASK}]},
                config=agent_graph_config(
                    {"callbacks": [*(callbacks or []), stream_trace]}
                ),
            )
        except Exception as error:  # noqa: BLE001 - classify provider/runtime failures
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
        reason = NO_SUBMISSION if context.source_blocked is not None else RUNTIME_ERROR
        _fail(api, run_id, reason)
        logger.warning("RULE_SET_PREPARATION_WITHOUT_SUBMISSION", run_id=run_id,
                       failure_reason=reason,
                       source_blocked=context.source_blocked,
                       validation_calls=context.validation_calls,
                       validation_outcome=(context.last_validation or {}).get("outcome"),
                       submission_attempted=any(t.get("tool") == "submit" for t in context.trace))
        return {"state": "FAILED", "submission": None, "failureReason": reason, "trace": context.trace}
    outcome = context.submission.get("validation", {}).get("outcome")
    return {
        "state": "SUCCEEDED" if outcome == "PASSED" else "FAILED",
        "submission": context.submission,
        "failureReason": None if outcome == "PASSED" else "RULE_SET_VALIDATION_FAILED",
    }


def _fail(api: Any, run_id: str, reason: str) -> None:
    try:
        api.fail_rule_set_preparation(run_id, reason)
    except Exception:  # noqa: BLE001,S110 - failure reporting is best effort
        # The run stays RUNNING; the caller's retry/reconciliation sees the same state.
        pass
