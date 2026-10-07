"""Run one execution of an assessment's Root: claim -> bind thread -> invoke -> settle execution."""

from __future__ import annotations

import contextlib
import uuid
from typing import Any, Callable

from langchain_core.callbacks import BaseCallbackHandler
from langgraph.types import Command

from assessment_root.agent import create_assessment_root_agent
from assessment_root.client import AssessmentApiError, AssessmentRuntimeClient
from assessment_root.tools import RootRun, SearchTrace
from tools.common.capabilities.platform.logging import get_logger

logger = get_logger(__name__)

# Execution states the runtime may report (values are API-owned; Python never derives lifecycle).
EXECUTION_SUCCEEDED = "SUCCEEDED"
EXECUTION_FAILED = "FAILED"
EXECUTION_INTERRUPTED = "INTERRUPTED"

# Customer-safe activity label keys (catalog keys, never agent/provider text).
LABEL_TASK_STARTED = "assessment.activity.taskStarted"
LABEL_TASK_FINISHED = "assessment.activity.taskFinished"

_START_MESSAGE = (
    "Start (or resume) this assessment. Call get_assessment_context first, then work through "
    "every EngineeringRule of the pinned portfolio."
)


class TaskLineage(BaseCallbackHandler):
    """Reports native ``task()`` delegations as SUBAGENT activity with execution lineage.

    Each delegated task gets its own execution ID under the Root execution; the API checks the
    parent against the Root's lease and derives thread/actor/sequence itself.
    """

    def __init__(self, client: AssessmentRuntimeClient, root_execution_id: str) -> None:
        self._client = client
        self._root = root_execution_id
        self._tasks: dict[str, tuple[str, str]] = {}

    def _emit(self, execution_id: str, task_id: str, label: str) -> None:
        try:
            self._client.post_activity(
                {
                    "executionId": execution_id,
                    "parentExecutionId": self._root,
                    "taskId": task_id,
                    "actorType": "SUBAGENT",
                    "kind": "TASK",
                    "labelKey": label,
                }
            )
        except AssessmentApiError as error:  # activity is best-effort observability
            logger.warning("ASSESSMENT_TASK_ACTIVITY_REJECTED", code=error.code)

    def on_tool_start(self, serialized, input_str, *, run_id, **kwargs):  # noqa: ANN001
        if (serialized or {}).get("name") != "task":
            return
        child = str(uuid.uuid4())
        task_id = str(kwargs.get("tool_call_id") or run_id)[:200]
        self._tasks[str(run_id)] = (child, task_id)
        self._emit(child, task_id, LABEL_TASK_STARTED)

    def on_tool_end(self, output, *, run_id, **kwargs):  # noqa: ANN001
        entry = self._tasks.pop(str(run_id), None)
        if entry:
            self._emit(entry[0], entry[1], LABEL_TASK_FINISHED)

    def on_tool_error(self, error, *, run_id, **kwargs):  # noqa: ANN001
        self.on_tool_end(None, run_id=run_id)


BackendFactory = Callable[[dict[str, Any], dict[str, Any]], tuple[Any, Any]]


def run_assessment_root(
    client: AssessmentRuntimeClient,
    assessment_id: str,
    *,
    backend_factory: BackendFactory,
    model: Any | None = None,
    checkpointer: Any | None = None,
    governance: Any | None = None,
    recursion_limit: int = 200,
    extra_callbacks: list[Any] | None = None,
) -> dict[str, Any]:
    """Execute one Root run on the assessment's server-owned thread.

    A replayed or concurrent claim fails (lease held) and the run is skipped; an expired lease is
    reclaimed under a NEW execution ID on the SAME thread, so the checkpoint continues.
    """
    claim = client.claim(assessment_id)
    context = client.context()
    final_state = EXECUTION_SUCCEEDED
    error_type: str | None = None
    run: RootRun | None = None
    checkpoint_id: str | None = None
    request_ids: list[str] | None = None
    try:
        # The factory hydrates the pinned repository for THIS thread and returns the backend
        # plus the context manager that exposes it to nested agents/graph tools.
        backend, activation = backend_factory(claim, context)
        run = RootRun(
            client=client,
            assessment_id=assessment_id,
            thread_id=claim["threadId"],
            execution_id=claim["executionId"],
            backend=backend,
        )
        run.adopt_context(context)
        agent = create_assessment_root_agent(
            run=run,
            model=model,
            checkpointer=checkpointer,
            governance=governance,
        )
        config = {
            "configurable": {"thread_id": run.thread_id},
            "recursion_limit": recursion_limit,
            "callbacks": [run.trace, TaskLineage(client, run.execution_id), *(extra_callbacks or [])],
        }
        with activation or contextlib.nullcontext():
            packet: Any = {"messages": [{"role": "user", "content": _START_MESSAGE}]}
            if checkpointer is not None:
                saved = agent.get_state(config)
                expected = claim.get("resumeCheckpointId")
                actual = saved.config.get("configurable", {}).get("checkpoint_id") if saved.config else None
                if expected and actual != expected:
                    raise RuntimeError("server checkpoint binding does not match native Root checkpoint")
                pending = [item for task in saved.tasks for item in task.interrupts]
                if pending and context["openHumanRequestIds"]:
                    # Crash after native persistence but before API settlement: bind the durable
                    # interrupt without running/resuming blocked graph work.
                    checkpoint_id = actual
                    request_ids = sorted({request_id for item in pending for request_id in item.value["requestIds"]})
                    final_state = EXECUTION_INTERRUPTED
                elif pending:
                    if not expected:
                        raise RuntimeError("human resume lacks server checkpoint authorization")
                    packet = Command(resume={item.id: {"resolved": True} for item in pending})
                elif saved.next:
                    # A killed worker resumes native pending work rather than adding a new turn.
                    packet = None
            if final_state != EXECUTION_INTERRUPTED:
                output = agent.invoke(packet, config=config)
                interrupts = output.get("__interrupt__", ())
                if interrupts:
                    saved = agent.get_state(config)
                    checkpoint_id = saved.config["configurable"]["checkpoint_id"]
                    request_ids = sorted({request_id for item in interrupts for request_id in item.value["requestIds"]})
                    final_state = EXECUTION_INTERRUPTED
                elif client.context()["openHumanRequestIds"]:
                    raise RuntimeError("open human blockers without a native interrupt")
    except Exception as error:  # noqa: BLE001 - settled as an execution failure below
        final_state = EXECUTION_FAILED
        error_type = type(error).__name__
        logger.error("ASSESSMENT_ROOT_RUN_FAILED", error_type=error_type, assessment_id=assessment_id)
    if final_state == EXECUTION_INTERRUPTED:
        client.finish(final_state, checkpoint_id=checkpoint_id, request_ids=request_ids)
    else:
        client.finish(final_state)
    return {
        "state": final_state,
        "executionId": claim["executionId"],
        "threadId": claim["threadId"],
        "errorType": error_type,
        "checkpointId": checkpoint_id,
    }
