import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AGENT_STREAM_BOUNDARY_TYPES,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES as T,
  type AssessmentAgentStreamEvent,
} from "@lcsp/contracts/evidence";
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";

import {
  preparationTokenUsage,
  projectPreparationActivity,
} from "../src/features/admin/utils/rule-set-preparation-activity";

function event(
  sequence: number,
  eventType: AssessmentAgentStreamEvent["eventType"],
  overrides: Partial<AssessmentAgentStreamEvent> = {},
): AssessmentAgentStreamEvent {
  return {
    eventId: `event-${sequence}`,
    sequence,
    clientSequence: sequence,
    emittedAt: new Date(Date.UTC(2026, 9, 13, 0, 0, sequence)).toISOString(),
    assessmentId: null,
    boundaryType: AGENT_STREAM_BOUNDARY_TYPES.ruleSetPreparation,
    boundaryId: "preparation-1",
    preparationRunId: "preparation-1",
    runId: "preparation-1",
    correlationId: "correlation-1",
    eventType,
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
    data: null,
    ...overrides,
  };
}

test("preparation activity groups native work and settles terminal events", () => {
  const events = [
    event(1, T.boundaryStarted),
    event(2, T.semanticToolCall, {
      toolName: "task",
      toolCallId: "reader-134",
      data: {
        native_tool: "task",
        subagent_type: "legal-source-reader",
        source_path: "/legal-source/134-2025-QH15",
      },
    }),
    event(3, T.toolResult, {
      toolName: "task",
      toolCallId: "reader-134",
      status: "COMPLETED",
      data: {
        native_tool: "task",
        subagent_type: "legal-source-reader",
      },
    }),
    event(4, T.semanticToolCall, {
      toolName: "validate_compliance_rule_set",
      toolCallId: "validate-1",
    }),
    event(5, T.toolResult, {
      toolName: "validate_compliance_rule_set",
      toolCallId: "validate-1",
      status: "COMPLETED",
      data: { native_tool: "validate_compliance_rule_set", outcome: "PASSED" },
    }),
    event(6, T.semanticToolCall, {
      toolName: "submit_compliance_rule_set",
      toolCallId: "submit-1",
    }),
    event(7, T.toolResult, {
      toolName: "submit_compliance_rule_set",
      toolCallId: "submit-1",
      status: "COMPLETED",
    }),
    event(8, T.boundaryCompleted, { status: "COMPLETED" }),
  ];

  const activities = projectPreparationActivity(
    events,
    true,
    AGENT_EXECUTION_STATES.SUCCEEDED,
  );
  assert.equal(activities.length, 5);
  assert.equal(
    activities[1]?.details.sourcePath,
    "/legal-source/134-2025-QH15",
  );
  assert.equal(activities[1]?.status, "COMPLETED");
  assert.equal(
    activities[2]?.labelKey,
    "pages.complianceRuleSets.activity.validationPassed",
  );
  assert.equal(
    activities[3]?.labelKey,
    "pages.complianceRuleSets.activity.submitting",
  );
  assert.equal(
    activities.at(-1)?.labelKey,
    "pages.complianceRuleSets.activity.completed",
  );
  assert.ok(
    activities.every(
      (activity) => !JSON.stringify(activity).includes("private source"),
    ),
  );
});

test("boundary completion reflects the authoritative preparation outcome", () => {
  const events = [
    event(1, T.boundaryStarted),
    event(2, T.semanticToolCall, {
      toolName: "task",
      toolCallId: "reader-71",
      status: "RUNNING",
      data: { native_tool: "task", subagent_type: "legal-source-reader" },
    }),
    event(3, T.boundaryCompleted, { status: "COMPLETED" }),
  ];

  const failed = projectPreparationActivity(
    events,
    true,
    AGENT_EXECUTION_STATES.FAILED,
  );
  assert.equal(
    failed.at(-1)?.labelKey,
    "pages.complianceRuleSets.activity.failed",
  );
  assert.equal(failed.at(-1)?.status, "FAILED");
  assert.equal(failed[1]?.status, "FAILED");

  const succeeded = projectPreparationActivity(
    events,
    true,
    AGENT_EXECUTION_STATES.SUCCEEDED,
  );
  assert.equal(
    succeeded.at(-1)?.labelKey,
    "pages.complianceRuleSets.activity.completed",
  );

  const unknown = projectPreparationActivity(events, true);
  assert.equal(
    unknown.at(-1)?.labelKey,
    "pages.complianceRuleSets.activity.executionFinished",
  );
});

test("preparation token usage deduplicates provider completion events", () => {
  const usage = {
    input_tokens: 10,
    output_tokens: 4,
    total_tokens: 14,
  };
  const events = [
    event(1, T.modelCallCompleted, {
      messageId: "message-1",
      data: { invocation_id: "invocation-1", usage },
    }),
    event(2, T.modelCallCompleted, {
      messageId: "message-1",
      data: { invocation_id: "invocation-1", usage },
    }),
  ];

  assert.deepEqual(preparationTokenUsage(events), {
    inputTokens: 10,
    outputTokens: 4,
    totalTokens: 14,
  });
});

test("cancellation is terminal and settles every active preparation activity", () => {
  const activities = projectPreparationActivity(
    [
      event(1, T.boundaryStarted),
      event(2, T.semanticToolCall, {
        toolName: "task",
        toolCallId: "reader-71",
        status: "RUNNING",
        data: { native_tool: "task", subagent_type: "legal-source-reader" },
      }),
      event(3, T.preparationCancelled, {
        status: "COMPLETED",
        data: { execution_state: AGENT_EXECUTION_STATES.CANCELLED },
      }),
    ],
    true,
    AGENT_EXECUTION_STATES.CANCELLED,
  );

  assert.equal(
    activities.at(-1)?.labelKey,
    "pages.complianceRuleSets.activity.cancelled",
  );
  assert.ok(activities.every((activity) => activity.status === "CANCELLED"));
});
