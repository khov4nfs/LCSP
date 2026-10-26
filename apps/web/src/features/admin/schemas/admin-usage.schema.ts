import { z } from "zod";
import {
  adminUsageQuerySchema,
  MODEL_ATTEMPT_STATUSES,
} from "@lcsp/contracts/billing";
const text = z.string().trim().max(200);
export const adminUsageFiltersSchema = z
  .object({
    from: z.union([z.iso.date(), z.literal("")]),
    to: z.union([z.iso.date(), z.literal("")]),
    provider: text,
    model: text,
    agentRole: text,
    assessmentId: text,
    runId: text,
    userId: text,
    attemptStatus: z.union([z.enum(MODEL_ATTEMPT_STATUSES), z.literal("")]),
  })
  .refine((x) => adminUsageQuerySchema.safeParse(toUsageQuery(x)).success);
export type AdminUsageFilters = z.infer<typeof adminUsageFiltersSchema>;
/**
 * Business purpose: Translate Admin usage form values into API filter parameters.
 *
 * Business rules:
 * - Omit blank values, trim ordinary filters and expand selected dates to inclusive UTC day
 *   boundaries; the caller validates the resulting query.
 *
 * Execution flow:
 * 1. Filter empty entries and map from/to dates or trimmed text into request values.
 *
 * Failure cases:
 * - This mapper does not validate date syntax; the enclosing/shared query schema rejects
 *   invalid output.
 *
 * Side effects:
 * - None: returns a new query object.
 */
export function toUsageQuery(values: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, v]) => v.trim())
      .map(([k, v]) => [
        k,
        k === "from"
          ? `${v}T00:00:00.000Z`
          : k === "to"
            ? `${v}T23:59:59.999Z`
            : v.trim(),
      ]),
  );
}
