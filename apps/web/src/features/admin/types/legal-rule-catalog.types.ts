import type { z } from "zod";
import type {
  legalRuleCatalogFormSchema,
  legalRuleFormSchema,
} from "../schemas/legal-rule-catalog-form.schema";
export type CatalogFormValues = z.infer<typeof legalRuleCatalogFormSchema>;
export type RuleFormValues = z.infer<typeof legalRuleFormSchema>;
