"""Run one execution of an assessment's Root: claim -> bind thread -> invoke -> settle execution."""

from __future__ import annotations

import contextlib
from dataclasses import replace
import threading
import traceback
import uuid
from typing import Any, Callable

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import AIMessage
from langgraph.types import Command

from assessment_root.agent import create_assessment_root_agent
from evals.run_manifest import save_runtime_manifest, settle_runtime_manifest
from pathlib import Path
import os
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


class NativeRootRecoveryRequired(RuntimeError):
    """Unfinished crash recovery requires operator consent before any uncertain model/tool step is repeated."""

# Customer-safe activity label keys (catalog keys, never agent/provider text).
LABEL_TASK_STARTED = "assessment.activity.taskStarted"
LABEL_TASK_FINISHED = "assessment.activity.taskFinished"

_START_MESSAGE = (
    "Start (or resume) this assessment. Call get_assessment_context first, then work through "
    "only the AssessmentRules in the current authorized audit request."
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



def _blocked_wait_tool_replay_allowed(saved: Any, context: dict[str, Any]) -> bool:
    """Business purpose: Repair a committed unavailability report whose native wait was not persisted.

    Business rules:
    - BLOCKED recovery may replay only existing-request unavailability reports or the governed wait tool.
    - The saved next node must be tools, and every saved call must reference current open dependencies.
    - Replay receives a static stop before model invocation; no new investigation or question is authorized.
    Execution flow:
    1. Check the blocked lifecycle and exclusive native tool-node continuation.
    2. Inspect saved assistant calls and validate their bounded existing-request arguments.
    3. Return whether tool-only recovery may proceed after checkpoint ancestry authorization.
    Failure cases:
    - Missing messages, foreign requests, other tools, malformed arguments or mixed node work returns false.
    Side effects:
    - Pure checkpoint inspection; creates no model call, report, fact, question or lifecycle transition.
    """
    if (context["lifecycleState"] != "BLOCKED" or tuple(saved.next) != ("tools",)
            or not saved.tasks or any(task.name != "tools" for task in saved.tasks)):
        return False
    messages = (saved.values or {}).get("messages", [])
    response = messages[-1] if messages else None
    if not isinstance(response, AIMessage) or not response.tool_calls:
        return False
    request_ids = set(context["openHumanRequestIds"])
    for call in response.tool_calls:
        args = call.get("args")
        if not isinstance(args, dict):
            return False
        if call.get("name") == "wait_for_human_requests":
            if args:
                return False
        elif call.get("name") == "report_existing_human_fact_unresolvable":
            if (set(args) != {"request_id", "unavailability_rationale", "evidence_ids"}
                    or args["request_id"] not in request_ids
                    or not isinstance(args["unavailability_rationale"], str)
                    or not args["unavailability_rationale"].strip()
                    or not isinstance(args["evidence_ids"], list) or not args["evidence_ids"]
                    or any(not isinstance(value, str) or not value for value in args["evidence_ids"])):
                return False
        else:
            return False
    return True


def _review_checkpoint_recovery_authorized(agent: Any, saved: Any, claim: dict[str, Any],
                                          context: dict[str, Any], run: RootRun) -> bool:
    """Business purpose: Recover native work or a committed wait after an authorized unknown-answer review fails.

    Business rules:
    - A failed retry may continue only its exact server-bound checkpoint and API-identified prior producer.
    - A newer unsettled wait requires same-execution recovery and matching producer metadata until the server-bound checkpoint.
    - Open dependencies retain their original unknown answer, revision and absence of a resolved fact.
    - The ancestry matches the exact selected-audit checkpoint thread, audit identity and source pins.
    - Only the original wait may predate unrelated accepted facts; legacy checkpoints retain an absent audit identity.
    - BLOCKED unfinished work permits only existing-report/wait calls with a static stop before model invocation.
    Execution flow:
    1. Validate persisted review authority, current audit/thread binding, open dependencies and pending-work shape.
    2. Match the server-bound checkpoint producer and any newer recovered execution checkpoints.
    3. Follow at most sixty-four native snapshots to prove ancestry to the original review checkpoint.
    Failure cases:
    - Missing authority, changed revisions, foreign provenance, unrelated ancestry or a bounded-history miss returns false.
    Side effects:
    - Read-only checkpoint retrieval; permits settlement of pending waits or explicitly authorized unfinished review replay.
    """
    authorized = claim.get("humanAnswerReviewCheckpointId")
    expected = claim.get("resumeCheckpointId")
    actual = (saved.config or {}).get("configurable", {}).get("checkpoint_id")
    if (not isinstance(authorized, str) or not authorized or not isinstance(expected, str) or not expected
            or not isinstance(actual, str) or context["lifecycleState"] not in {"WAITING_FOR_HUMAN", "BLOCKED"}):
        return False
    exact_bound_retry = actual == expected and expected != authorized
    unsettled_wait = actual != expected and claim.get("recoveredExecution") is True
    if not exact_bound_retry and not unsettled_wait:
        return False
    request_ids = set(context["openHumanRequestIds"])
    pending = [item for task in saved.tasks for item in task.interrupts]
    if not request_ids or any("controlRequestId" in item.value for item in pending):
        return False
    if pending:
        if any(not isinstance(item.value.get("requestIds"), list) for item in pending):
            return False
        if {request_id for item in pending for request_id in item.value["requestIds"]} != request_ids:
            return False
    elif not saved.next:
        return False
    elif context["lifecycleState"] == "BLOCKED":
        if not _blocked_wait_tool_replay_allowed(saved, context):
            return False
    elif not exact_bound_retry or claim.get("humanAnswerReviewRequired") is not True:
        return False
    rows = {row["requestId"]: row for row in context.get("humanRequests", [])}
    for request_id in request_ids:
        row = rows.get(request_id)
        answers = row.get("answers", []) if row else []
        latest = answers[-1] if answers else {}
        if (not row or row.get("status") != "OPEN" or row.get("resolvedFactId") is not None
                or row.get("checkpointId") != authorized or latest.get("checkpointId") != authorized
                or latest.get("doesNotKnow") is not True or latest.get("answer") is not None
                or latest.get("requestRevision") != row.get("requestRevision")):
            return False
    prior_producer = claim.get("humanAnswerReviewExecutionId")
    if expected != authorized and (not isinstance(prior_producer, str) or not prior_producer):
        return False
    audit_request_id = (run.audit_request or {}).get("requestId")
    checkpoint_thread_id = claim.get("checkpointThreadId", run.thread_id)
    if checkpoint_thread_id != (audit_request_id or run.thread_id):
        return False
    provenance = {"assessment_id": run.assessment_id, "assessment_root_audit_request_id": audit_request_id,
                  "rule_set_version_id": run.pins["ruleSetVersionId"],
                  "repository_snapshot_id": run.pins["repositorySnapshotId"],
                  "repository_commit": run.pins["repositoryCommit"], "source_path_prefix": run.source_path_prefix}
    current = saved
    visited: set[str] = set()
    bound_seen = False
    for _ in range(64):
        configurable = (current.config or {}).get("configurable", {})
        checkpoint = configurable.get("checkpoint_id")
        metadata = current.metadata or {}
        if (configurable.get("thread_id") != checkpoint_thread_id or configurable.get("checkpoint_ns", "") != ""
                or not isinstance(checkpoint, str) or checkpoint in visited
                or any(metadata.get(key) != value for key, value in provenance.items())):
            return False
        metadata_case = metadata.get("case_revision")
        if (not isinstance(metadata_case, int) or isinstance(metadata_case, bool)
                or (checkpoint == authorized and not 0 <= metadata_case <= run.case_revision)
                or (checkpoint != authorized and metadata_case != run.case_revision)):
            return False
        if checkpoint == expected:
            if expected != authorized and metadata.get("assessment_root_execution_id") != prior_producer:
                return False
            bound_seen = True
        elif not bound_seen and metadata.get("assessment_root_execution_id") != run.execution_id:
            return False
        if checkpoint == authorized:
            return bool(visited) and bound_seen
        visited.add(checkpoint)
        parent = current.parent_config
        parent_fields = (parent or {}).get("configurable", {})
        if (parent_fields.get("thread_id") != checkpoint_thread_id or parent_fields.get("checkpoint_ns", "") != ""
                or not isinstance(parent_fields.get("checkpoint_id"), str)):
            return False
        current = agent.get_state(parent)
    return False


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
    - An unclean running Root may settle proven HITL/Stop/COMPLETE, but unfinished model/tool work fails closed for operator replay.
    - Resume native pending work only when the claim binds its exact checkpoint, or when an existing
      server-authorized transport or human-wait recovery applies; an unbound checkpoint is rejected.
    - A leased human-wait recovery with an open server request may replay unfinished native work
      to persist its interrupt after the human-request side effect committed before a crash.
    - Native checkpoints must retain the same audit identity and immutable source prefix; missing legacy metadata means null only.
    - A failed execution resumes under a new execution identity on the same thread, and success
      requires authoritative COMPLETE.
    - Proven review recovery settles pending waits without invocation; an exact server-bound failed checkpoint
      with unfinished work may continue under validated original answer authority and a new retry execution.
    - Only an explicit server review claim whose latest unknown answers bind the pending checkpoint may
      resume OPEN dependencies for non-factual investigation; ordinary deliveries retain the human wait.
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
    human_wait_recovery = False
    graph_invoke_started = False
    blocked_tool_replay = False
    request_ids: list[str] | None = None
    control_request_id: str | None = None
    try:
        context = client.context()
        audit_request_id = (context.get("auditRequest") or {}).get("requestId")
        expected_checkpoint_thread_id = audit_request_id or claim["threadId"]
        if claim.get("checkpointThreadId", claim["threadId"]) != expected_checkpoint_thread_id:
            raise RuntimeError("server checkpoint thread does not match the authorized audit request")
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
            # Selected requests use their immutable request UUID as an isolated native root thread.
            # The root namespace stays empty; checkpoint_ns is reserved for LangGraph subgraphs.
            "configurable": {
                "thread_id": claim.get("checkpointThreadId") or run.thread_id,
                "checkpoint_ns": "",
            },
            "metadata": {"assessment_id": assessment_id, "assessment_root_execution_id": run.execution_id,
                         "assessment_root_audit_request_id": audit_request_id,
                         "rule_set_version_id": run.pins["ruleSetVersionId"],
                         "repository_snapshot_id": run.pins["repositorySnapshotId"],
                         "repository_commit": run.pins["repositoryCommit"], "source_path_prefix": run.source_path_prefix,
                         "case_revision": run.case_revision},
            "callbacks": [run.trace, TaskLineage(client, run.execution_id), *(extra_callbacks or [])],
        })
        run_context = LCSPRunContext(
            assessment_id=assessment_id,
            thread_id=run.thread_id,
            response_language=response_language,
        )
        with activation or contextlib.nullcontext(), _root_telemetry(claim):
            from runtime_instruction_bundle import runtime_instruction
            packet: Any = {"messages": [{"role": "user", "content": runtime_instruction("assessment-root.resume")}]}
            if checkpointer is not None:
                saved = agent.get_state(graph_config)
                expected = claim.get("resumeCheckpointId")
                actual = saved.config.get("configurable", {}).get("checkpoint_id") if saved.config else None
                starting_checkpoint_id = actual if isinstance(actual, str) else None
                saved_metadata = getattr(saved, "metadata", None) or {}
                if actual and saved_metadata.get("source_path_prefix") != run.source_path_prefix:
                    raise RuntimeError("native Root checkpoint source scope does not match the assessment")
                if actual and saved_metadata.get("assessment_root_audit_request_id") != audit_request_id:
                    raise RuntimeError("native Root checkpoint audit scope does not match the assessment")
                pending = [item for task in saved.tasks for item in task.interrupts]
                control_wait = [item for item in pending if "controlRequestId" in item.value]
                recovered = claim.get("recoveredExecution", False)
                human_wait_recovery = (
                    claim.get("lifecycleState", context.get("lifecycleState"))
                    in {"WAITING_FOR_HUMAN", "BLOCKED"}
                    and bool(context["openHumanRequestIds"])
                    and bool(pending or saved.next)
                )
                review_checkpoint_recovery = _review_checkpoint_recovery_authorized(agent, saved, claim, context, run)
                review_origin = claim.get("humanAnswerReviewCheckpointId")
                if review_origin and (actual != expected or expected != review_origin) and not review_checkpoint_recovery:
                    raise RuntimeError("review recovery checkpoint lacks server-bound ancestry proof")
                if expected and actual != expected and (not recovered or (pending and not control_wait)) and not review_checkpoint_recovery:
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
                if review_checkpoint_recovery:
                    if pending:
                        # A durable review wait is settled without consuming its interrupt.
                        checkpoint_id = actual
                        request_ids = sorted(context["openHumanRequestIds"])
                        final_state = EXECUTION_INTERRUPTED
                    else:
                        if context["lifecycleState"] == "BLOCKED":
                            # Eligibility was checked inside the ancestry proof; a static model
                            # stop also prevents reasoning if the replayed tool unexpectedly returns.
                            blocked_tool_replay = True
                        else:
                            run.authorize_human_answer_review(
                                {**claim, "resumeCheckpointId": review_origin}, context)
                        packet = None
                elif control_wait and (not expected or recovered):
                    if not checkpoint_authorized:
                        raise RuntimeError("native Stop checkpoint lacks server authorization")
                    if len(control_wait) != 1 or control_wait[0].value["targetExecutionId"] != run.execution_id:
                        raise RuntimeError("native Stop checkpoint does not match server execution")
                    checkpoint_id = actual
                    control_request_id = control_wait[0].value["controlRequestId"]
                    final_state = EXECUTION_PAUSED
                elif pending and context["openHumanRequestIds"]:
                    if not checkpoint_authorized:
                        raise RuntimeError("human interrupt checkpoint lacks server authorization")
                    if claim.get("humanAnswerReviewRequired") is True:
                        # An unknown response authorizes review, never factual resolution. The
                        # server and answer audit must bind this exact pending native checkpoint.
                        if not expected or actual != expected:
                            raise RuntimeError("human answer review checkpoint does not match server authority")
                        run.authorize_human_answer_review(claim, context)
                        packet = Command(resume={item.id: {"review": True} for item in pending})
                    else:
                        # Redelivery/crash settlement retains the durable wait without invoking
                        # graph work or consuming its human-resolution interrupt.
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
                if claim.get("recoveredExecution") and not human_wait_recovery:
                    raise NativeRootRecoveryRequired("Uncertain native work retained for audited operator replay")
                graph_invoke_started = True
                output = agent.invoke(
                    packet,
                    config=graph_config,
                    context=run_context,
                    durability="sync" if checkpointer is not None else None,
                    **({"interrupt_before": ["model"]} if blocked_tool_replay else {}),
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
                    selected_done = (terminal.get("auditRequest") or {}).get("status") == "COMPLETED"
                    if terminal["lifecycleState"] != "COMPLETE" and not selected_done:
                        raise RuntimeError("Root graph ended before authoritative audit completion")
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
    elif error_type == NativeRootRecoveryRequired.__name__:
        client.finish(EXECUTION_FAILED, checkpoint_id=checkpoint_id, recovery_required=True)
    elif final_state == EXECUTION_FAILED and checkpoint_id:
        client.finish(final_state, checkpoint_id=checkpoint_id)
    else:
        client.finish(final_state)
    # The exact resolved prompt/tool configuration is available for every run.
    # Eval receipts are opt-in, immutable and never inferred from checkpoint memory.
    manifest = None
    if run is not None and run.prompt_manifest is not None:
        manifest = settle_runtime_manifest(
            run.prompt_manifest, selected_skill_hashes=run.used_skill_hashes,
        )
        receipt_dir = os.environ.get("LCSP_EVAL_MANIFEST_DIR")
        if receipt_dir:
            save_runtime_manifest(Path(receipt_dir) / f"{run.execution_id}.json", manifest)
    return {
        "promptManifestSha256": manifest["manifestSha256"] if manifest else None,
        "state": final_state,
        "executionId": claim["executionId"],
        "threadId": claim["threadId"],
        "errorType": error_type,
        "checkpointId": checkpoint_id,
    }
