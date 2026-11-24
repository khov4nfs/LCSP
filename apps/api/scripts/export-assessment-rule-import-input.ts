import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod";
import { diagnosticDatabaseEndpoint } from "./lib/diagnostic-database.js";

// Read-only export of the input needed to author an Assessment Rule Import v1 document.
// Usage (from apps/api):
//   LCSP_EXPORT_ENV_FILE=<env file with DATABASE_URL> tsx scripts/export-assessment-rule-import-input.ts
//     -> lists catalogs (id, revision, pinned source, rule count).
//   LCSP_EXPORT_ENV_FILE=... LCSP_EXPORT_CATALOG_ID=<uuid> LCSP_EXPORT_OUTPUT=<new file> tsx scripts/export-assessment-rule-import-input.ts
//     -> writes the pinned input of one catalog to a new JSON file.
//   Optional narrowing so one authoring prompt stays small (a rule belongs to the document of its first citation):
//     LCSP_EXPORT_DOCUMENT_ID=<documentId>  keep only that document's rules
//     LCSP_EXPORT_SKIP=<n> LCSP_EXPORT_TAKE=<n>  page through the (sorted) rules; TAKE defaults to 200 and may not exceed 256
//   With a catalog id and no output, only the per-document rule counts are printed.
// The database address must be loopback (open an SSH tunnel for a remote database); no credentials are printed or exported.

/** Error whose message is safe to print: it never carries credentials, addresses or source text. */
class ExportError extends Error {}

const refs = z.array(
  z.strictObject({
    documentId: z.string().min(1),
    locator: z.string().min(1),
  }),
);
const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

/**
 * Business purpose: Give the Admin the exact pinned catalog input needed to author Assessment Rules outside the product.
 * Business rules:
 * - The export is read-only and loopback-only; it must reproduce, never alter, the identities and content hashes that the import endpoint later verifies.
 * - A citation whose stored text no longer matches its stored hash blocks the export, because authoring against drifted text would be rejected or unsound.
 * Execution flow:
 * 1. Open one read-only repeatable-read transaction with a statement timeout.
 * 2. Without a catalog id, list catalogs with their pinned source and rule count.
 * 3. With a catalog id, resolve every rule citation to its pinned chunk, verify its hash and compose the input document with a ready import envelope.
 * Failure cases:
 * - Missing configuration, unknown catalog, unresolved citation, hash mismatch or an existing output file stops the export with a sanitized message and writes nothing.
 * Side effects:
 * - Reads catalog and source rows only; writes one new local JSON file when a catalog is exported.
 */
async function run(): Promise<void> {
  const envFile = process.env.LCSP_EXPORT_ENV_FILE;
  const catalogId = process.env.LCSP_EXPORT_CATALOG_ID;
  const output = process.env.LCSP_EXPORT_OUTPUT;
  if (!envFile) throw new ExportError("LCSP_EXPORT_ENV_FILE is required");
  if (catalogId && !z.string().uuid().safeParse(catalogId).success)
    throw new ExportError("LCSP_EXPORT_CATALOG_ID must be a UUID");
  const documentId = process.env.LCSP_EXPORT_DOCUMENT_ID;
  const skip = Number(process.env.LCSP_EXPORT_SKIP ?? 0);
  const take = Number(process.env.LCSP_EXPORT_TAKE ?? 200);
  if (
    !Number.isInteger(skip) ||
    skip < 0 ||
    !Number.isInteger(take) ||
    take < 1 ||
    take > 256
  )
    throw new ExportError(
      "LCSP_EXPORT_SKIP must be >= 0 and LCSP_EXPORT_TAKE between 1 and 256",
    );
  const endpoint = diagnosticDatabaseEndpoint(
    parse(readFileSync(envFile)).DATABASE_URL,
  );
  const db = new PrismaClient({ adapter: new PrismaPg(endpoint.href) });
  try {
    const document = await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout='30000ms'`;
        if (!catalogId) {
          const catalogs = await tx.legalRuleCatalogVersion.findMany({
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              version: true,
              revision: true,
              legalSourceVersionId: true,
              legalSourceVersion: { select: { version: true, status: true } },
              _count: { select: { rules: true } },
            },
          });
          return {
            catalogs: catalogs.map((catalog) => ({
              catalogVersionId: catalog.id,
              catalogVersion: catalog.version,
              revision: catalog.revision,
              legalSourceVersionId: catalog.legalSourceVersionId,
              sourceVersion: catalog.legalSourceVersion.version,
              sourceStatus: catalog.legalSourceVersion.status,
              ruleCount: catalog._count.rules,
            })),
          };
        }
        const catalog = await tx.legalRuleCatalogVersion.findUnique({
          where: { id: catalogId },
          include: {
            legalSourceVersion: { select: { version: true, status: true } },
            rules: { orderBy: { legalRuleId: "asc" } },
          },
        });
        if (!catalog) throw new ExportError("Catalog not found");
        const documentOf = (rule: { citationLocatorRefs: Prisma.JsonValue }) =>
          refs.parse(rule.citationLocatorRefs)[0]?.documentId ?? "";
        if (!output) {
          const counts: Record<string, number> = {};
          for (const rule of catalog.rules)
            counts[documentOf(rule)] = (counts[documentOf(rule)] ?? 0) + 1;
          return { catalogVersionId: catalog.id, rulesByDocument: counts };
        }
        const selectedRules = catalog.rules
          .filter((rule) => !documentId || documentOf(rule) === documentId)
          .slice(skip, skip + take);
        if (!selectedRules.length)
          throw new ExportError("No rules match the requested document/page");
        const wanted = [
          ...new Map(
            selectedRules
              .flatMap((rule) => refs.parse(rule.citationLocatorRefs))
              .map((ref) => [`${ref.documentId}\u0000${ref.locator}`, ref]),
          ).values(),
        ];
        const chunks: Array<{
          id: string;
          documentId: string;
          locator: string;
          content: string;
          contentSha256: string;
          hierarchy: Prisma.JsonValue;
          legalStatus: string;
          legalEffectStatus: string;
        }> = [];
        // Query in slices so a large catalog never builds one oversized OR clause.
        for (let start = 0; start < wanted.length; start += 200)
          chunks.push(
            ...(await tx.legalDocumentChunk.findMany({
              where: {
                legalSourceVersionId: catalog.legalSourceVersionId,
                OR: wanted.slice(start, start + 200),
              },
              select: {
                id: true,
                documentId: true,
                locator: true,
                content: true,
                contentSha256: true,
                hierarchy: true,
                legalStatus: true,
                legalEffectStatus: true,
              },
            })),
          );
        const byLocator = new Map(
          chunks.map((chunk) => [
            `${chunk.documentId}\u0000${chunk.locator}`,
            chunk,
          ]),
        );
        for (const chunk of chunks)
          if (
            sha256(chunk.content) !==
            chunk.contentSha256.replace(/^sha256:/u, "")
          )
            throw new ExportError("Stored source text does not match its hash");
        return {
          packageKind: "ASSESSMENT_RULE_IMPORT_INPUT",
          catalog: {
            catalogVersionId: catalog.id,
            catalogVersion: catalog.version,
            expectedCatalogRevision: catalog.revision,
            legalSourceVersionId: catalog.legalSourceVersionId,
            sourceVersion: catalog.legalSourceVersion.version,
            sourceStatus: catalog.legalSourceVersion.status,
          },
          // Copy these identities into the import document unchanged.
          importEnvelope: {
            schemaVersion: 1,
            catalogVersionId: catalog.id,
            expectedCatalogRevision: catalog.revision,
            legalSourceVersionId: catalog.legalSourceVersionId,
            // Safe by default: a dry run validates and previews. Set false only for the real import.
            dryRun: true,
            items: [],
            excludedItems: [],
          },
          rules: selectedRules.map((rule) => ({
            ruleId: rule.id,
            legalRuleId: rule.legalRuleId,
            title: rule.title,
            description: rule.description,
            citations: refs.parse(rule.citationLocatorRefs).map((ref) => {
              const chunk = byLocator.get(
                `${ref.documentId}\u0000${ref.locator}`,
              );
              if (!chunk)
                throw new ExportError("A rule citation does not resolve");
              return {
                documentId: chunk.documentId,
                locator: chunk.locator,
                contentSha256: chunk.contentSha256,
                legalStatus: chunk.legalStatus,
                legalEffectStatus: chunk.legalEffectStatus,
                hierarchy: chunk.hierarchy,
                content: chunk.content,
              };
            }),
          })),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 60000,
      },
    );
    if (!catalogId || !output) {
      console.log(JSON.stringify(document, null, 2));
      return;
    }
    // "wx" refuses to overwrite an existing export so earlier authoring input is never lost.
    writeFileSync(
      path.resolve(output),
      JSON.stringify(document, null, 2) + "\n",
      { flag: "wx" },
    );
    const exported = document as { rules: Array<{ citations: unknown[] }> };
    console.log(
      JSON.stringify({
        catalogVersionId: catalogId,
        rules: exported.rules.length,
        citations: exported.rules.reduce(
          (total, rule) => total + rule.citations.length,
          0,
        ),
        output: path.resolve(output),
      }),
    );
  } finally {
    await db.$disconnect();
  }
}

try {
  await run();
} catch (error: unknown) {
  console.error(
    JSON.stringify({
      status: "EXPORT_FAILED",
      message:
        error instanceof ExportError
          ? error.message
          : error instanceof Error && "code" in error && error.code === "EEXIST"
            ? "Output file already exists"
            : "Unexpected error; see errorClass",
      errorClass: error instanceof Error ? error.name : "UNKNOWN",
    }),
  );
  process.exitCode = 1;
}
