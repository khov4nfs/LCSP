import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AGENT_STREAM_BOUNDARY_TYPES,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES,
  type AssessmentAgentStreamEvent,
} from "@lcsp/contracts/evidence";

import { useRuleSetPreparationActivity } from "../src/features/admin/hooks/use-rule-set-preparation-activity";
import {
  installFakeEventSource,
  installFetch,
  render,
  settle,
} from "./support/dom";

const preparationRunId = "11111111-1111-4111-8111-111111111111";

function Probe() {
  const activity = useRuleSetPreparationActivity(preparationRunId, false);
  return <output data-count={activity.events.length} />;
}

test("admin activity hook uses the dedicated stream and accepts individual sanitized events", async () => {
  const stream = installFakeEventSource();
  const fetchStub = installFetch({
    [`GET /api/admin/compliance-rule-sets/preparations/${preparationRunId}/activity`]: {
      events: [],
      nextCursor: null,
      hasMore: false,
    },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  try {
    const node = render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
    await settle();
    assert.equal(stream.instances.length, 1);
    assert.equal(
      stream.instances[0]?.url,
      `/api/admin/compliance-rule-sets/preparations/${preparationRunId}/activity/stream`,
    );

    const event: AssessmentAgentStreamEvent = {
      eventId: "event-1",
      sequence: 1,
      clientSequence: 1,
      emittedAt: "2026-11-23T00:00:00.000Z",
      assessmentId: null,
      boundaryType: AGENT_STREAM_BOUNDARY_TYPES.ruleSetPreparation,
      boundaryId: preparationRunId,
      preparationRunId,
      runId: preparationRunId,
      correlationId: "corr-1",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.customProgress,
      source: null,
      agentName: "rule-set-preparation",
      subagentName: null,
      namespace: [],
      nodeName: null,
      messageId: null,
      toolName: null,
      toolCallId: null,
      status: "RUNNING",
      text: null,
      data: { source_nodes_reviewed: 2 },
    };
    act(() => stream.instances[0]?.emit("preparation.activity", event));
    await settle();
    assert.equal(node.querySelector("output")?.getAttribute("data-count"), "1");
  } finally {
    stream.restore();
    fetchStub.restore();
    client.clear();
  }
});
