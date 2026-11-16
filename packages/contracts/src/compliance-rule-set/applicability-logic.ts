import { z } from "zod";
import { APPLICABILITY_CONDITION_LOGIC } from "../assessment/agentic-runtime.ts";
import { COMPLIANCE_RULE_SET_LIMITS } from "./constants.ts";

/** Source-authored connector; absence preserves unknown legacy semantics. */
export const legalApplicabilityLogicSchema = z.strictObject({
  version: z.literal(1),
  conditionLogic: z.enum(APPLICABILITY_CONDITION_LOGIC),
  materialConditionIndices: z
    .array(z.number().int().nonnegative())
    .max(COMPLIANCE_RULE_SET_LIMITS.maxListItems)
    .optional(),
});
