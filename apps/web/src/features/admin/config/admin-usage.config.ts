import {
  USAGE_TOKEN_FIELDS,
  USAGE_ANALYTICS_DIMENSIONS,
} from "@lcsp/contracts/billing";
export const USAGE_FILTER_FIELDS = [
  "from",
  "to",
  "provider",
  "model",
  "agentRole",
  "assessmentId",
  "runId",
  "userId",
] as const;
export const USAGE_SUMMARY_FIELDS = [
  "calls",
  "successfulResponses",
  "failedAttempts",
  "unresolvedAttempts",
  "usageUnknownInvocations",
  "unpricedInvocations",
] as const;
export { USAGE_TOKEN_FIELDS, USAGE_ANALYTICS_DIMENSIONS };
export const DEFAULT_USAGE_FILTERS = {
  from: "",
  to: "",
  provider: "",
  model: "",
  agentRole: "",
  assessmentId: "",
  runId: "",
  userId: "",
  attemptStatus: "",
} as const;

export const USAGE_INVOCATION_COLUMNS = [
  "occurredAt",
  "provider",
  "model",
  "agentRole",
  "status",
  "estimatedCost",
  "details",
] as const;
export const USAGE_INVOCATION_DETAILS = [
  "invocationId",
  "runId",
  "assessmentId",
  "agentRole",
  "provider",
  "model",
  "failureClass",
] as const;
export const USAGE_BREAKDOWN_COLUMNS = [
  "group",
  "calls",
  "totalTokens",
  "knownSubtotal",
  "incompleteCostInvocations",
] as const;
