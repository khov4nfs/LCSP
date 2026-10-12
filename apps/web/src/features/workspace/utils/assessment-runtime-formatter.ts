import { resolveMessage } from "@lcsp/i18n";
import {
  type AgentExecutionState,
  type AssessmentLifecycleState,
} from "@lcsp/contracts/assessment";
import type { MessageKey } from "@lcsp/i18n";
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

export function canonicalLifecycleLabel(state: AssessmentLifecycleState) {
  return t(`pages.appShell.runtimePanelCanonicalStates.${state}`);
}

export function canonicalExecutionLabel(state: AgentExecutionState) {
  return t(`pages.appShell.runtimePanelCanonicalExecutionStates.${state}`);
}

export function formatLocaleTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(appLocale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function t(key: string) {
  return resolveMessage(appLocale, key as MessageKey);
}
