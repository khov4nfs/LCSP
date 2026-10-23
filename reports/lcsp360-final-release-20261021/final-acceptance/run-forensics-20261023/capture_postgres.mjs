// Read-only retained-run evidence; never claims, retries, seeds or invokes a provider.
import { writeFileSync } from "node:fs";
import { PrismaService } from "../../../../apps/api/dist/src/infrastructure/prisma/prisma.service.js";
import { LegalDocumentGraphService } from "../../../../apps/api/dist/src/modules/legal-source/application/services/legal-document-graph.service.js";
import { ClaimRuleSetPreparationHandler } from "../../../../apps/api/dist/src/modules/compliance-rule-set/application/commands/claim-rule-set-preparation/claim-rule-set-preparation.handler.js";

const url = new URL(process.env.DATABASE_URL);
if (url.hostname !== "127.0.0.1" || url.port !== "55506" || url.pathname !== "/lcsp360_final_browser_ready_9e71b914")
  throw new Error("Retained isolated acceptance database required");
const runId = "4ae336f3-35b4-4393-ba42-cb4eeb4d500f";
const db = new PrismaService();
try {
  const snapshot = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const readonly = await tx.$queryRawUnsafe("SHOW transaction_read_only");
    const run = await tx.ruleSetPreparationRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.executionState !== "FAILED") throw new Error("Unexpected retained state; stop");
    let claimResumeDenied;
    try {
      await new ClaimRuleSetPreparationHandler(tx, new LegalDocumentGraphService(tx)).execute({
        request: { preparationRunId: runId }, correlationId: "read-only-resume-denial",
      });
      throw new Error("Unexpected claim acceptance");
    } catch (error) {
      if (error.getStatus?.() !== 409) throw error;
      claimResumeDenied = { httpStatus: 409, providerDispatches: 0, state: run.executionState };
    }
    const frontier = await tx.ruleSetPreparationReviewFrontier.findFirstOrThrow({ where: { preparationRunId: runId } });
    const documentGraph = await new LegalDocumentGraphService(tx).export(run.legalSourceVersionId, frontier.materializationId);
    const source = await tx.legalSourceVersion.findUniqueOrThrow({
      where: { id: run.legalSourceVersionId }, select: {
        id: true, version: true, documents: { select: {
          documentId: true, title: true, sourceUrl: true, sourceSha256: true, sourceEffectStatus: true,
          snapshotPath: true, extraction: true, provenance: true,
          chunks: { orderBy: { locator: "asc" }, select: {
            id: true, locator: true, content: true, contentSha256: true, legalStatus: true,
            legalEffectStatus: true, legalStatusSourceRef: true, hierarchy: true, pageStart: true, pageEnd: true,
          } },
        } },
      },
    });
    const reviews = await tx.ruleSetPreparationSourceReview.findMany({ where: { preparationRunId: runId }, orderBy: { ordinal: "asc" } });
    const audits = await tx.ruleSetPreparationSemanticAudit.findMany({ where: { preparationRunId: runId } });
    return { readonly, claimResumeDenied, run, frontier, bundle: {
      preparationRunId: runId, legalSourceVersionId: source.id, legalSourceVersion: source.version,
      documents: source.documents, documentGraph,
    }, reviews, audits };
  }, { timeout: 20000, isolationLevel: "RepeatableRead" });
  writeFileSync(new URL("postgres-read-only-snapshot.json", import.meta.url), JSON.stringify(snapshot, null, 2) + "\n");
  console.log(JSON.stringify({ readonly: snapshot.readonly, state: snapshot.run.executionState,
    units: snapshot.reviews.length, audits: snapshot.audits.length }));
} finally {
  await db.$disconnect();
}
