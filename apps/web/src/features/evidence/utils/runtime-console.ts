import {
  ASSESSMENT_RUNTIME_EVENT_TYPES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
} from "@lcsp/contracts/evidence";

import type { WorkspaceRuntimeActivityItem } from "../../workspace/types/workspace-runtime.types";

export type RuntimeConsoleStep = {
  id: string;
  item: WorkspaceRuntimeActivityItem;
  isActive: boolean;
  isFailed: boolean;
  isSkipped: boolean;
  isTerminal: boolean;
  defaultExpanded: boolean;
};

export type RuntimeConsoleModel = {
  steps: RuntimeConsoleStep[];
  runningCount: number;
  waitingCount: number;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  activeStep: RuntimeConsoleStep | null;
};

export function selectRuntimeConsoleActivity({
  activity,
  latestScanJobId,
  activeRunId,
  latestRunId,
}: {
  activity: WorkspaceRuntimeActivityItem[];
  latestScanJobId: string | null;
  activeRunId: string | null;
  latestRunId: string | null;
}) {
  const runId = latestScanJobId ?? activeRunId ?? latestRunId;
  if (runId === null) {
    return activity;
  }
  return activity.filter((item) => item.runId === runId);
}

export function buildRuntimeConsoleModel(
  activity: WorkspaceRuntimeActivityItem[],
): RuntimeConsoleModel {
  const latestByCorrelation = new Map<string, WorkspaceRuntimeActivityItem>();

  for (const item of activity) {
    const key = `${item.runId}:${item.stage}:${item.toolName || ""}`;
    const existing = latestByCorrelation.get(key);
    if (!existing || compareRuntimeActivity(item, existing) > 0) {
      latestByCorrelation.set(key, item);
    }
  }

  const steps = Array.from(latestByCorrelation.values())
    .sort(compareRuntimeActivity)
    .map((item): RuntimeConsoleStep => {
      const isActive = isActiveRuntimeStep(item);
      const isFailed =
        item.runStatus === ASSESSMENT_RUNTIME_RUN_STATUSES.failed ||
        item.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed ||
        item.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.runFailed;
      const isSkipped =
        item.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolSkipped;
      const isTerminal = isTerminalRuntimeEvent(item.eventType);

      return {
        id: item.eventId,
        item,
        isActive,
        isFailed,
        isSkipped,
        isTerminal,
        defaultExpanded: isActive || isFailed,
      };
    });

  const activeStep = findActiveStep(steps);

  return {
    steps,
    runningCount: steps.filter(
      (step) =>
        step.isActive &&
        step.item.runStatus === ASSESSMENT_RUNTIME_RUN_STATUSES.running,
    ).length,
    waitingCount: steps.filter(
      (step) =>
        step.isActive &&
        step.item.runStatus === ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
    ).length,
    completedCount: steps.filter(
      (step) =>
        !isWaitingRuntimeStep(step.item) &&
        (step.item.runStatus === ASSESSMENT_RUNTIME_RUN_STATUSES.completed ||
          step.item.eventType ===
            ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted ||
          step.item.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.runCompleted),
    ).length,
    failedCount: steps.filter((step) => step.isFailed).length,
    skippedCount: steps.filter((step) => step.isSkipped).length,
    activeStep,
  };
}

export function isActiveRuntimeStatus(
  status: string | null | undefined,
): boolean {
  return (
    status === ASSESSMENT_RUNTIME_RUN_STATUSES.running ||
    status === ASSESSMENT_RUNTIME_RUN_STATUSES.waiting
  );
}

function isActiveRuntimeStep(item: WorkspaceRuntimeActivityItem) {
  if (isWaitingRuntimeStep(item)) {
    return true;
  }
  if (!isActiveRuntimeStatus(item.runStatus)) {
    return false;
  }
  const events = ASSESSMENT_RUNTIME_EVENT_TYPES;
  return (
    item.eventType === events.runStarted ||
    item.eventType === events.runStageChanged ||
    item.eventType === events.toolStarted ||
    item.eventType === events.toolWaitingInput
  );
}

function isWaitingRuntimeStep(item: WorkspaceRuntimeActivityItem) {
  return (
    item.runStatus === ASSESSMENT_RUNTIME_RUN_STATUSES.waiting ||
    item.eventType === ASSESSMENT_RUNTIME_EVENT_TYPES.toolWaitingInput ||
    item.waitingReason !== null
  );
}

function compareRuntimeActivity(
  left: WorkspaceRuntimeActivityItem,
  right: WorkspaceRuntimeActivityItem,
) {
  const runCompare = left.runId.localeCompare(right.runId);
  if (runCompare !== 0) {
    return runCompare;
  }
  const sequenceCompare = left.sequence - right.sequence;
  if (sequenceCompare !== 0) {
    return sequenceCompare;
  }
  return left.emittedAt.localeCompare(right.emittedAt);
}

function findActiveStep(steps: RuntimeConsoleStep[]) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step?.isActive === true) {
      return step;
    }
  }
  return null;
}

function isTerminalRuntimeEvent(eventType: string) {
  const events = ASSESSMENT_RUNTIME_EVENT_TYPES;
  return (
    eventType === events.toolCompleted ||
    eventType === events.toolFailed ||
    eventType === events.toolSkipped ||
    eventType === events.runCompleted ||
    eventType === events.runFailed
  );
}
