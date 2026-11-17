import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import { ASSESSMENT_AUDIT_MODES } from "@lcsp/contracts/assessment-domain";
import { ASSESSMENT_RUNTIME_CONTROL_STATES } from "@lcsp/contracts/evidence";
import { CUSTOMER_ASSESSMENT_STATES } from "../src/features/assessment-runtime/config/customer-assessment-states.ts";
import { WORKSPACE_RUNTIME_CONNECTION_STATES } from "../src/features/workspace/types/workspace-runtime.types.ts";
import {
  computeRuntimeControlPollingInterval,
  ASSESSMENT_RUNTIME_CONTROL_POLLING_INTERVALS as Intervals,
} from "../src/lib/api/assessment-runtime-control-polling-policy.ts";

test("background tab visibility guard disables scheduled polling", () => {
  assert.equal(
    computeRuntimeControlPollingInterval({
      isDocumentVisible: false,
      controlState: ASSESSMENT_RUNTIME_CONTROL_STATES.running,
      executionState: AGENT_EXECUTION_STATES.RUNNING,
    }),
    Intervals.DISABLED,
  );
});

test("query error triggers 10s error backoff to avoid request storming", () => {
  assert.equal(
    computeRuntimeControlPollingInterval({
      hasQueryError: true,
      controlState: ASSESSMENT_RUNTIME_CONTROL_STATES.running,
    }),
    Intervals.ERROR_BACKOFF,
  );
});

test("in-flight mutation or pending transition (stopRequested, resumeRequested) polls at 1s", () => {
  assert.equal(
    computeRuntimeControlPollingInterval({
      isMutating: true,
      controlState: ASSESSMENT_RUNTIME_CONTROL_STATES.running,
    }),
    Intervals.TRANSITION,
  );

  assert.equal(
    computeRuntimeControlPollingInterval({
      controlState: ASSESSMENT_RUNTIME_CONTROL_STATES.stopRequested,
    }),
    Intervals.TRANSITION,
  );

  assert.equal(
    computeRuntimeControlPollingInterval({
      controlState: ASSESSMENT_RUNTIME_CONTROL_STATES.resumeRequested,
    }),
    Intervals.TRANSITION,
  );
});

test("active execution polls at 3s with SSE streaming and 2s with fallback", () => {
  // Running state with SSE connected
  assert.equal(
    computeRuntimeControlPollingInterval({
      controlState: ASSESSMENT_RUNTIME_CONTROL_STATES.running,
      executionState: AGENT_EXECUTION_STATES.RUNNING,
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
    }),
    Intervals.ACTIVE_STREAMING,
  );

  // Running state without SSE (disconnected or connecting)
  assert.equal(
    computeRuntimeControlPollingInterval({
      controlState: ASSESSMENT_RUNTIME_CONTROL_STATES.running,
      executionState: AGENT_EXECUTION_STATES.RUNNING,
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.disconnected,
    }),
    Intervals.ACTIVE_FALLBACK,
  );

  // Queued state with customer WORKING
  assert.equal(
    computeRuntimeControlPollingInterval({
      executionState: AGENT_EXECUTION_STATES.QUEUED,
      customerState: CUSTOMER_ASSESSMENT_STATES.WORKING,
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
    }),
    Intervals.ACTIVE_STREAMING,
  );

  // Finalizing state
  assert.equal(
    computeRuntimeControlPollingInterval({
      customerState: CUSTOMER_ASSESSMENT_STATES.FINALIZING,
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.disconnected,
    }),
    Intervals.ACTIVE_FALLBACK,
  );
});

test("paused and stopped states back off to 10s streaming and 5s fallback", () => {
  // Stopped control state with SSE
  assert.equal(
    computeRuntimeControlPollingInterval({
      controlState: ASSESSMENT_RUNTIME_CONTROL_STATES.stopped,
      executionState: AGENT_EXECUTION_STATES.PAUSED,
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.PAUSED,
      customerState: CUSTOMER_ASSESSMENT_STATES.PAUSED,
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
    }),
    Intervals.IDLE_WAITING_STREAMING,
  );

  // Stopped control state without SSE
  assert.equal(
    computeRuntimeControlPollingInterval({
      controlState: ASSESSMENT_RUNTIME_CONTROL_STATES.stopped,
      executionState: AGENT_EXECUTION_STATES.PAUSED,
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.PAUSED,
      customerState: CUSTOMER_ASSESSMENT_STATES.PAUSED,
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.disconnected,
    }),
    Intervals.IDLE_WAITING_FALLBACK,
  );
});

test("waiting and unknown-review states poll at 10s streaming and 5s fallback to detect multi-tab resolution", () => {
  // WAITING state (open human question)
  assert.equal(
    computeRuntimeControlPollingInterval({
      customerState: CUSTOMER_ASSESSMENT_STATES.WAITING,
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
    }),
    Intervals.IDLE_WAITING_STREAMING,
  );

  assert.equal(
    computeRuntimeControlPollingInterval({
      customerState: CUSTOMER_ASSESSMENT_STATES.WAITING,
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.disconnected,
    }),
    Intervals.IDLE_WAITING_FALLBACK,
  );

  // WAITING_FOR_HUMAN lifecycle state
  assert.equal(
    computeRuntimeControlPollingInterval({
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN,
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
    }),
    Intervals.IDLE_WAITING_STREAMING,
  );
});

test("CUSTOMER_SELECTED mode completed audit does NOT disable polling while assessment is active", () => {
  assert.equal(
    computeRuntimeControlPollingInterval({
      auditMode: ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED,
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
      controlState: ASSESSMENT_RUNTIME_CONTROL_STATES.completed,
      customerState: CUSTOMER_ASSESSMENT_STATES.SELECTING,
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
    }),
    Intervals.IDLE_WAITING_STREAMING,
  );

  assert.equal(
    computeRuntimeControlPollingInterval({
      auditMode: ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED,
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
      controlState: ASSESSMENT_RUNTIME_CONTROL_STATES.completed,
      customerState: CUSTOMER_ASSESSMENT_STATES.SELECTING,
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.disconnected,
    }),
    Intervals.IDLE_WAITING_FALLBACK,
  );
});

test("truly terminal assessment disables scheduled polling when SSE connected and maintains 30s bounded fallback", () => {
  // Terminal COMPLETE with SSE connected -> disabled (0 scheduled requests)
  assert.equal(
    computeRuntimeControlPollingInterval({
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
      customerState: CUSTOMER_ASSESSMENT_STATES.COMPLETE,
      controlState: ASSESSMENT_RUNTIME_CONTROL_STATES.completed,
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
    }),
    Intervals.DISABLED,
  );

  // Terminal FAILED with SSE connected -> disabled
  assert.equal(
    computeRuntimeControlPollingInterval({
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.FAILED,
      customerState: CUSTOMER_ASSESSMENT_STATES.FAILED,
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
    }),
    Intervals.DISABLED,
  );

  // Terminal COMPLETE when SSE disconnected -> bounded reconciliation fallback (30s)
  assert.equal(
    computeRuntimeControlPollingInterval({
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
      customerState: CUSTOMER_ASSESSMENT_STATES.COMPLETE,
      controlState: ASSESSMENT_RUNTIME_CONTROL_STATES.completed,
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.disconnected,
    }),
    Intervals.TERMINAL_RECONCILIATION,
  );
});

test("unspecified or default state defaults safely to idle waiting interval", () => {
  assert.equal(
    computeRuntimeControlPollingInterval({
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
    }),
    Intervals.IDLE_WAITING_STREAMING,
  );

  assert.equal(
    computeRuntimeControlPollingInterval({
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.disconnected,
    }),
    Intervals.IDLE_WAITING_FALLBACK,
  );
});
