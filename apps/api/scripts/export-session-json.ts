import { LocalePresentationProjectionService } from "../src/modules/assessment/infrastructure/presentation/locale-presentation-projection.service.js";
import { AuthoredLocalizationService } from "../src/platform/localization/authored-localization.service.js";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { claimAssessmentRootRequestSchema } from "@lcsp/contracts/assessment-domain";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { ArtifactStorageService } from "../src/platform/storage/artifact-storage.service.js";
import { AssessmentProvenanceLoader } from "../src/modules/assessment/infrastructure/persistence/assessment-provenance.loader.js";
import { AssessmentReportLoader } from "../src/modules/assessment/infrastructure/persistence/assessment-report.loader.js";
import { AssessmentSessionExportLoader } from "../src/modules/assessment/infrastructure/persistence/assessment-session-export.loader.js";

/**
 * Business purpose: Export one explicitly selected owner's persisted assessment session for local review.
 * Business rules:
 * - The operator supplies assessment identity, owner identity and output path; no historical account or assessment is a default.
 * - The canonical loader enforces ownership, provenance and exact source pins.
 * - Database configuration comes from the caller's environment; existing output files are never overwritten.
 * Execution flow:
 * 1. Parse explicit options or display help before opening database connections.
 * 2. Load the authorized session through the production aggregation path.
 * 3. Create the requested JSON file exclusively and report its content fingerprint.
 * Failure cases:
 * - Invalid options, owner mismatch, invalid provenance or an existing destination fails with a nonzero exit.
 * Side effects:
 * - Reads persisted data and artifact storage, writes one new local file and always closes its own Prisma connection.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "assessment-id": { type: "string" },
      "owner-id": { type: "string" },
      output: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  const usage =
    "Usage: export-session-json.ts --assessment-id <UUID> --owner-id <user ID> --output <file.json>";
  if (values.help) {
    console.log(usage);
    return;
  }
  if (!values["owner-id"]?.trim() || !values.output?.trim())
    throw new Error(usage);
  const assessmentId =
    claimAssessmentRootRequestSchema.shape.assessmentId.parse(
      values["assessment-id"],
    );
  const outputPath = resolve(values.output);
  const prisma = new PrismaService();
  try {
    await prisma.onModuleInit();
    const storage = new ArtifactStorageService();
    const reports = new AssessmentReportLoader(
      prisma,
      storage,
      new LocalePresentationProjectionService(
        new AuthoredLocalizationService(prisma),
      ),
    );
    const provenance = new AssessmentProvenanceLoader(prisma);
    const loader = new AssessmentSessionExportLoader(
      prisma,
      provenance,
      reports,
    );
    const data = await loader.load({
      assessmentId,
      sessionUserId: values["owner-id"],
      subjectRole: AUTH_USER_ROLES.customer,
      correlationId: randomUUID(),
    });
    writeFileSync(outputPath, JSON.stringify(data, null, 2) + "\n", {
      encoding: "utf8",
      flag: "wx",
    });
    console.log("Saved session export: " + outputPath);
    console.log("Content SHA-256: " + data.integrity.contentSha256);
  } finally {
    await prisma.onModuleDestroy();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Session export failed",
  );
  process.exitCode = 1;
});
