import {
  ASSESSMENT_RUNTIME_SUMMARY_MESSAGE_KEYS,
  type AssessmentRuntimeSummaryMessageKey,
} from "@lcsp/contracts/evidence";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";

import { appLocale } from "../../../lib/locale";

import type {
  WorkspaceRuntimeActivityItem,
  WorkspaceRuntimeSummaryValue,
} from "../types/workspace-runtime.types";

const SUMMARY_MESSAGE_KEY_TO_I18N_KEY: Record<
  AssessmentRuntimeSummaryMessageKey,
  MessageKey
> = {
  [ASSESSMENT_RUNTIME_SUMMARY_MESSAGE_KEYS.engineeringRulePlannerDecision]:
    "pages.assessmentFlow.technicalEvidence.plannerDecision",
  [ASSESSMENT_RUNTIME_SUMMARY_MESSAGE_KEYS.engineeringRuleInvestigationFailed]:
    "pages.assessmentFlow.technicalEvidence.investigationFailed",
  [ASSESSMENT_RUNTIME_SUMMARY_MESSAGE_KEYS.engineeringRuleInvestigated]:
    "pages.assessmentFlow.technicalEvidence.investigated",
  [ASSESSMENT_RUNTIME_SUMMARY_MESSAGE_KEYS.engineeringRuleReadinessWaiting]:
    "pages.assessmentFlow.technicalEvidence.readinessWaiting",
};

const KNOWN_SUMMARY_MESSAGE_KEYS = new Set<string>(
  Object.values(ASSESSMENT_RUNTIME_SUMMARY_MESSAGE_KEYS),
);

export function runtimeActivityDisplaySummary(
  activity: WorkspaceRuntimeActivityItem,
): string {
  const messageKey =
    runtimeSummaryMessageKey(activity.outputSummary) ??
    runtimeSummaryMessageKey(activity.summary);
  if (!messageKey) {
    return activity.summary;
  }

  const i18nKey = SUMMARY_MESSAGE_KEY_TO_I18N_KEY[messageKey];
  const template = resolveMessage(appLocale, i18nKey);
  return interpolateRuntimeSummary(
    template,
    runtimeSummaryParams(activity.outputSummary),
  );
}

function runtimeSummaryMessageKey(
  value: WorkspaceRuntimeSummaryValue | null,
): AssessmentRuntimeSummaryMessageKey | null {
  if (typeof value === "string" && KNOWN_SUMMARY_MESSAGE_KEYS.has(value)) {
    return value as AssessmentRuntimeSummaryMessageKey;
  }
  if (!isRuntimeSummaryRecord(value)) {
    return null;
  }
  const messageKey = value.messageKey;
  return typeof messageKey === "string" && KNOWN_SUMMARY_MESSAGE_KEYS.has(messageKey)
    ? (messageKey as AssessmentRuntimeSummaryMessageKey)
    : null;
}

function runtimeSummaryParams(
  value: WorkspaceRuntimeSummaryValue | null,
): Record<string, string> {
  if (!isRuntimeSummaryRecord(value) || !isRuntimeSummaryRecord(value.messageParams)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value.messageParams).flatMap(([key, paramValue]) => {
      if (typeof paramValue === "string") {
        return [[key, paramValue]];
      }
      if (typeof paramValue === "number" || typeof paramValue === "boolean") {
        return [[key, String(paramValue)]];
      }
      return [];
    }),
  );
}

export function interpolateRuntimeSummary(
  template: string,
  params: Record<string, string>,
): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? params[key] : placeholder,
  );
}

function isRuntimeSummaryRecord(
  value: WorkspaceRuntimeSummaryValue | null,
): value is Record<string, WorkspaceRuntimeSummaryValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
