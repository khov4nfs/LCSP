import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Business purpose: Produce a restart-safe inventory of historical fields needing provenance review.
 * Business rules:
 * - Explicit database URL and scope are required; this tool is read-only and never labels, translates or approves content.
 * Execution flow:
 * 1. Page at most 200 unknown/unreviewed requests after the supplied cursor and emit exact review bindings.
 * Failure cases:
 * - Missing configuration or invalid limits reject before database access.
 * Side effects:
 * - Reads scoped metadata and prints a continuation cursor without customer narrative text.
 */
async function main() {
  const scopeId = process.env.LCSP_LOCALIZATION_REVIEW_SCOPE;
  const url = process.env.DATABASE_URL;
  const after = process.env.LCSP_LOCALIZATION_REVIEW_AFTER;
  const limit = Number(process.env.LCSP_LOCALIZATION_REVIEW_LIMIT ?? "100");
  if (!scopeId || !url || !Number.isInteger(limit) || limit < 1 || limit > 200)
    throw new Error(
      "Explicit database, review scope and bounded limit required",
    );
  const prisma = new PrismaClient({ adapter: new PrismaPg(url) });
  try {
    const rows = await prisma.authoredLocalizationRequest.findMany({
      where: {
        scopeId,
        sourceReviewedBy: null,
        ...(after ? { id: { gt: after } } : {}),
      },
      orderBy: { id: "asc" },
      take: limit,
      select: {
        id: true,
        scopeId: true,
        entityType: true,
        entityId: true,
        canonicalRevision: true,
        canonicalDigest: true,
        fieldPath: true,
        originSha256: true,
        sourceLanguage: true,
        locale: true,
        state: true,
      },
    });
    process.stdout.write(
      JSON.stringify({
        requests: rows,
        nextAfter: rows.length === limit ? rows.at(-1)!.id : null,
        readOnly: true,
      }) + "\n",
    );
  } finally {
    await prisma.$disconnect();
  }
}
await main();
