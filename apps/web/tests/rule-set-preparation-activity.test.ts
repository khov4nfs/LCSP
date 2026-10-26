import { readFileSync } from "node:fs";
import { resolveMessage } from "@lcsp/i18n";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AGENT_STREAM_BOUNDARY_TYPES,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES as T,
  type AssessmentAgentStreamEvent,
} from "@lcsp/contracts/evidence";
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import { CLAIM_DISCOVERY_ACTIVITY_KINDS } from "@lcsp/contracts/compliance-rule-set";

import {
  preparationTokenUsage,
  preparationProgress,
  projectPreparationActivity,
} from "../src/features/admin/utils/rule-set-preparation-activity";

test("frontier counters use the latest recorded progress without inventing missing values", () => {
  assert.equal(preparationProgress([event(1, T.boundaryStarted)]), null);
  const progress = (sequence: number, reviewed: number) =>
    event(sequence, T.customProgress, {
      data: {
        source_nodes_reviewed: reviewed,
        review_frontier: { progress: { total: 3231 } },
        claim_count: 7,
      },
    });
  assert.deepEqual(
    preparationProgress([
      progress(3, 5),
      progress(2, 4),
      event(4, T.customProgress),
    ]),
    {
      reviewed: 5,
      total: 3231,
      remaining: null,
      reviewedWithClaims: null,
      reviewedNoClaims: null,
      inReview: null,
      pending: null,
      blocked: null,
      persistedClaims: null,
      claims: 7,
      requirements: null,
      rules: null,
    },
  );
});

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

const committed = JSON.parse(
  readFileSync(
    new URL(
      "../src/public/assets/mocks/admin/claim-file-activity.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
test("article commit events retain per-file progress and replace retries without adding counts", () => {
  const activities = projectPreparationActivity([
    event(1, T.customProgress, { data: committed }),
    event(2, T.customProgress, {
      data: { ...committed, committedNodes: 3, rejected: 0 },
    }),
    event(3, T.customProgress, {
      data: {
        ...committed,
        file: "luat-134/dieu-6.json",
        committedNodes: ["node-1"],
        rejected: { claim1: ["source gap"], claim2: ["other gap"] },
      },
    }),
  ]);
  assert.equal(activities.length, 2);
  assert.equal(activities[0]?.details.claimFile, committed.file);
  assert.equal(activities[0]?.details.committedNodes, 3);
  assert.equal(activities[0]?.details.rejected, 0);
  assert.equal(activities[1]?.details.committedNodes, 1);
  assert.equal(activities[1]?.details.rejected, 2);
  for (const locale of ["en", "vi"] as const) {
    assert.notEqual(
      resolveMessage(locale, activities[0]!.labelKey),
      activities[0]!.labelKey,
    );
    assert.match(resolveMessage(locale, activities[0]!.labelKey), /\{file\}/u);
  }
});
test("file events leave authoritative frontier counts intact", () => {
  const progress = preparationProgress([
    event(1, T.customProgress, {
      data: {
        review_frontier: {
          progress: {
            total: 10,
            pending: 2,
            inReview: 1,
            blocked: 1,
            reviewedWithClaims: 4,
            reviewedNoClaims: 2,
            persistedClaims: 7,
          },
        },
      },
    }),
    event(2, T.customProgress, { data: committed }),
  ]);
  assert.equal(progress?.reviewed, 6);
  assert.equal(progress?.remaining, 4);
  assert.equal(progress?.persistedClaims, 7);
});
test("budget PAUSED is distinct from failure and settles active work", () => {
  const activities = projectPreparationActivity(
    [event(1, T.boundaryStarted), event(2, T.boundaryFailed)],
    true,
    AGENT_EXECUTION_STATES.PAUSED,
  );
  assert.ok(
    activities.every((a) => a.status === AGENT_EXECUTION_STATES.PAUSED),
  );
  assert.equal(
    activities.at(-1)?.labelKey,
    "pages.complianceRuleSets.activity.paused",
  );
});

test("budget pause telemetry is visible before the history refresh", () => {
  const [activity] = projectPreparationActivity([
    event(1, T.customProgress, {
      data: {
        activity_kind: CLAIM_DISCOVERY_ACTIVITY_KINDS.PREPARATION_PAUSED,
      },
    }),
  ]);
  assert.equal(activity?.labelKey, "pages.complianceRuleSets.activity.paused");
  assert.equal(activity?.status, AGENT_EXECUTION_STATES.PAUSED);
});
