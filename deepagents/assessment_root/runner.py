"""Run one execution of an assessment's Root: claim -> bind thread -> invoke -> settle execution."""

from __future__ import annotations

import contextlib
from dataclasses import replace
import threading
import traceback
import uuid
from typing import Any, Callable

from langchain_core.callbacks import BaseCallbackHandler
from langgraph.types import Command

from assessment_root.agent import create_assessment_root_agent
from assessment_root.client import AssessmentApiError, AssessmentRuntimeClient
from assessment_root.tools import RootRun, SearchTrace
from assessment_root.runtime_control import RootRuntimeControl
from middleware.usage_metering import active_agent_run_state, activate_agent_run_state
from orchestration.agent_stream import (
    active_agent_stream, AgentStreamSession, BufferedAgentStreamEmitter,
    activate_agent_stream, publish_agent_stream_event,
)
from orchestration.graph_execution import agent_graph_config
from tools.common.capabilities.platform.logging import get_logger

logger = get_logger(__name__)

# Execution states the runtime may report (values are API-owned; Python never derives lifecycle).
EXECUTION_SUCCEEDED = "SUCCEEDED"
EXECUTION_FAILED = "FAILED"
EXECUTION_INTERRUPTED = "INTERRUPTED"
EXECUTION_PAUSED = "PAUSED"

# Customer-safe activity label keys (catalog keys, never agent/provider text).
LABEL_TASK_STARTED = "assessment.activity.taskStarted"
LABEL_TASK_FINISHED = "assessment.activity.taskFinished"

_START_MESSAGE = (
    "Start (or resume) this assessment. Call get_assessment_context first, then work through "
    "every AssessmentRule of the pinned rule set."
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


@contextlib.contextmanager
def _root_telemetry(claim: dict[str, Any]):
    state = active_agent_run_state()
    parent = active_agent_stream.get()
    session = None
    if state is not None and state.api_client is not None and parent is not None:
        session = AgentStreamSession(
            assessment_id=claim["assessmentId"], run_id=claim["executionId"],
            correlation_id=parent.correlation_id, boundary_name=parent.boundary_name,
            emit_payload=BufferedAgentStreamEmitter(
                lambda payload: state.api_client.post_agent_stream_event(
                    payload, lease_token=claim["leaseToken"],
                ),
            ),
        )
    with activate_agent_run_state(replace(state, run_id=claim["executionId"]) if state else None), activate_agent_stream(session):
        publish_agent_stream_event("BOUNDARY_STARTED", status="RUNNING")
        try:
            yield
        except Exception as error:
            publish_agent_stream_event("BOUNDARY_FAILED", status="FAILED", data={"exception_type": type(error).__name__})
            raise
        else:
            publish_agent_stream_event("BOUNDARY_COMPLETED", status="COMPLETED")


def run_assessment_root(
    client: AssessmentRuntimeClient,
    assessment_id: str,
    *,
    backend_factory: BackendFactory,
    model: Any | None = None,
    checkpointer: Any | None = None,
    store: Any | None = None,
    governance: Any | None = None,
    extra_callbacks: list[Any] | None = None,
) -> dict[str, Any]:
    """Business purpose: Investigate one customer assessment on its server-owned durable thread.

    Business rules:
    - Claim authority owns execution identity; a concurrent held lease cannot start duplicate work.
    - Resume native pending work only when the claim binds its exact checkpoint, or when an existing
      server-authorized transport or human-wait recovery applies; an unbound checkpoint is rejected.
    - A leased human-wait recovery with an open server request may replay unfinished native work
      to persist its interrupt after the human-request side effect committed before a crash.
    - A failed execution resumes under a new execution identity on the same thread, and success
      requires authoritative COMPLETE.
    - With a checkpointer, persist each superstep before advancing so queued checkpoint puts
      cannot exhaust the executor while waiting for delta writes scheduled by later steps.
    Execution flow:
    1. Claim the execution and load its pinned context under the failure/cleanup boundary.
    2. Hydrate the pinned repository, verify checkpoint binding, and invoke or resume the graph
       with synchronous checkpoint durability before advancing to another step.
    3. Settle success, a durable human/control interrupt, or failure through the runtime API, retaining
       only a server-bound checkpoint or one created by this execution.
    Failure cases:
    - Context, hydration, checkpoint and model failures settle FAILED; pending work with no matching
      server checkpoint authorization is not invoked, and missing decisions cannot become success.
    Side effects:
    - Renews the execution lease, runs governed evidence/decision tools and persists an eligible checkpoint
      with the execution settlement.
    """
    claim = client.claim(assessment_id)
    if claim.get("lifecycleState") == "COMPLETE":
        # Finalization already committed before the crash; only settle its execution acknowledgement.
        client.finish(EXECUTION_SUCCEEDED)
        return {"state": EXECUTION_SUCCEEDED, "executionId": claim["executionId"], "threadId": claim["threadId"], "errorType": None, "checkpointId": None}

    heartbeat_stop = threading.Event()

    def _heartbeat_worker() -> None:
        """Business purpose: Keep the claimed Root execution lease alive while its investigation is running.

        Business rules:
        - Renew only this client’s current execution; the shared stop event ends renewal when the run settles.
        Execution flow:
        1. Wait for the heartbeat interval while watching the stop event.
        2. Attempt to renew the existing execution lease and continue until cleanup signals stop.
        Failure cases:
        - Transient heartbeat failures are best effort; the API remains authoritative for lease and recovery decisions.
        Side effects:
        - Sends heartbeat requests; does not create another execution, model call or decision.
        """
        while not heartbeat_stop.wait(60.0):
            try:
                client.heartbeat()
            except Exception:
                pass

    heartbeat_thread = threading.Thread(target=_heartbeat_worker, daemon=True)
    heartbeat_thread.start()

    final_state = EXECUTION_FAILED
    error_type: str | None = None
    run: RootRun | None = None
    agent: Any | None = None
    graph_config: dict[str, Any] | None = None
    checkpoint_id: str | None = None
    starting_checkpoint_id: str | None = None
    checkpoint_authorized = False
    graph_invoke_started = False
    request_ids: list[str] | None = None
    control_request_id: str | None = None
    try:
        context = client.context()
        # The factory hydrates the pinned repository for THIS thread and returns the backend
        from orchestration.context import LCSPRunContext, resolve_response_language

        response_language = resolve_response_language(
            context.get("responseLanguage")
            or context.get("locale")
            or claim.get("locale")
            or claim.get("responseLanguage")
        )
        backend, activation = backend_factory(claim, context)
        run = RootRun(
            client=client,
            assessment_id=assessment_id,
            thread_id=claim["threadId"],
            execution_id=claim["executionId"],
            backend=backend,
            response_language=response_language,
        )
        run.adopt_context(context)
        agent = create_assessment_root_agent(
            run=run,
            model=model,
            checkpointer=checkpointer,
            store=store,
            governance=governance,
            middleware=[RootRuntimeControl(client, run.execution_id)],
        )
        graph_config = agent_graph_config({
            "configurable": {"thread_id": run.thread_id},
            "metadata": {"assessment_id": assessment_id, "assessment_root_execution_id": run.execution_id,
                         "rule_set_version_id": run.pins["ruleSetVersionId"],
                         "repository_snapshot_id": run.pins["repositorySnapshotId"],
                         "repository_commit": run.pins["repositoryCommit"], "case_revision": run.case_revision},
            "callbacks": [run.trace, TaskLineage(client, run.execution_id), *(extra_callbacks or [])],
        })
        run_context = LCSPRunContext(
            assessment_id=assessment_id,
            thread_id=run.thread_id,
            response_language=response_language,
        )
        with activation or contextlib.nullcontext(), _root_telemetry(claim):
            packet: Any = {"messages": [{"role": "user", "content": _START_MESSAGE}]}
            if checkpointer is not None:
                saved = agent.get_state(graph_config)
                expected = claim.get("resumeCheckpointId")
                actual = saved.config.get("configurable", {}).get("checkpoint_id") if saved.config else None
                starting_checkpoint_id = actual if isinstance(actual, str) else None
                pending = [item for task in saved.tasks for item in task.interrupts]
                control_wait = [item for item in pending if "controlRequestId" in item.value]
                recovered = claim.get("recoveredExecution", False)
                human_wait_recovery = (
                    claim.get("lifecycleState", context.get("lifecycleState"))
                    in {"WAITING_FOR_HUMAN", "BLOCKED"}
                    and bool(context["openHumanRequestIds"])
                    and bool(pending or saved.next)
                )
                if expected and actual != expected and (not recovered or (pending and not control_wait)):
                    raise RuntimeError("server checkpoint binding does not match native Root checkpoint")
                if actual and expected is None and not recovered and not human_wait_recovery:
                    raise RuntimeError("native Root checkpoint has no server checkpoint authorization")
                checkpoint_authorized = (
                    (expected is not None and actual == expected)
                    or bool(recovered)
                    or human_wait_recovery
                )
                if (pending or saved.next) and not actual:
                    raise RuntimeError("native pending work has no checkpoint identity")
                if control_wait and (not expected or recovered):
                    if not checkpoint_authorized:
                        raise RuntimeError("native Stop checkpoint lacks server authorization")
                    if len(control_wait) != 1 or control_wait[0].value["targetExecutionId"] != run.execution_id:
                        raise RuntimeError("native Stop checkpoint does not match server execution")
                    checkpoint_id = actual
                    control_request_id = control_wait[0].value["controlRequestId"]
                    final_state = EXECUTION_PAUSED
                elif pending and context["openHumanRequestIds"]:
                    # Crash after native persistence but before API settlement: bind the durable
                    # interrupt without running/resuming blocked graph work.
                    if not checkpoint_authorized:
                        raise RuntimeError("human interrupt checkpoint lacks server authorization")
                    checkpoint_id = actual
                    request_ids = sorted({request_id for item in pending for request_id in item.value["requestIds"]})
                    final_state = EXECUTION_INTERRUPTED
                elif pending:
                    if not checkpoint_authorized:
                        raise RuntimeError("human resume lacks server checkpoint authorization")
                    packet = Command(resume={item.id: {"resolved": True} for item in pending})
                elif saved.next:
                    # A killed worker resumes native pending work rather than adding a new turn.
                    if not checkpoint_authorized:
                        raise RuntimeError("server checkpoint binding missing for native pending work")
                    packet = None
            if final_state not in {EXECUTION_INTERRUPTED, EXECUTION_PAUSED}:
                graph_invoke_started = True
                output = agent.invoke(
                    packet,
                    config=graph_config,
                    context=run_context,
                    durability="sync" if checkpointer is not None else None,
                )
                interrupts = output.get("__interrupt__", ())
                if interrupts:
                    saved = agent.get_state(graph_config)
                    checkpoint_id = saved.config["configurable"]["checkpoint_id"]
                    controls = [item for item in interrupts if "controlRequestId" in item.value]
                    if controls:
                        if len(controls) != 1 or controls[0].value["targetExecutionId"] != run.execution_id:
                            raise RuntimeError("native Stop checkpoint does not match server execution")
                        control_request_id = controls[0].value["controlRequestId"]
                        final_state = EXECUTION_PAUSED
                    else:
                        request_ids = sorted({request_id for item in interrupts for request_id in item.value["requestIds"]})
                        final_state = EXECUTION_INTERRUPTED
                else:
                    terminal = client.context()
                    if terminal["openHumanRequestIds"]:
                        raise RuntimeError("open human blockers without a native interrupt")
                    if terminal["lifecycleState"] != "COMPLETE":
                        raise RuntimeError("Root graph ended before authoritative assessment COMPLETE")
                    final_state = EXECUTION_SUCCEEDED
    except Exception as error:  # noqa: BLE001 - settled as an execution failure below
        final_state = EXECUTION_FAILED
        error_type = type(error).__name__
        if (
            checkpointer is not None
            and agent is not None
            and graph_config is not None
            and (checkpoint_authorized or graph_invoke_started)
        ):
            try:
                saved = agent.get_state(graph_config)
                current = (
                    saved.config.get("configurable", {}).get("checkpoint_id")
                    if saved.config
                    else None
                )
                if isinstance(current, str) and current and (
                    checkpoint_authorized
                    or current != starting_checkpoint_id
                ):
                    checkpoint_id = current
            except Exception as checkpoint_error:  # preserve the original run failure
                logger.warning(
                    "ASSESSMENT_ROOT_FAILURE_CHECKPOINT_CAPTURE_FAILED",
                    error_type=type(checkpoint_error).__name__,
                    assessment_id=assessment_id,
                )
        logger.error(
            "ASSESSMENT_ROOT_RUN_FAILED",
            error_type=error_type,
            error_message=str(error)[:300],
            assessment_id=assessment_id,
            # Plain frames only: a rich traceback would print local variables such as the lease token.
            error_traceback="".join(traceback.format_exception(error))[-2500:],
        )
    finally:
        heartbeat_stop.set()
    if final_state == EXECUTION_INTERRUPTED:
        client.finish(final_state, checkpoint_id=checkpoint_id, request_ids=request_ids)
    elif final_state == EXECUTION_PAUSED:
        client.finish(final_state, checkpoint_id=checkpoint_id, control_request_id=control_request_id)
    elif final_state == EXECUTION_FAILED and checkpoint_id:
        client.finish(final_state, checkpoint_id=checkpoint_id)
    else:
        client.finish(final_state)
    return {
        "state": final_state,
        "executionId": claim["executionId"],
        "threadId": claim["threadId"],
        "errorType": error_type,
        "checkpointId": checkpoint_id,
    }
