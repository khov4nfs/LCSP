import "dotenv/config";
import {
  AUTHORED_LOCALIZATION_ENTITIES,
  type AuthoredLocalizationEntity,
  assessmentFinalReportArtifactSchema,
} from "@lcsp/contracts/assessment-domain";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.ts";
import {
  AuthoredLocalizationService,
  enqueueAuthoredDocument,
} from "../src/platform/localization/authored-localization.service.ts";
import {
  ArtifactStorageService,
  chunkedManifestSchema,
} from "../src/platform/storage/artifact-storage.service.ts";
import { createHash } from "node:crypto";

/** One bounded, operator-invoked batch. Persist the printed cursor and rerun; no translation provider calls. */
async function main() {
  const [scopeId, entity, after, size] = process.argv.slice(2);
  if (
    !process.env.DATABASE_URL ||
    !scopeId ||
    !Object.values(AUTHORED_LOCALIZATION_ENTITIES).includes(
      entity as AuthoredLocalizationEntity,
    )
  )
    throw new Error(
      "Usage: backfill:authored-content <scopeId> <entityType> [afterCursor] [batchSize]; DATABASE_URL required",
    );
  const prisma = new PrismaService();
  try {
    if (entity === AUTHORED_LOCALIZATION_ENTITIES.REPORT) {
      if (!after)
        throw new Error("Explicit report artifact ID required as cursor");
      const artifact = await prisma.assessmentArtifact.findFirst({
        where: { assessmentId: scopeId, artifactId: after },
      });
      if (!artifact?.storageRef || !artifact.contentSha256)
        throw new Error("Explicit report artifact ID required as cursor");
      const bytes = await new ArtifactStorageService().readAndReconstruct(
        chunkedManifestSchema.parse(JSON.parse(artifact.storageRef)),
      );
      const hash = createHash("sha256").update(bytes, "utf8").digest("hex");
      const report = assessmentFinalReportArtifactSchema.parse(
        JSON.parse(bytes),
      );
      if (
        hash !== artifact.contentSha256.replace(/^sha256:/u, "") ||
        report.artifactId !== artifact.artifactId ||
        report.assessmentId !== scopeId
      )
        throw new Error("Canonical report binding/integrity mismatch");
      await prisma.$transaction((tx) =>
        enqueueAuthoredDocument(tx, {
          scopeId,
          entityType: AUTHORED_LOCALIZATION_ENTITIES.REPORT,
          entityId: artifact.artifactId,
          canonicalRevision: artifact.contentSha256!,
          document: report,
        }),
      );
      console.log(
        JSON.stringify({
          processed: 1,
          complete: true,
          artifactId: artifact.artifactId,
        }),
      );
    } else {
      console.log(
        JSON.stringify(
          await new AuthoredLocalizationService(prisma).backfillBatch(
            scopeId,
            entity as AuthoredLocalizationEntity,
            after || null,
            size ? Number(size) : 10,
          ),
        ),
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Backfill failed");
  process.exitCode = 1;
});
