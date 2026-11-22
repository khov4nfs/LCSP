import type { z } from "zod";
import type { LegalRuleSourceProvision } from "@lcsp/contracts/legal-rule-catalog";
import type { LegalSourceDocumentView } from "@lcsp/contracts/legal-source";
import type {
  legalRuleCatalogFormSchema,
  legalRuleFormSchema,
} from "../schemas/legal-rule-catalog-form.schema";
export type CatalogFormValues = z.infer<typeof legalRuleCatalogFormSchema>;
export type RuleFormValues = z.infer<typeof legalRuleFormSchema>;

// The preview needs only inline evidence and the selected document's recorded web source.
export interface LegalRuleReferencePreviewProps {
  provision: Pick<
    LegalRuleSourceProvision,
    "documentTitle" | "description" | "referenceContext"
  >;
  sourceDocument: Pick<
    LegalSourceDocumentView,
    "hasOriginal" | "sourceUrl"
  > | null;
}
