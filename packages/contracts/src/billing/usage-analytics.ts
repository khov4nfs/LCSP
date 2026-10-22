import { z } from "zod";

export const MODEL_ATTEMPT_STATUSES = {
  STARTED: "STARTED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  OUTCOME_UNKNOWN: "OUTCOME_UNKNOWN",
} as const;
export type ModelAttemptStatus =
  (typeof MODEL_ATTEMPT_STATUSES)[keyof typeof MODEL_ATTEMPT_STATUSES];

export const REFERENCE_COST_STATUSES = {
  COMPLETE: "COMPLETE",
  PARTIAL: "PARTIAL",
  UNPRICED: "UNPRICED",
  UNKNOWN: "UNKNOWN",
} as const;
export const USAGE_ANALYTICS_DIMENSIONS = {
  PROVIDER: "PROVIDER",
  MODEL: "MODEL",
  AGENT_ROLE: "AGENT_ROLE",
  WORKFLOW: "WORKFLOW",
  DAY: "DAY",
  STATUS: "STATUS",
} as const;
export const REFERENCE_COST_BASIS = "OFFICIAL_MODEL_PRICING";
export const REFERENCE_COST_CURRENCY = "USD";
export const REFERENCE_PRICE_SCOPE = "STANDARD_TOKEN_CONSUMPTION";
export const USAGE_TOKEN_FIELDS = [
  "inputTokens",
  "inputTokensIncludingCache",
  "cachedInputTokens",
  "cacheWriteTokens",
  "cacheWrite5mTokens",
  "cacheWrite1hTokens",
  "outputTokens",
  "visibleOutputTokens",
  "reasoningTokens",
  "totalTokens",
] as const;
export type UsageTokenField = (typeof USAGE_TOKEN_FIELDS)[number];

const text = z.string().trim().min(1).max(200);
const count = z.string().regex(/^\d+$/);
export const adminUsageQuerySchema = z
  .object({
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    provider: text.optional(),
    model: text.optional(),
    agentRole: text.optional(),
    assessmentId: text.optional(),
    runId: text.optional(),
    userId: text.optional(),
    attemptStatus: z.enum(MODEL_ATTEMPT_STATUSES).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .superRefine((x, ctx) => {
    const to = x.to ? Date.parse(x.to) : Date.now();
    const from = x.from ? Date.parse(x.from) : to - 30 * 86400000;
    if (from > to || to - from > 90 * 86400000)
      ctx.addIssue({
        code: "custom",
        message: "Usage period must be ordered and at most 90 days",
      });
  });
export type AdminUsageQuery = z.infer<typeof adminUsageQuerySchema>;

export const referenceCostSnapshotSchema = z.object({
  basis: z.literal(REFERENCE_COST_BASIS),
  currency: z.literal(REFERENCE_COST_CURRENCY),
  scope: z.literal(REFERENCE_PRICE_SCOPE),
  status: z.enum(REFERENCE_COST_STATUSES),
  priceVersionId: z.string().nullable(),
  developer: z.string().nullable(),
  canonicalModel: z.string().nullable(),
  sourceUrl: z.url().nullable(),
  evidenceSha256: z.string().nullable(),
  knownCostAttodollars: count,
  knownCostUsd: z.string(),
  estimatedCostUsd: z.string().nullable(),
  missingCategories: z.array(z.string()),
  ratesPerMillion: z.record(z.string(), z.string().nullable()).nullable(),
});
export type ReferenceCostSnapshot = z.infer<typeof referenceCostSnapshotSchema>;
const metric = z.object({
  known: count,
  unknownInvocations: z.number().int().nonnegative(),
});
export const usageAnalyticsSummarySchema = z.object({
  calls: z.number().int().nonnegative(),
  successfulResponses: z.number().int().nonnegative(),
  failedAttempts: z.number().int().nonnegative(),
  unresolvedAttempts: z.number().int().nonnegative(),
  usageUnknownInvocations: z.number().int().nonnegative(),
  unpricedInvocations: z.number().int().nonnegative(),
  incompleteCostInvocations: z.number().int().nonnegative(),
  tokens: z.record(z.enum(USAGE_TOKEN_FIELDS), metric),
  knownEstimatedCostUsd: z.string(),
  estimatedCostUsd: z.string().nullable(),
});
export type UsageAnalyticsSummary = z.infer<typeof usageAnalyticsSummarySchema>;
export const adminUsageInvocationSchema = z.object({
  id: z.string(),
  invocationId: z.string(),
  runId: z.string().nullable(),
  assessmentId: z.string().nullable(),
  agentRole: z.string(),
  provider: z.string(),
  model: z.string(),
  attemptStatus: z.enum(MODEL_ATTEMPT_STATUSES).nullable(),
  failureClass: z.string().nullable(),
  tokens: z.record(z.enum(USAGE_TOKEN_FIELDS), count.nullable()),
  referenceCost: referenceCostSnapshotSchema.nullable(),
  occurredAt: z.iso.datetime(),
});
export const adminUsageAnalyticsSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  summary: usageAnalyticsSummarySchema,
  breakdowns: z.array(
    z.object({
      dimension: z.enum(USAGE_ANALYTICS_DIMENSIONS),
      key: z.string(),
      summary: usageAnalyticsSummarySchema,
    }),
  ),
  items: z.array(adminUsageInvocationSchema),
  page: z.number(),
  pageSize: z.number(),
  totalCount: z.number(),
});
export type AdminUsageAnalytics = z.infer<typeof adminUsageAnalyticsSchema>;
