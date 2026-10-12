import {
  AGENT_EXECUTION_STATES,
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ARTIFACT_LIFECYCLE_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
  RULE_DECISION_APPLICABILITIES,
  RULE_DECISION_COMPLIANCE_OUTCOMES,
  type AssessmentEvent,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DECISION_RECORD_STATES,
  ASSESSMENT_DOMAIN_ACTIVITY_LABEL_KEYS,
} from "@lcsp/contracts/assessment-domain";
import {
  OPENING_LABEL_KEYS,
  WORK_STEP_CATALOG,
} from "../config/work-step-catalog";
import {
  CONVERSATION_NOTICE_KINDS,
  CONVERSATION_TURN_KINDS,
  WORK_STEP_KINDS,
  WORK_STEP_PHASES,
  WORK_STEP_STATUSES,
  type ConversationInput,
  type ConversationNoticeKind,
  type ConversationProjection,
  type ConversationTurn,
  type TechnicalEvent,
  type UsageTotals,
  type WorkStep,
  type WorkStepKind,
  type WorkTurn,
} from "../types/conversation.types";
import { addUsage, sumTurnUsage, takeUsage } from "./conversation-usage";
import { isRuntimeRunning } from "./customer-assessment-state";

type StepAccumulator = {
  kind: WorkStepKind;
  started: number;
  done: number;
  single: number;
  usage: UsageTotals | null;
  touched: number;
};

type WorkBuilder = {
  firstSequence: number;
  startedAt: string;
  lastAt: string;
  steps: Map<WorkStepKind, StepAccumulator>;
  technical: TechnicalEvent[];
  touchCounter: number;
  lastKind: WorkStepKind | null;
};

const ROOT_STARTED = ASSESSMENT_DOMAIN_ACTIVITY_LABEL_KEYS.ROOT_STARTED;

function stepOf(label: string | null) {
  return (
    (label ? WORK_STEP_CATALOG[label] : undefined) ?? {
      kind: WORK_STEP_KINDS.OTHER,
      phase: WORK_STEP_PHASES.SINGLE,
    }
  );
}

function technicalOf(
  event: AssessmentEvent,
  invocation: { invocationId: string; usage: UsageTotals } | null,
): TechnicalEvent {
  return {
    eventId: event.eventId,
    sequence: event.sequence,
    timestamp: event.timestamp,
    eventType: event.eventType,
    actorType: event.actorType,
    labelKey:
      event.eventType === AGENTIC_ASSESSMENT_EVENT_TYPES.ACTIVITY_RECORDED
        ? event.payload.labelKey
        : null,
    executionId: event.executionId ?? null,
    taskId: event.taskId ?? null,
    toolCallId: event.toolCallId ?? null,
    invocationId: invocation?.invocationId ?? null,
    usage: invocation?.usage ?? null,
  };
}

function finishWork(
  builder: WorkBuilder,
  endedAt: string,
  running: boolean,
): WorkTurn {
  const accumulators = [...builder.steps.values()].sort(
    (left, right) => left.touched - right.touched,
  );
  const steps: WorkStep[] = accumulators.map((step) => ({
    kind: step.kind,
    count: step.single + Math.max(step.started, step.done),
    status:
      running && step.kind === builder.lastKind
        ? WORK_STEP_STATUSES.ACTIVE
        : WORK_STEP_STATUSES.DONE,
    usage: step.usage,
  }));
  const end = Math.max(Date.parse(endedAt), Date.parse(builder.lastAt));
  return {
    kind: CONVERSATION_TURN_KINDS.WORK,
    id: `work:${builder.firstSequence}`,
    sequence: builder.firstSequence,
    at: builder.startedAt,
    endedAt: new Date(end).toISOString(),
    durationMs: Math.max(0, end - Date.parse(builder.startedAt)),
    running,
    steps,
    usage: sumTurnUsage(steps),
    technical: builder.technical,
  };
}

/**
 * The one deterministic projection of canonical state into the conversation:
 * events + human requests + accepted answers + decisions + lifecycle/runtime + usage -> turns.
 * Live updates and reloads render the SAME function over the SAME inputs. It reads no clock,
 * so equal inputs always give equal turns.
 */
export function projectConversation(
  input: ConversationInput,
): ConversationProjection {
  const { detail } = input;
  const events = normalizeEvents(input.events);
  const lifecycle = detail?.lifecycle ?? null;
  const runtime = detail?.runtime ?? null;
  const running = isRuntimeRunning(lifecycle, runtime);
  const decisions = new Map(
    (detail?.case?.decisions ?? []).map((record) => [
      record.decisionId,
      record,
    ]),
  );
  const concepts = new Map(
    (detail?.case?.coverage ?? []).map((row) => [
      row.assessmentRuleId,
      row.concept,
    ]),
  );
  const requests = new Map(
    input.requests.map((request) => [request.requestId, request]),
  );
  const pendingAnswers = input.requests
    .flatMap((request) =>
      request.answers.map((answer, index) => ({
        requestId: request.requestId,
        index,
        answeredAt: answer.answeredAt,
        doesNotKnow: answer.doesNotKnow,
        answer: answer.answer,
      })),
    )
    .sort(
      (left, right) =>
        left.answeredAt.localeCompare(right.answeredAt) ||
        left.index - right.index,
    );

  const turns: ConversationTurn[] = [];
  const seenInvocations = new Set<string>();
  const state: { work: WorkBuilder | null } = { work: null };
  let completionEmitted = false;
  let lastSequence = 0;

  const started =
    lifecycle !== null &&
    lifecycle.state !== ASSESSMENT_LIFECYCLE_STATES.CREATED &&
    lifecycle.state !== ASSESSMENT_LIFECYCLE_STATES.PREPARING;
  if (started) {
    turns.push({
      kind: CONVERSATION_TURN_KINDS.OPENING,
      id: "opening",
      sequence: 0,
      at: events[0]?.timestamp ?? detail?.created_at ?? "",
      repositoryFullName: input.repository?.fullName ?? null,
      commit:
        input.repository?.commit ?? detail?.case?.repositoryCommit ?? null,
      ruleSetVersion: detail?.case?.ruleSet?.version ?? null,
    });
  }

  const closeWork = (endedAt: string) => {
    if (!state.work) return;
    turns.push(finishWork(state.work, endedAt, false));
    state.work = null;
  };
  const pushNotice = (
    notice: ConversationNoticeKind,
    event: AssessmentEvent,
    blockerReason: string | null = null,
  ) => {
    const previous = turns.at(-1);
    if (
      previous?.kind === CONVERSATION_TURN_KINDS.NOTICE &&
      previous.notice === notice
    )
      return;
    closeWork(event.timestamp);
    turns.push({
      kind: CONVERSATION_TURN_KINDS.NOTICE,
      id: `notice:${event.sequence}`,
      sequence: event.sequence,
      at: event.timestamp,
      notice,
      blockerReason,
    });
  };
  const flushAnswers = (until: string | null) => {
    while (
      pendingAnswers.length > 0 &&
      (until === null || pendingAnswers[0]!.answeredAt <= until)
    ) {
      const answer = pendingAnswers.shift()!;
      if (
        !turns.some(
          (turn) =>
            turn.kind === CONVERSATION_TURN_KINDS.QUESTION &&
            turn.request.requestId === answer.requestId,
        )
      ) {
        // The question turn appears with its OPEN event; an answer never precedes it.
        pendingAnswers.unshift(answer);
        return;
      }
      closeWork(answer.answeredAt);
      turns.push({
        kind: CONVERSATION_TURN_KINDS.ANSWER,
        id: `answer:${answer.requestId}:${answer.index}`,
        sequence: lastSequence,
        at: answer.answeredAt,
        requestId: answer.requestId,
        answer: answer.doesNotKnow ? null : answer.answer,
        doesNotKnow: answer.doesNotKnow,
      });
    }
  };

  let waitingForInput = false;
  for (const event of events) {
    flushAnswers(event.timestamp);
    lastSequence = event.sequence;
    switch (event.eventType) {
      case AGENTIC_ASSESSMENT_EVENT_TYPES.ACTIVITY_RECORDED: {
        const label = event.payload.labelKey;
        if (OPENING_LABEL_KEYS.has(label) || label === ROOT_STARTED) break;
        const invocation = takeUsage(event, seenInvocations);
        const step = stepOf(label);
        if (!state.work) {
          state.work = {
            firstSequence: event.sequence,
            startedAt: event.timestamp,
            lastAt: event.timestamp,
            steps: new Map(),
            technical: [],
            touchCounter: 0,
            lastKind: null,
          };
        }
        const builder: WorkBuilder = state.work;
        builder.lastAt = event.timestamp;
        builder.touchCounter += 1;
        builder.lastKind = step.kind;
        const accumulator = builder.steps.get(step.kind) ?? {
          kind: step.kind,
          started: 0,
          done: 0,
          single: 0,
          usage: null,
          touched: 0,
        };
        if (accumulator.touched === 0)
          accumulator.touched = builder.touchCounter;
        if (step.phase === WORK_STEP_PHASES.START) accumulator.started += 1;
        else if (step.phase === WORK_STEP_PHASES.DONE) accumulator.done += 1;
        else accumulator.single += 1;
        if (invocation)
          accumulator.usage = addUsage(accumulator.usage, invocation.usage);
        builder.steps.set(step.kind, accumulator);
        builder.technical.push(technicalOf(event, invocation));
        break;
      }
      case AGENTIC_ASSESSMENT_EVENT_TYPES.EVIDENCE_ACCEPTED: {
        // Evidence is technical detail of the surrounding work, never a turn of its own.
        const invocation = takeUsage(event, seenInvocations);
        state.work?.technical.push(technicalOf(event, invocation));
        break;
      }
      case AGENTIC_ASSESSMENT_EVENT_TYPES.EXECUTION_STATE_CHANGED: {
        const { fromState, toState } = event.payload;
        if (
          toState === AGENT_EXECUTION_STATES.PAUSED ||
          toState === AGENT_EXECUTION_STATES.INTERRUPTED
        ) {
          closeWork(event.timestamp);
          if (!waitingForInput)
            pushNotice(CONVERSATION_NOTICE_KINDS.PAUSED, event);
        } else if (
          toState === AGENT_EXECUTION_STATES.RUNNING &&
          (fromState === AGENT_EXECUTION_STATES.PAUSED ||
            fromState === AGENT_EXECUTION_STATES.INTERRUPTED)
        )
          pushNotice(CONVERSATION_NOTICE_KINDS.RESUMED, event);
        else if (toState === AGENT_EXECUTION_STATES.FAILED)
          pushNotice(CONVERSATION_NOTICE_KINDS.FAILED, event);
        break;
      }
      case AGENTIC_ASSESSMENT_EVENT_TYPES.ASSESSMENT_LIFECYCLE_CHANGED: {
        const change = event.payload;
        waitingForInput =
          change.toState === ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN ||
          change.toState ===
            ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT;
        if (change.toState === ASSESSMENT_LIFECYCLE_STATES.BLOCKED)
          pushNotice(
            CONVERSATION_NOTICE_KINDS.BLOCKED,
            event,
            change.blocker.reason,
          );
        else if (change.toState === ASSESSMENT_LIFECYCLE_STATES.FINALIZING)
          pushNotice(CONVERSATION_NOTICE_KINDS.FINALIZING, event);
        else if (change.toState === ASSESSMENT_LIFECYCLE_STATES.FAILED)
          pushNotice(CONVERSATION_NOTICE_KINDS.FAILED, event);
        else if (
          change.toState === ASSESSMENT_LIFECYCLE_STATES.COMPLETE &&
          !completionEmitted
        ) {
          closeWork(event.timestamp);
          turns.push(completionTurn(input, event.sequence, event.timestamp));
          completionEmitted = true;
        }
        break;
      }
      case AGENTIC_ASSESSMENT_EVENT_TYPES.HUMAN_RESOLUTION_CHANGED: {
        const { requestId, toStatus } = event.payload;
        const request = requests.get(requestId);
        if (
          toStatus === HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN &&
          request &&
          !turns.some(
            (turn) =>
              turn.kind === CONVERSATION_TURN_KINDS.QUESTION &&
              turn.request.requestId === requestId,
          )
        ) {
          closeWork(event.timestamp);
          turns.push({
            kind: CONVERSATION_TURN_KINDS.QUESTION,
            id: `question:${requestId}`,
            sequence: event.sequence,
            at: event.timestamp,
            request,
            open: request.status === HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
          });
        }
        break;
      }
      case AGENTIC_ASSESSMENT_EVENT_TYPES.DECISION_ACCEPTED: {
        const record = decisions.get(event.payload.decisionId);
        const invocation = takeUsage(event, seenInvocations);
        void invocation;
        if (record) {
          closeWork(event.timestamp);
          turns.push({
            kind: CONVERSATION_TURN_KINDS.DECISION,
            id: `decision:${record.decisionId}`,
            sequence: event.sequence,
            at: event.timestamp,
            decisionId: record.decisionId,
            assessmentRuleId: record.assessmentRuleId,
            concept: concepts.get(record.assessmentRuleId) ?? null,
            record,
          });
        }
        break;
      }
      case AGENTIC_ASSESSMENT_EVENT_TYPES.ARTIFACT_CHANGED:
        break;
    }
  }

  if (
    !completionEmitted &&
    lifecycle?.state === ASSESSMENT_LIFECYCLE_STATES.COMPLETE
  ) {
    closeWork(detail?.updated_at ?? "");
    turns.push(completionTurn(input, lastSequence, detail?.updated_at ?? ""));
  }
  // A question the event window does not carry still belongs in the conversation: OPEN ones as
  // the live question, answered ones as history (before their answers).
  for (const request of input.requests) {
    if (
      !turns.some(
        (turn) =>
          turn.kind === CONVERSATION_TURN_KINDS.QUESTION &&
          turn.request.requestId === request.requestId,
      )
    ) {
      closeWork(detail?.updated_at ?? "");
      turns.push({
        kind: CONVERSATION_TURN_KINDS.QUESTION,
        id: `question:${request.requestId}`,
        sequence: lastSequence,
        at: detail?.updated_at ?? "",
        request,
        open: request.status === HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
      });
    }
  }
  flushAnswers(null);

  const tail = turns.at(-1);
  if (state.work) {
    turns.push(finishWork(state.work, state.work.lastAt, running));
  } else if (running) {
    const at = tail?.at || detail?.updated_at || "";
    turns.push({
      kind: CONVERSATION_TURN_KINDS.WORK,
      id: `work:pending:${lastSequence}`,
      sequence: lastSequence,
      at,
      endedAt: at,
      durationMs: 0,
      running: true,
      steps: [],
      usage: null,
      technical: [],
    });
  }

  const openRequest = input.requests.find(
    (request) => request.status === HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
  );
  return {
    turns,
    running,
    openRequestId: openRequest?.requestId ?? null,
    followKey: [
      lastSequence,
      turns.length,
      running ? "R" : "S",
      lifecycle?.state ?? "-",
      input.requests.reduce(
        (count, request) => count + request.answers.length,
        0,
      ),
    ].join(":"),
  };
}

/** One event per id, in canonical sequence order, whatever order or duplication it arrived in. */
function normalizeEvents(
  events: readonly AssessmentEvent[],
): AssessmentEvent[] {
  const byId = new Map<string, AssessmentEvent>();
  for (const event of events)
    if (!byId.has(event.eventId)) byId.set(event.eventId, event);
  return [...byId.values()].sort(
    (left, right) =>
      left.sequence - right.sequence ||
      left.timestamp.localeCompare(right.timestamp),
  );
}

function completionTurn(
  input: ConversationInput,
  sequence: number,
  at: string,
): ConversationTurn {
  const records = (input.detail?.case?.decisions ?? []).filter(
    (record) => record.state === ASSESSMENT_DECISION_RECORD_STATES.ACCEPTED,
  );
  const report = input.detail?.case?.artifacts.find(
    (artifact) => artifact.lifecycleState === ARTIFACT_LIFECYCLE_STATES.ACTIVE,
  );
  return {
    kind: CONVERSATION_TURN_KINDS.COMPLETION,
    id: "completion",
    sequence,
    at,
    assessmentId: input.assessmentId,
    evaluated: records.length,
    compliant: records.filter(
      (record) =>
        record.decision.compliance ===
        RULE_DECISION_COMPLIANCE_OUTCOMES.COMPLIANT,
    ).length,
    nonCompliant: records.filter(
      (record) =>
        record.decision.compliance ===
        RULE_DECISION_COMPLIANCE_OUTCOMES.NON_COMPLIANT,
    ).length,
    notApplicable: records.filter(
      (record) =>
        record.decision.applicability ===
        RULE_DECISION_APPLICABILITIES.NOT_APPLICABLE,
    ).length,
    reportArtifactId: report?.artifactId ?? null,
  };
}
