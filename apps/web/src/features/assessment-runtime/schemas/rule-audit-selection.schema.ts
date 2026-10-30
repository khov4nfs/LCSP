import { z } from "zod";

export const ruleAuditSelectionSchema = z.object({
  selectedRuleIds: z.array(z.string().min(1)).min(1),
});
export type RuleAuditSelection = z.infer<typeof ruleAuditSelectionSchema>;
