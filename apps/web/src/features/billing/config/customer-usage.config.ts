import {
  CUSTOMER_USAGE_DIMENSIONS,
  MODEL_ATTEMPT_STATUSES,
  REFERENCE_COST_STATUSES,
} from "@lcsp/contracts/billing";
import type { MessageKey } from "@lcsp/i18n";

import type { FormSelectOption } from "@/components/types/form-select-field.types";

export const CUSTOMER_USAGE_PERIODS = [7, 30, 90] as const;
export const CUSTOMER_USAGE_PAGE_SIZE = 25;
export const CUSTOMER_USAGE_FILTER_FIELDS = [
  "from",
  "to",
  "provider",
  "model",
] as const;
export const CUSTOMER_USAGE_SUMMARY_FIELDS = [
  "calls",
  "successfulResponses",
  "failedAttempts",
  "unresolvedAttempts",
] as const;
export const CUSTOMER_USAGE_VISIBLE_TOKENS = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
] as const;
export const CUSTOMER_USAGE_LABELS = {
  from: "pages.workspace.settingsHub.usage.from",
  to: "pages.workspace.settingsHub.usage.to",
  provider: "pages.workspace.settingsHub.usage.provider",
  model: "pages.workspace.settingsHub.usage.model",
  calls: "pages.workspace.settingsHub.usage.calls",
  successfulResponses: "pages.workspace.settingsHub.usage.successfulResponses",
  failedAttempts: "pages.workspace.settingsHub.usage.failedAttempts",
  unresolvedAttempts: "pages.workspace.settingsHub.usage.unresolvedAttempts",
  inputTokens: "pages.workspace.settingsHub.usage.inputTokens",
  outputTokens: "pages.workspace.settingsHub.usage.outputTokens",
  totalTokens: "pages.workspace.settingsHub.usage.totalTokens",
  [CUSTOMER_USAGE_DIMENSIONS.DAY]: "pages.workspace.settingsHub.usage.byDay",
  [CUSTOMER_USAGE_DIMENSIONS.PROVIDER]:
    "pages.workspace.settingsHub.usage.byProvider",
  [CUSTOMER_USAGE_DIMENSIONS.MODEL]:
    "pages.workspace.settingsHub.usage.byModel",
} as const satisfies Record<string, MessageKey>;
export const CUSTOMER_USAGE_STATUS_LABELS = {
  [MODEL_ATTEMPT_STATUSES.STARTED]: "pages.workspace.settingsHub.usage.started",
  [MODEL_ATTEMPT_STATUSES.COMPLETED]:
    "pages.workspace.settingsHub.usage.completed",
  [MODEL_ATTEMPT_STATUSES.FAILED]: "pages.workspace.settingsHub.usage.failed",
  [MODEL_ATTEMPT_STATUSES.OUTCOME_UNKNOWN]:
    "pages.workspace.settingsHub.usage.unknown",
} as const satisfies Record<string, MessageKey>;

export const CUSTOMER_USAGE_STATUS_OPTIONS = [
  { value: "", labelKey: "pages.workspace.settingsHub.usage.all" },
  ...Object.values(MODEL_ATTEMPT_STATUSES).map((status) => ({
    value: status,
    labelKey: CUSTOMER_USAGE_STATUS_LABELS[status],
  })),
] satisfies FormSelectOption[];
export const CUSTOMER_USAGE_COST_LABELS = {
  [REFERENCE_COST_STATUSES.COMPLETE]:
    "pages.workspace.settingsHub.usage.completeCost",
  [REFERENCE_COST_STATUSES.PARTIAL]:
    "pages.workspace.settingsHub.usage.partialCost",
  [REFERENCE_COST_STATUSES.UNPRICED]:
    "pages.workspace.settingsHub.usage.unpricedCost",
  [REFERENCE_COST_STATUSES.UNKNOWN]:
    "pages.workspace.settingsHub.usage.unknown",
} as const satisfies Record<string, MessageKey>;
