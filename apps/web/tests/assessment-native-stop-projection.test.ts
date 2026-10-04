import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES as Events,
  ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS,
  ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS,
  ASSESSMENT_AGENT_STREAM_STAGES as Stages,
  ASSESSMENT_RUNTIME_CONTROL_STATES as Controls,
  ASSESSMENT_RUNTIME_RUN_STATUSES as Runs,
  type AssessmentAgentStreamEvent,
} from "@lcsp/contracts/evidence";
import {
  AGENT_STREAM_RUN_OUTCOMES as Outcomes,
  deriveAgentStreamRunOutcome,
  finalizeRuleHeaders,
  projectStreamRows,
  STREAM_ROW_STATUSES,
} from "../src/features/workspace/utils/agent-stream-projection.ts";
import { projectAgentStreamRuleHeaders } from "../src/features/workspace/utils/agent-stream-rule-groups.ts";
import {
  groupAgentStreamActivityByTurnKey,
  groupAgentStreamEventsByRun,
  groupAgentStreamEventsByStage,
} from "../src/features/workspace/utils/agent-stream-stages.ts";
import { normalizeAssessmentRuntime } from "../src/features/workspace/utils/assessment-runtime-adapter.ts";
import { applyAssessmentRuntimeControlPresentation } from "../src/features/workspace/utils/assessment-runtime-control-presentation.ts";
import {
  ASSESSMENT_SIDEBAR_WORKFLOW_STAGES as Steps,
  NORMALIZED_WORKFLOW_STEP_STATUSES as Statuses,
} from "../src/features/workspace/types/assessment-runtime-adapter.types.ts";

function event(
  sequence: number,
  eventType: AssessmentAgentStreamEvent["eventType"],
  overrides: Partial<AssessmentAgentStreamEvent> = {},
): AssessmentAgentStreamEvent {
  return {
    eventId: `event-${sequence}`,
    sequence,
    clientSequence: sequence,
    emittedAt: new Date(Date.UTC(2026, 9, 4, 3, 37, sequence)).toISOString(),
    assessmentId: "assessment",
    runId: "scan-job",
    correlationId: "worker-correlation",
    eventType,
    stage: Stages.ruleAnalysis,
    engineeringRuleId: null,
    source: null,
    agentName: null,
    subagentName: null,
    namespace: [],
    nodeName: null,
    messageId: null,
    toolName: null,
    toolCallId: null,
    status: Runs.running,
    text: null,
    data: { runtimeRunId: "native-a" },
    ...overrides,
  };
}

function stopped(sequence = 10, targetRunId = "native-a") {
  return event(sequence, Events.runtimeStopped, {
    runId: targetRunId,
    correlationId: "customer-control-correlation",
    stage: null,
    data: { runtimeControl: { state: Controls.stopped, targetRunId } },
  });
}

test("native Stop closes worker activity across logical run and correlation IDs; a request does not", () => {
  const work = [
    event(1, Events.boundaryStarted),
    event(2, Events.modelCallStarted),
  ];
  assert.equal(deriveAgentStreamRunOutcome(work), Outcomes.running);
  assert.equal(
    deriveAgentStreamRunOutcome([
      ...work,
      { ...stopped(), eventType: Events.runtimeStopRequested },
    ]),
    Outcomes.running,
  );
  const ack = [...work, stopped()];
  assert.equal(deriveAgentStreamRunOutcome(ack), Outcomes.paused);
  assert.equal(
    projectStreamRows(ack).some(
      (row) => row.status === STREAM_ROW_STATUSES.running,
    ),
    false,
  );
  const late = [
    ...ack,
    event(11, Events.modelCallHeartbeat),
    event(12, Events.boundaryStarted),
  ];
  assert.equal(deriveAgentStreamRunOutcome(late), Outcomes.paused);
});

test("native Stop preserves finished rules and settles only its generation's open rule", () => {
  const rules = [Runs.completed, Runs.failed, Runs.running].map(
    (status, index) =>
      event(index + 1, Events.engineeringRule, {
        status,
        engineeringRuleId: `rule-${index}`,
        data: {
          runtimeRunId: "native-a",
          schemaVersion: ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS.semanticV1,
          kind: ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.engineeringRule,
        },
      }),
  );
  const settled = finalizeRuleHeaders(projectAgentStreamRuleHeaders(rules), [
    ...rules,
    stopped(),
  ]);
  assert.equal(settled.get("rule-0")?.status, Runs.completed);
  assert.equal(settled.get("rule-1")?.status, Runs.failed);
  assert.equal(settled.get("rule-2")?.status, Runs.waiting);
  const newer = event(11, Events.boundaryStarted, {
    data: { runtimeRunId: "native-b" },
  });
  assert.equal(
    deriveAgentStreamRunOutcome([...rules, stopped(), newer]),
    Outcomes.running,
  );
  assert.equal(
    deriveAgentStreamRunOutcome([newer, stopped(12, "native-a")]),
    Outcomes.running,
  );
});

test("reloaded history joins native control with its stages and marks abandoned older attempts non-live", () => {
  const events = [
    event(1, Events.boundaryStarted, { data: null }),
    event(2, Events.modelCallStarted, { data: null }),
    event(3, Events.boundaryStarted),
    event(4, Events.modelCallStarted),
    stopped(),
  ];
  const grouped = groupAgentStreamEventsByStage(events);
  const turns = groupAgentStreamActivityByTurnKey([
    {
      stage: Stages.ruleAnalysis,
      groups: groupAgentStreamEventsByRun(grouped.byStage[Stages.ruleAnalysis]),
    },
  ]);
  assert.equal(turns.length, 2);
  assert.equal(turns[0]?.superseded, true);
  assert.equal(turns[1]?.superseded, false);
  assert.equal(deriveAgentStreamRunOutcome(turns[1]!.events), Outcomes.paused);
});

test("sidebar uses an acknowledged native stop without changing finished steps or domain workflow state", () => {
  const base = normalizeAssessmentRuntime({
    assessmentId: "assessment",
    interviewState: null,
  });
  const runtime = {
    ...base,
    workflow: {
      ...base.workflow,
      status: Runs.running,
      steps: [
        {
          id: Steps.interview,
          label: "Interview",
          status: Statuses.completed,
          detail: null,
        },
        {
          id: Steps.ruleAnalysis,
          label: "Rule analysis",
          status: Statuses.running,
          detail: null,
        },
        {
          id: Steps.gate,
          label: "Gate",
          status: Statuses.queued,
          detail: null,
        },
      ],
    },
  };
  const work = [event(1, Events.modelCallStarted)];
  const control = {
    state: Controls.stopped,
    targetRunId: "native-a",
    requestId: "stop-request",
  };
  const shown = applyAssessmentRuntimeControlPresentation(
    runtime,
    work,
    control,
  );
  assert.deepEqual(
    shown.workflow.steps.map((step) => step.status),
    [Statuses.completed, Statuses.stopped, Statuses.queued],
  );
  assert.equal(shown.workflow.status, Runs.running);
  assert.equal(runtime.workflow.steps[1]?.status, Statuses.running);
  assert.equal(
    applyAssessmentRuntimeControlPresentation(runtime, work, {
      ...control,
      state: Controls.stopRequested,
    }),
    runtime,
  );
  assert.equal(
    applyAssessmentRuntimeControlPresentation(runtime, work, {
      ...control,
      targetRunId: "other-native",
    }),
    runtime,
  );
  const resumed = [
    ...work,
    stopped(),
    event(11, Events.modelCallStarted, { data: { runtimeRunId: "native-b" } }),
  ];
  assert.equal(
    applyAssessmentRuntimeControlPresentation(runtime, resumed, {
      ...control,
      state: Controls.running,
      targetRunId: "native-b",
    }),
    runtime,
  );
});
