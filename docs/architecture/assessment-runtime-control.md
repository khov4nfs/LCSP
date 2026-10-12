# Assessment runtime Stop / Continue

The native Agent Server run is the cancellation boundary. `AssessmentRuntimeTurn`
stores its assessment, thread, native run, logical turn, original private runtime
context, and acknowledged checkpoint. Resuming creates a new native cancellation
generation on the same thread with `input=None`; it does not submit another answer.

## Customer contract

All JSON responses use the standard result envelope. The endpoints are:

- `GET /assessments/:assessmentId/runtime/control`
- `POST /assessments/:assessmentId/runtime/stop`
- `POST /assessments/:assessmentId/runtime/continue`

Mutations bind `targetRunId` from the current state. Acceptance returns
`STOP_REQUESTED` or `RESUME_REQUESTED`, not an acknowledgement. Duplicate requests
reuse the durable request and enqueue no additional command. A stale target is
rejected; completion wins a late Stop. Continue before `STOPPED` is rejected.

The worker-only registration endpoint `/internal/assessment-runtime-controls`
acknowledges execution, interruption, or natural completion. Durable SSE lifecycle
events and the current-state query survive customer reconnects. Retried requests
and acknowledgements repair failed publication with stable, unique journal IDs.
The composer uses
Stopping / Continuing while a request is pending and never infers STOPPED from a
generic failure, billing pause, or optimistic pipeline marker.

## Cancellation and stale work

Native async LangGraph execution receives task cancellation while awaiting a
provider or tool. Graph cleanup and checkpoint writes finish before the native run
is reported interrupted, including nested graphs in synchronous tool executor
threads. Existing rule/workflow checkpoint identities are preserved;
nested specialist checkpoints are scoped to the same logical turn and stable task
identity. Completed checkpoint results are reused, and a completed root checkpoint
with no pending work is a no-op rather than a new invocation.

Blocking synchronous providers/tools cannot be physically killed safely. Their
calling task is abandoned, and their late content/results are not returned to the
graph. Their copied context retains the permanent stop signal, prevents fallback or
downstream calls, and fences late checkpoint writes. Provider-reported usage may
still be recorded; this does **not** claim provider compute was aborted.

Worker mutations carry `x-lcsp-runtime-run-id`. The API write fence holds a shared
lock on that native generation while admitting a mutation; the stopped update
waits for admitted writes. Later writes from the cancelled generation are rejected,
including after a newer generation resumes. Model/tool stream events carry the
same native identity and are ignored after the run is stopped or completed. Late
heartbeat telemetry cannot reopen liveness. Usage-only callbacks remain exempt.

The control command uses the existing outbox delivery channel and is executed
outside the target runtime thread. It polls interruption for a bounded interval;
retries remain bound to the same exact target. Paused wall time does not consume
the original boundary's execution budget. Private context and checkpoints never
appear in customer DTOs or activity copy.

## Deployment and verification

Apply the additive `20261003100000_assessment_runtime_control` migration before
deploying the API and Agent Server changes together. Old generations do not become
checkpoint-resumable merely because they have a legacy pause marker.

Regression coverage includes held-open async and blocking calls, tool interruption,
fallback suppression, exact checkpoint input, duplicate delivery, natural completion
races, database write fencing, stale heartbeat filtering, SSE history, and composer
state transitions. The synthetic checkpoint tests exercise the shared primitive for
Interview, rule analysis, and Gate. Live provider transport and real-browser checks
remain separate release evidence; unit tests must not be represented as those checks.
