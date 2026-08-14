import { resolveMessage } from "@lcsp/i18n";
import {
  ASSESSMENT_RUNTIME_EVENT_TYPES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  ASSESSMENT_RUNTIME_STAGE_CODES,
} from "@lcsp/contracts/evidence";
import { appLocale } from "../../../lib/locale.ts";
import {
  WORKSPACE_RUNTIME_CONNECTION_STATES,
  type WorkspaceRuntimeConnectionState,
} from "../types/workspace-runtime.types.ts";

export function connectionLabel(state: WorkspaceRuntimeConnectionState) {
  if (state === WORKSPACE_RUNTIME_CONNECTION_STATES.connected) {
    return t("pages.appShell.runtimePanelConnection.connected");
  }
  if (state === WORKSPACE_RUNTIME_CONNECTION_STATES.disconnected) {
    return t("pages.appShell.runtimePanelConnection.disconnected");
  }
  return t("pages.appShell.runtimePanelConnection.connecting");
}

export function runStatusLabel(status: string) {
  switch (status) {
    case ASSESSMENT_RUNTIME_RUN_STATUSES.running:
      return t("pages.appShell.runtimePanelStatuses.running");
    case ASSESSMENT_RUNTIME_RUN_STATUSES.waiting:
      return t("pages.appShell.runtimePanelStatuses.waiting");
    case ASSESSMENT_RUNTIME_RUN_STATUSES.completed:
      return t("pages.appShell.runtimePanelStatuses.completed");
    case ASSESSMENT_RUNTIME_RUN_STATUSES.failed:
      return t("pages.appShell.runtimePanelStatuses.failed");
    default:
      return status;
  }
}

export function stageLabel(stage: string) {
  switch (stage) {
    case ASSESSMENT_RUNTIME_STAGE_CODES.snapshot:
      return t("pages.appShell.runtimePanelStages.snapshot");
    case ASSESSMENT_RUNTIME_STAGE_CODES.scan:
      return t("pages.appShell.runtimePanelStages.scan");
    case ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence:
      return t("pages.appShell.runtimePanelStages.technicalEvidence");
    case ASSESSMENT_RUNTIME_STAGE_CODES.technicalProfile:
      return t("pages.appShell.runtimePanelStages.technicalProfile");
    case ASSESSMENT_RUNTIME_STAGE_CODES.aiUsageFlow:
      return t("pages.appShell.runtimePanelStages.aiUsageFlow");
    case ASSESSMENT_RUNTIME_STAGE_CODES.reconciliation:
      return t("pages.appShell.runtimePanelStages.reconciliation");
    case ASSESSMENT_RUNTIME_STAGE_CODES.classification:
      return t("pages.appShell.runtimePanelStages.classification");
    case ASSESSMENT_RUNTIME_STAGE_CODES.conflicts:
      return t("pages.appShell.runtimePanelStages.conflicts");
    case ASSESSMENT_RUNTIME_STAGE_CODES.documents:
      return t("pages.appShell.runtimePanelStages.documents");
    case ASSESSMENT_RUNTIME_STAGE_CODES.legalRetrieval:
      return t("pages.appShell.runtimePanelStages.legalRetrieval");
    default:
      return stage;
  }
}

export function runtimeEventLabel(eventType: string) {
  switch (eventType) {
    case ASSESSMENT_RUNTIME_EVENT_TYPES.runStarted:
      return t("pages.appShell.runtimePanelEvents.runStarted");
    case ASSESSMENT_RUNTIME_EVENT_TYPES.runStageChanged:
      return t("pages.appShell.runtimePanelEvents.runStageChanged");
    case ASSESSMENT_RUNTIME_EVENT_TYPES.toolStarted:
      return t("pages.appShell.runtimePanelEvents.toolStarted");
    case ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted:
      return t("pages.appShell.runtimePanelEvents.toolCompleted");
    case ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed:
      return t("pages.appShell.runtimePanelEvents.toolFailed");
    case ASSESSMENT_RUNTIME_EVENT_TYPES.toolWaitingInput:
      return t("pages.appShell.runtimePanelEvents.toolWaitingInput");
    case ASSESSMENT_RUNTIME_EVENT_TYPES.toolSkipped:
      return t("pages.appShell.runtimePanelEvents.toolSkipped");
    case ASSESSMENT_RUNTIME_EVENT_TYPES.runCompleted:
      return t("pages.appShell.runtimePanelEvents.runCompleted");
    case ASSESSMENT_RUNTIME_EVENT_TYPES.runFailed:
      return t("pages.appShell.runtimePanelEvents.runFailed");
    default:
      return eventType;
  }
}

export function formatTimelineTime(value: string, isHydrated: boolean) {
  if (!isHydrated) {
    return formatStableTimestamp(value);
  }
  return formatRelativeTime(value);
}

export function formatStableTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString();
}

export function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  const deltaSeconds = Math.max(
    0,
    Math.round((Date.now() - timestamp) / 1000),
  );
  if (deltaSeconds < 60) {
    return `${deltaSeconds}s`;
  }
  const deltaMinutes = Math.round(deltaSeconds / 60);
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m`;
  }
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h`;
  }
  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays}d`;
}

function t(key: string) {
  return resolveMessage(appLocale, key as Parameters<typeof resolveMessage>[1]);
}
