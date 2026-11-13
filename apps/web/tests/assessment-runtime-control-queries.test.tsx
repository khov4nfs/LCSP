import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import React, { act, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import { ASSESSMENT_RUNTIME_CONTROL_STATES } from "@lcsp/contracts/evidence";
import { CUSTOMER_ASSESSMENT_STATES } from "../src/features/assessment-runtime/config/customer-assessment-states.ts";
import { WORKSPACE_RUNTIME_CONNECTION_STATES } from "../src/features/workspace/types/workspace-runtime.types.ts";
import {
  useAssessmentRuntimeControl,
  type UseAssessmentRuntimeControlOptions,
} from "../src/lib/api/assessment-runtime-control-queries.ts";
import {
  ASSESSMENT_RUNTIME_CONTROL_POLLING_INTERVALS as Intervals,
} from "../src/lib/api/assessment-runtime-control-polling-policy.ts";
import { render, settle } from "./support/dom.ts";

const originalFetch = globalThis.fetch;

const VALID_UUID_1 = "11111111-1111-4111-8111-111111111111";
const VALID_UUID_2 = "22222222-2222-4222-8222-222222222222";
const VALID_UUID_3 = "33333333-3333-4333-8333-333333333333";
const VALID_UUID_4 = "44444444-4444-4444-8444-444444444444";
const VALID_UUID_5 = "55555555-5555-4555-8555-555555555555";

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("useAssessmentRuntimeControl configures state-aware refetchInterval and security options", async () => {
  const assessmentId = VALID_UUID_1;
  const runId = VALID_UUID_2;
  let requestCount = 0;

  globalThis.fetch = async (input) => {
    requestCount += 1;
    const url = typeof input === "string" ? input : input.toString();

    if (url.includes("/runtime/control")) {
      return Response.json({
        ok: true,
        data: {
          state: ASSESSMENT_RUNTIME_CONTROL_STATES.running,
          targetRunId: runId,
          requestId: null,
        },
      });
    }

    return Response.json({ ok: false }, { status: 404 });
  };

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });

  function ActiveConsumer({
    options,
  }: {
    options?: UseAssessmentRuntimeControlOptions;
  }) {
    const { control } = useAssessmentRuntimeControl(assessmentId, options);
    return <div data-testid="state">{control.data?.state ?? "loading"}</div>;
  }

  const container = render(
    <QueryClientProvider client={client}>
      <ActiveConsumer
        options={{
          lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
          executionState: AGENT_EXECUTION_STATES.RUNNING,
          customerState: CUSTOMER_ASSESSMENT_STATES.WORKING,
          connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
          targetRunId: runId,
        }}
      />
    </QueryClientProvider>,
  );

  await settle();

  assert.equal(requestCount, 1, "Initial fetch fired exactly once");
  assert.equal(container.textContent, ASSESSMENT_RUNTIME_CONTROL_STATES.running);

  const query = client.getQueryCache().find({
    queryKey: ["assessment-runtime-control", assessmentId],
  });
  assert.ok(query, "Query registered in cache");

  // Verify TanStack Query options
  assert.equal(Reflect.get(query.options, "refetchIntervalInBackground"), false);
  assert.equal(Reflect.get(query.options, "refetchOnWindowFocus"), true);
  assert.equal(Reflect.get(query.options, "refetchOnReconnect"), true);

  const refetchInterval = Reflect.get(query.options, "refetchInterval") as (
    q: typeof query,
  ) => number | false;
  assert.equal(typeof refetchInterval, "function");

  // In active streaming mode, refetch interval is 3,000ms (57% reduction over legacy 1,000ms)
  assert.equal(refetchInterval(query), Intervals.ACTIVE_STREAMING);
});

test("refetchInterval dynamically transitions between active, paused, and terminal states", async () => {
  const assessmentId = VALID_UUID_3;
  const runId = VALID_UUID_4;

  globalThis.fetch = async () =>
    Response.json({
      ok: true,
      data: {
        state: ASSESSMENT_RUNTIME_CONTROL_STATES.running,
        targetRunId: runId,
        requestId: null,
      },
    });

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });

  function DynamicConsumer({
    options,
  }: {
    options?: UseAssessmentRuntimeControlOptions;
  }) {
    const { control } = useAssessmentRuntimeControl(assessmentId, options);
    return <div>{control.data?.state ?? "loading"}</div>;
  }

  const currentOptions: UseAssessmentRuntimeControlOptions = {
    lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
    executionState: AGENT_EXECUTION_STATES.RUNNING,
    customerState: CUSTOMER_ASSESSMENT_STATES.WORKING,
    connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
  };

  let updateOptions: (opts: UseAssessmentRuntimeControlOptions) => void = () => {};

  function Host() {
    const [opts, setOpts] = useState(currentOptions);
    updateOptions = setOpts;
    return <DynamicConsumer options={opts} />;
  }

  render(
    <QueryClientProvider client={client}>
      <Host />
    </QueryClientProvider>,
  );

  await settle();

  const getInterval = () => {
    const q = client.getQueryCache().find({
      queryKey: ["assessment-runtime-control", assessmentId],
    })!;
    const fn = Reflect.get(q.options, "refetchInterval") as (
      candidate: typeof q,
    ) => number | false;
    return fn(q);
  };

  // Active streaming: 3,000ms
  assert.equal(getInterval(), Intervals.ACTIVE_STREAMING);

  // Switch to Active fallback (disconnected SSE): 2,000ms
  act(() => {
    updateOptions({
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
      executionState: AGENT_EXECUTION_STATES.RUNNING,
      customerState: CUSTOMER_ASSESSMENT_STATES.WORKING,
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.disconnected,
    });
  });
  await settle();
  assert.equal(getInterval(), Intervals.ACTIVE_FALLBACK);

  // Switch to Paused streaming: 10,000ms
  act(() => {
    client.setQueryData(["assessment-runtime-control", assessmentId], {
      state: ASSESSMENT_RUNTIME_CONTROL_STATES.stopped,
      targetRunId: runId,
      requestId: null,
    });
    updateOptions({
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.PAUSED,
      executionState: AGENT_EXECUTION_STATES.PAUSED,
      customerState: CUSTOMER_ASSESSMENT_STATES.PAUSED,
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
    });
  });
  await settle();
  assert.equal(getInterval(), Intervals.IDLE_WAITING_STREAMING);

  // Switch to Paused fallback (disconnected SSE): 5,000ms
  act(() => {
    updateOptions({
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.PAUSED,
      executionState: AGENT_EXECUTION_STATES.PAUSED,
      customerState: CUSTOMER_ASSESSMENT_STATES.PAUSED,
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.disconnected,
    });
  });
  await settle();
  assert.equal(getInterval(), Intervals.IDLE_WAITING_FALLBACK);

  // Switch to Terminal completed with SSE: disabled (false = 0 requests)
  act(() => {
    client.setQueryData(["assessment-runtime-control", assessmentId], {
      state: ASSESSMENT_RUNTIME_CONTROL_STATES.completed,
      targetRunId: runId,
      requestId: null,
    });
    updateOptions({
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
      customerState: CUSTOMER_ASSESSMENT_STATES.COMPLETE,
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
    });
  });
  await settle();
  assert.equal(getInterval(), Intervals.DISABLED);

  // Switch to Terminal completed when SSE disconnected: 30,000ms bounded reconciliation
  act(() => {
    updateOptions({
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
      customerState: CUSTOMER_ASSESSMENT_STATES.COMPLETE,
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.disconnected,
    });
  });
  await settle();
  assert.equal(getInterval(), Intervals.TERMINAL_RECONCILIATION);
});

test("stop and resume mutations trigger cancellation, optimistic cache merge and fast transition polling", async () => {
  const assessmentId = VALID_UUID_4;
  const runId = VALID_UUID_5;
  let lastAction = "";

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url.includes("/runtime/control")) {
      return Response.json({
        ok: true,
        data: {
          state: lastAction === "stop"
            ? ASSESSMENT_RUNTIME_CONTROL_STATES.stopRequested
            : lastAction === "continue"
              ? ASSESSMENT_RUNTIME_CONTROL_STATES.resumeRequested
              : ASSESSMENT_RUNTIME_CONTROL_STATES.running,
          targetRunId: runId,
          requestId: VALID_UUID_1,
        },
      });
    }

    if (url.includes("/runtime/stop")) {
      lastAction = "stop";
      return Response.json({
        ok: true,
        data: {
          state: ASSESSMENT_RUNTIME_CONTROL_STATES.stopRequested,
          targetRunId: runId,
          requestId: VALID_UUID_2,
        },
      });
    }

    if (url.includes("/runtime/continue")) {
      lastAction = "continue";
      return Response.json({
        ok: true,
        data: {
          state: ASSESSMENT_RUNTIME_CONTROL_STATES.resumeRequested,
          targetRunId: runId,
          requestId: VALID_UUID_3,
        },
      });
    }

    return Response.json({ ok: false }, { status: 404 });
  };

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });

  const handlesRef = {
    current: null as ReturnType<typeof useAssessmentRuntimeControl> | null,
  };

  function MutationConsumer() {
    const result = useAssessmentRuntimeControl(assessmentId, {
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
      executionState: AGENT_EXECUTION_STATES.RUNNING,
      customerState: CUSTOMER_ASSESSMENT_STATES.WORKING,
      connectionState: WORKSPACE_RUNTIME_CONNECTION_STATES.connected,
      targetRunId: runId,
    });
    handlesRef.current = result;
    return (
      <div>
        <span data-testid="state">{result.control.data?.state ?? "loading"}</span>
        <button
          type="button"
          data-testid="stop-btn"
          onClick={() => result.stop.mutate(runId)}
        >
          Stop
        </button>
        <button
          type="button"
          data-testid="resume-btn"
          onClick={() => result.resume.mutate(runId)}
        >
          Resume
        </button>
      </div>
    );
  }

  const container = render(
    <QueryClientProvider client={client}>
      <MutationConsumer />
    </QueryClientProvider>,
  );

  await settle();

  const query = client.getQueryCache().find({
    queryKey: ["assessment-runtime-control", assessmentId],
  })!;
  const intervalFn = Reflect.get(query.options, "refetchInterval") as (
    q: typeof query,
  ) => number | false;

  // Trigger stop mutation
  const stopButton = container.querySelector('[data-testid="stop-btn"]') as HTMLButtonElement;
  act(() => {
    stopButton.click();
  });
  await settle();

  // Cache is updated to stopRequested
  assert.equal(
    handlesRef.current?.control.data?.state,
    ASSESSMENT_RUNTIME_CONTROL_STATES.stopRequested,
  );
  // Transition polling is fast 1,000ms
  assert.equal(intervalFn(query), Intervals.TRANSITION);

  // Trigger resume mutation
  const resumeButton = container.querySelector('[data-testid="resume-btn"]') as HTMLButtonElement;
  act(() => {
    resumeButton.click();
  });
  await settle();

  // Cache is updated to resumeRequested
  assert.equal(
    handlesRef.current?.control.data?.state,
    ASSESSMENT_RUNTIME_CONTROL_STATES.resumeRequested,
  );
  // Transition polling remains fast 1,000ms
  assert.equal(intervalFn(query), Intervals.TRANSITION);
});

test("switching assessment mounts new queryKey and queries new assessment ID", async () => {
  const firstId = VALID_UUID_1;
  const secondId = VALID_UUID_2;
  const requestedIds: string[] = [];

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    const id = url.split("/")[3];
    requestedIds.push(id);
    return Response.json({
      ok: true,
      data: {
        state: ASSESSMENT_RUNTIME_CONTROL_STATES.running,
        targetRunId: VALID_UUID_3,
        requestId: null,
      },
    });
  };

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });

  function Switcher() {
    const [currentId, setCurrentId] = useState(firstId);
    const { control } = useAssessmentRuntimeControl(currentId);

    return (
      <div>
        <span data-testid="target">{control.data?.targetRunId}</span>
        <button
          type="button"
          data-testid="switch"
          onClick={() => setCurrentId(secondId)}
        >
          Switch
        </button>
      </div>
    );
  }

  const container = render(
    <QueryClientProvider client={client}>
      <Switcher />
    </QueryClientProvider>,
  );

  await settle();
  assert.equal(requestedIds.includes(firstId), true);

  const switchButton = container.querySelector('[data-testid="switch"]') as HTMLButtonElement;
  act(() => {
    switchButton.click();
  });

  await settle();
  assert.equal(requestedIds.includes(secondId), true);

  const firstQuery = client.getQueryCache().find({
    queryKey: ["assessment-runtime-control", firstId],
  });
  const secondQuery = client.getQueryCache().find({
    queryKey: ["assessment-runtime-control", secondId],
  });
  assert.ok(firstQuery);
  assert.ok(secondQuery);
});
