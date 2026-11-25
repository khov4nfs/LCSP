import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  assessmentRuleImportRequestSchema,
  preparationRuleInputSchema,
} from "@lcsp/contracts/legal-rule-catalog";
import {
  normalizeImportItem,
  validateSelectedOutput,
} from "../src/modules/legal-rule-catalog/application/services/preparation-rule.service.js";

// Offline check of an Assessment Rule Import v1 document against its exported input package.
// Usage (from apps/api): tsx scripts/validate-assessment-rule-import.ts <input-package.json> <import-document.json>
// It applies the same schema, normalization and citation/ID validation the import endpoint applies, with no database or network.
// Exit code 0 = the document would pass validation; 1 = problems are printed as JSON (field paths only, never source text).

const packageSchema = z.object({
  catalog: z.object({
    catalogVersionId: z.string(),
    catalogVersion: z.string(),
    expectedCatalogRevision: z.number(),
    legalSourceVersionId: z.string(),
    sourceVersion: z.string(),
  }),
  rules: z.array(
    z.object({
      ruleId: z.string(),
      legalRuleId: z.string(),
      title: z.string(),
      description: z.string(),
      citations: z.array(
        z.object({
          documentId: z.string(),
          locator: z.string(),
          contentSha256: z.string(),
          content: z.string(),
        }),
      ),
    }),
  ),
});

/** Problems are collected, never thrown, so one run reports every defect. */
const problems: Array<{ ruleId?: string; problem: string; path?: string }> = [];

/**
 * Business purpose: Let the Admin prove an authored import document is acceptable before it ever reaches production.
 * Business rules:
 * - The document must name the exported catalog, revision and source, and every item/exclusion must target an exported rule, each rule being handled at most once.
 * - Items must pass the identical normalization and selected-output validation the endpoint applies, so a pass here predicts a pass there.
 * - Rules neither imported nor excluded are reported as uncovered, because silent omission hides review gaps.
 * Execution flow:
 * 1. Parse the input package and the import document with the shared contracts.
 * 2. Compare identities and index the exported rules.
 * 3. Normalize and validate each item against its pinned citations.
 * 4. Check exclusions, overlap and coverage, then print a summary.
 * Failure cases:
 * - Any contract, identity, citation or coverage defect is printed with a safe path and exits non-zero.
 * Side effects:
 * - Reads two local files and prints a summary; writes nothing.
 */
function run(): number {
  const [packagePath, documentPath] = process.argv.slice(2);
  if (!packagePath || !documentPath) {
    console.error("usage: <input-package.json> <import-document.json>");
    return 1;
  }
  const exported = packageSchema.parse(
    JSON.parse(readFileSync(packagePath, "utf8")),
  );
  const parsed = assessmentRuleImportRequestSchema.safeParse(
    JSON.parse(readFileSync(documentPath, "utf8")),
  );
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      problems.push({ problem: "SCHEMA", path: issue.path.join(".") });
    return report(0, 0, 0);
  }
  const document = parsed.data;
  const { catalog } = exported;
  if (
    document.catalogVersionId !== catalog.catalogVersionId ||
    document.expectedCatalogRevision !== catalog.expectedCatalogRevision ||
    document.legalSourceVersionId !== catalog.legalSourceVersionId
  )
    problems.push({ problem: "CATALOG_IDENTITY_MISMATCH" });
  const rules = new Map(exported.rules.map((rule) => [rule.ruleId, rule]));
  const handled = new Set<string>();
  for (const [index, item] of document.items.entries()) {
    const rule = rules.get(item.ruleId);
    if (!rule) {
      problems.push({ ruleId: item.ruleId, problem: "UNKNOWN_RULE" });
      continue;
    }
    handled.add(item.ruleId);
    const input = preparationRuleInputSchema.parse({
      ruleId: rule.ruleId,
      legalRuleId: rule.legalRuleId,
      title: rule.title,
      description: rule.description,
      catalogVersionId: catalog.catalogVersionId,
      catalogVersion: catalog.catalogVersion,
      catalogRevision: catalog.expectedCatalogRevision,
      legalSourceVersionId: catalog.legalSourceVersionId,
      sourceVersion: catalog.sourceVersion,
      indexId: "00000000-0000-4000-8000-000000000000",
      indexContentHash: "sha256:offline",
      citations: rule.citations.map((citation, position) => ({
        chunkId: `offline-${position}`,
        documentId: citation.documentId,
        locator: citation.locator,
        contentSha256: citation.contentSha256,
        content: citation.content,
      })),
    });
    try {
      validateSelectedOutput(
        input,
        normalizeImportItem(item, index, "offline"),
        "offline",
      );
    } catch (error: unknown) {
      const issues = (
        error as { response?: { problem?: { meta?: { issues?: string } } } }
      ).response?.problem?.meta?.issues;
      problems.push({
        ruleId: item.ruleId,
        problem: "INVALID_ITEM",
        path: issues ?? "unknown",
      });
    }
  }
  for (const excluded of document.excludedItems) {
    if (!rules.has(excluded.ruleId))
      problems.push({ ruleId: excluded.ruleId, problem: "UNKNOWN_EXCLUSION" });
    else if (handled.has(excluded.ruleId))
      problems.push({
        ruleId: excluded.ruleId,
        problem: "IMPORTED_AND_EXCLUDED",
      });
    else if (!handled.has(excluded.ruleId)) handled.add(excluded.ruleId);
  }
  const uncovered = exported.rules.filter((rule) => !handled.has(rule.ruleId));
  for (const rule of uncovered)
    problems.push({ ruleId: rule.ruleId, problem: "NOT_IMPORTED_OR_EXCLUDED" });
  return report(
    document.items.length,
    document.excludedItems.length,
    exported.rules.length,
  );
}

/** Print the outcome; keeps the exit code the single machine-readable verdict. */
function report(items: number, excluded: number, total: number): number {
  console.log(
    JSON.stringify(
      {
        ok: problems.length === 0,
        rules: total,
        items,
        excludedItems: excluded,
        problems: problems.slice(0, 50),
        problemCount: problems.length,
      },
      null,
      2,
    ),
  );
  return problems.length === 0 ? 0 : 1;
}

process.exitCode = run();
