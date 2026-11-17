import { z } from "zod";
import {
  customerUsageQuerySchema,
  MODEL_ATTEMPT_STATUSES,
} from "@lcsp/contracts/billing";

import { CUSTOMER_USAGE_PAGE_SIZE } from "../config/customer-usage.config";

const invalidFilters = "pages.workspace.settingsHub.usage.invalidFilters";
const date = z.iso.date({ error: invalidFilters });
const text = z.string().trim().max(200, invalidFilters);
const filterFieldsSchema = z.object({
  from: date,
  to: date,
  provider: text,
  model: text,
  attemptStatus: z.union([z.enum(MODEL_ATTEMPT_STATUSES), z.literal("")]),
});
export type CustomerUsageFilters = z.infer<typeof filterFieldsSchema>;
export const customerUsageFiltersSchema =
  filterFieldsSchema.superRefine(validateUsageFilters);

/**
 * Business purpose: Convert selected UTC calendar dates and optional filters to a bounded customer report.
 * Business rules:
 * - Include both selected UTC days; blank provider/model/status fields are omitted and filtering starts at page one.
 * Execution flow:
 * 1. Expand date boundaries, trim text filters and validate the complete customer query.
 * Failure cases:
 * - Malformed, reversed and over-90-day periods fail shared contract validation.
 * Side effects:
 * - Pure filter conversion; no requests or persisted preferences.
 */
export function toCustomerUsageQuery(values: CustomerUsageFilters) {
  return customerUsageQuerySchema.parse({
    from: `${values.from}T00:00:00.000Z`,
    to: `${values.to}T23:59:59.999Z`,
    provider: values.provider.trim() || undefined,
    model: values.model.trim() || undefined,
    attemptStatus: values.attemptStatus || undefined,
    page: 1,
    pageSize: CUSTOMER_USAGE_PAGE_SIZE,
  });
}

/**
 * Business purpose: Prevent invalid reporting intervals before issuing a customer analytics request.
 * Business rules:
 * - Field syntax and the shared maximum-90-day interval must both be valid.
 * Execution flow:
 * 1. Validate the API projection and attach a localized range error to the end-date field on failure.
 * Failure cases:
 * - Invalid query projections keep the existing applied report and surface a field error.
 * Side effects:
 * - Pure form validation; does not change the active report.
 */
function validateUsageFilters(
  values: CustomerUsageFilters,
  context: z.RefinementCtx,
) {
  try {
    toCustomerUsageQuery(values);
  } catch {
    context.addIssue({ code: "custom", path: ["to"], message: invalidFilters });
  }
}
