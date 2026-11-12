import { z } from "zod";
import { RULE_CATALOG_GROUP_IDS } from "@lcsp/contracts/assessment-domain";
export const ruleGroupingFormSchema = z.object({
  assignments: z
    .array(
      z.object({
        groupId: z.enum(RULE_CATALOG_GROUP_IDS),
        rationaleEn: z.string().trim().min(1),
        rationaleVi: z.string().trim().min(1),
      }),
    )
    .min(1),
});
export type RuleGroupingForm = z.infer<typeof ruleGroupingFormSchema>;
