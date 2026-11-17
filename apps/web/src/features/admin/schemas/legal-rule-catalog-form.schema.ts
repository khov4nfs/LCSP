import { z } from "zod";
import { legalRuleCitationSchema } from "@lcsp/contracts/legal-rule-catalog";

/**
 * Business purpose: Parse explicit Admin citation locators without extracting legal rules from source.
 * Business rules:
 * - Each nonempty line contains exactly one documentId|locator pair; the API resolves authoritative source pins.
 * Execution flow:
 * 1. Split lines
 * 2. Parse each pair through the shared citation contract.
 * Failure cases:
 * - Malformed/empty pairs fail validation; no locator is guessed.
 * Side effects:
 * - Pure form normalization.
 */
export function parseCatalogCitations(text: string) {
  return z
    .array(legalRuleCitationSchema)
    .min(1)
    .max(64)
    .parse(
      text
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          const parts = line.split("|");
          return {
            documentId: parts.length === 2 ? parts[0].trim() : "",
            locator: parts.length === 2 ? parts[1].trim() : "",
          };
        }),
    );
}
export const legalRuleCatalogFormSchema = z.object({
  version: z.string().trim().min(1, "required").max(128),
  legalSourceVersionId: z.string().uuid("invalidSource"),
});
export const legalRuleFormSchema = z.object({
  legalRuleId: z.string().trim().min(1, "required").max(128),
  title: z.string().trim().min(1, "required").max(512),
  description: z.string().trim().min(1, "required").max(12000),
  citations: z.string().refine((value) => {
    try {
      parseCatalogCitations(value);
      return true;
    } catch {
      return false;
    }
  }, "invalidCitation"),
});
