import { z } from "zod";
import {
  assessmentRuleImportRequestSchema,
  type AssessmentRuleImportRequest,
} from "@lcsp/contracts/legal-rule-catalog";
import {
  ASSESSMENT_RULE_IMPORT_FILE_ISSUES as ISSUES,
  ASSESSMENT_RULE_IMPORT_MAX_FILES,
} from "../config/legal-rule-catalog.config";

/**
 * Business purpose: Keep the chosen import files as the single form value the Admin checks and imports.
 * Business rules:
 * - At least one and at most ASSESSMENT_RULE_IMPORT_MAX_FILES documents; the full v1 contract is checked per document by the parser below, not duplicated here.
 * Execution flow:
 * 1. Validate the file list shape; the dialog derives per-document status from the same text.
 * Failure cases:
 * - An empty or oversized selection fails with a message key resolved from @lcsp/i18n.
 * Side effects:
 * - Pure validation; nothing is read from disk or sent.
 */
export const assessmentRuleImportFormSchema = z.object({
  documents: z
    .array(
      z.object({
        name: z.string().min(1),
        text: z.string().min(2),
      }),
    )
    .min(1, "importNoFiles")
    .max(ASSESSMENT_RULE_IMPORT_MAX_FILES, "importTooManyFiles"),
});

export type AssessmentRuleImportIssue = (typeof ISSUES)[keyof typeof ISSUES];

export type ParsedAssessmentRuleImportDocument =
  | { ok: true; name: string; request: AssessmentRuleImportRequest }
  | { ok: false; name: string; issue: AssessmentRuleImportIssue };

/**
 * Business purpose: Tell the Admin, before anything is sent, whether a chosen file is a usable Assessment Rule Import v1 document for the selected catalog.
 * Business rules:
 * - The shared v1 contract decides format validity, so the browser and the API can never disagree on shape.
 * - A document must name the selected catalog and its current revision; otherwise it is stale or foreign and is never sent.
 * Execution flow:
 * 1. Parse the file text as JSON.
 * 2. Validate it with the shared import request contract.
 * 3. Compare its catalog identity and revision with the selected catalog.
 * Failure cases:
 * - Invalid JSON, a contract violation, another catalog or an outdated revision return a typed issue instead of a request.
 * Side effects:
 * - Pure parsing; no network, storage or catalog state is touched.
 */
export function parseAssessmentRuleImportDocument(
  document: { name: string; text: string },
  target: { catalogId: string; catalogRevision: number },
): ParsedAssessmentRuleImportDocument {
  let json: unknown;
  try {
    json = JSON.parse(document.text);
  } catch {
    return { ok: false, name: document.name, issue: ISSUES.INVALID_JSON };
  }
  const parsed = assessmentRuleImportRequestSchema.safeParse(json);
  if (!parsed.success)
    return { ok: false, name: document.name, issue: ISSUES.INVALID_DOCUMENT };
  if (parsed.data.catalogVersionId !== target.catalogId)
    return { ok: false, name: document.name, issue: ISSUES.WRONG_CATALOG };
  if (parsed.data.expectedCatalogRevision !== target.catalogRevision)
    return { ok: false, name: document.name, issue: ISSUES.STALE_REVISION };
  return { ok: true, name: document.name, request: parsed.data };
}
