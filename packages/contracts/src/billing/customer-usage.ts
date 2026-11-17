import { z } from "zod";
import { customerUsageSellingPriceSchema } from "./customer-pricing.ts";
import {
  adminUsageQuerySchema,
  adminUsageAnalyticsSchema,
  adminUsageInvocationSchema,
  referenceCostSnapshotSchema,
  USAGE_ANALYTICS_DIMENSIONS,
} from "./usage-analytics.ts";

// Customer queries cannot choose an owner or expose internal workflow filters.
const customerUsageQueryBase = z.strictObject({
  from: adminUsageQuerySchema.shape.from,
  to: adminUsageQuerySchema.shape.to,
  provider: adminUsageQuerySchema.shape.provider,
  model: adminUsageQuerySchema.shape.model,
  attemptStatus: adminUsageQuerySchema.shape.attemptStatus,
  page: adminUsageQuerySchema.shape.page,
  pageSize: adminUsageQuerySchema.shape.pageSize,
});
export const customerUsageQuerySchema = customerUsageQueryBase.superRefine(
  validateCustomerUsagePeriod,
);

/**
 * Business purpose: Keep customer usage reporting within the same bounded period as Admin analytics.
 * Business rules:
 * - Reuse the ordered, maximum-90-day reporting policy after customer-only fields are validated.
 * Execution flow:
 * 1. Validate the normalized query using the shared reporting policy and forward validation issues.
 * Failure cases:
 * - Reversed or overlong periods are rejected; unknown owner/filter fields are rejected by the strict object.
 * Side effects:
 * - Pure validation; no analytics or billing state changes.
 */
function validateCustomerUsagePeriod(
  value: z.infer<typeof customerUsageQueryBase>,
  context: z.RefinementCtx,
) {
  const result = adminUsageQuerySchema.safeParse(value);
  if (!result.success) {
    for (const issue of result.error.issues) {
      context.addIssue({
        code: "custom",
        path: issue.path,
        message: issue.message,
      });
    }
  }
}
export type CustomerUsageQuery = z.infer<typeof customerUsageQuerySchema>;

export const CUSTOMER_USAGE_DIMENSIONS = {
  DAY: USAGE_ANALYTICS_DIMENSIONS.DAY,
  PROVIDER: USAGE_ANALYTICS_DIMENSIONS.PROVIDER,
  MODEL: USAGE_ANALYTICS_DIMENSIONS.MODEL,
} as const;

export const customerUsageReferenceCostSchema =
  referenceCostSnapshotSchema.pick({
    currency: true,
    status: true,
    knownCostUsd: true,
    estimatedCostUsd: true,
  });
export const customerUsageInvocationSchema = adminUsageInvocationSchema
  .pick({
    id: true,
    provider: true,
    model: true,
    attemptStatus: true,
    tokens: true,
    occurredAt: true,
  })
  .extend({ referenceCost: customerUsageReferenceCostSchema.nullable() });
export const customerUsageAnalyticsSchema = adminUsageAnalyticsSchema
  .pick({
    from: true,
    to: true,
    summary: true,
    page: true,
    pageSize: true,
    totalCount: true,
  })
  .extend({
    sellingPrice: customerUsageSellingPriceSchema,
    breakdowns: z.array(
      z.object({
        dimension: z.enum(CUSTOMER_USAGE_DIMENSIONS),
        key: z.string(),
        summary: adminUsageAnalyticsSchema.shape.summary,
      }),
    ),
    items: z.array(customerUsageInvocationSchema),
  });
export type CustomerUsageAnalytics = z.infer<
  typeof customerUsageAnalyticsSchema
>;
