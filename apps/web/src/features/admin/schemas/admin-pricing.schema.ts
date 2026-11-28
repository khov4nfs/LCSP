import { z } from "zod";
import {
  MODEL_PRICING_SCOPES,
  PRICING_ASSIGNMENT_STATUSES,
  adminModelPricingOverviewQuerySchema,
  type AdminModelPricingOverviewQuery,
} from "@lcsp/contracts/billing";

const filterTextSchema = z.string().trim().max(128);

const baseAdminPricingFiltersSchema = z.object({
  provider: filterTextSchema,
  resolvedModel: filterTextSchema,
  scope: z.union([z.enum(MODEL_PRICING_SCOPES), z.literal("")]),
  status: z.union([z.enum(PRICING_ASSIGNMENT_STATUSES), z.literal("")]),
  coverageGapOnly: z.boolean(),
});

export type AdminPricingFilters = z.infer<typeof baseAdminPricingFiltersSchema>;

/**
 * Business purpose: Translate Admin Model Pricing form filter state into normalized API query parameters.
 *
 * Business rules:
 * - Omit blank text fields and `""` sentinel selections so `adminModelPricingOverviewQuerySchema`
 *   only receives active filters.
 * - Exclude client-only `coverageGapOnly` flag from the BFF query object.
 *
 * Execution flow:
 * 1. Trim `provider` and `resolvedModel`; discard empty values.
 * 2. Include `scope` and `status` only when non-empty.
 * 3. Return the resulting `AdminModelPricingOverviewQuery` object.
 *
 * Failure cases:
 * - Values exceeding schema bounds are rejected downstream by `adminModelPricingOverviewQuerySchema`.
 *
 * Side effects:
 * - None: pure filter-to-query mapping without mutating input state.
 */
export function toAdminPricingQuery(
  values: AdminPricingFilters,
): AdminModelPricingOverviewQuery {
  // Why: Prevent sending empty string query fields (`?provider=`) or client-only flags (`coverageGapOnly`)
  // to the strict `adminModelPricingOverviewQuerySchema` BFF validator.
  // How: Conditionally assign trimmed non-empty properties into a fresh query object.
  // Invariants: Returned keys are always a strict subset of `adminModelPricingOverviewQuerySchema`.
  const query: AdminModelPricingOverviewQuery = {};
  const provider = values.provider.trim();
  const resolvedModel = values.resolvedModel.trim();

  if (provider.length > 0) {
    query.provider = provider;
  }
  if (resolvedModel.length > 0) {
    query.resolvedModel = resolvedModel;
  }
  if (values.scope !== "") {
    query.scope = values.scope;
  }
  if (values.status !== "") {
    query.status = values.status;
  }

  return query;
}

/**
 * Zod form validation schema for the read-only Admin Model Pricing filter bar.
 * Why: Keeps validation out of JSX components and aligns with `@lcsp/contracts/billing` query limits,
 *   while separating base shape from `.refine()` to avoid circular TypeScript inference.
 * How: Validates optional provider/model text, optional scope/status enums (or `""` for all),
 *   and `coverageGapOnly` boolean, verifying mapped API fields pass `adminModelPricingOverviewQuerySchema`.
 * Invariants: `coverageGapOnly` is client-side only and omitted from the upstream API query.
 */
export const adminPricingFiltersSchema = baseAdminPricingFiltersSchema.refine(
  (values) =>
    adminModelPricingOverviewQuerySchema.safeParse(toAdminPricingQuery(values))
      .success,
);
