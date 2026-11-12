import { LocalePresentationProjectionService } from "../src/modules/assessment/infrastructure/presentation/locale-presentation-projection.service.js";
import { AuthoredLocalizationService } from "../src/platform/localization/authored-localization.service.js";
import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { claimAssessmentRootRequestSchema } from "@lcsp/contracts/assessment-domain";
import { z } from "zod";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { ArtifactStorageService } from "../src/platform/storage/artifact-storage.service.js";
import { AssessmentProvenanceLoader } from "../src/modules/assessment/infrastructure/persistence/assessment-provenance.loader.js";
import { AssessmentReportLoader } from "../src/modules/assessment/infrastructure/persistence/assessment-report.loader.js";
import { AssessmentSessionExportLoader } from "../src/modules/assessment/infrastructure/persistence/assessment-session-export.loader.js";

/**
 * Business purpose: Export an explicitly identified assessment session and its verified final report for a T31 review.
 * Business rules:
 * - Assessment, owner, report artifact and both output paths are explicit operator inputs.
 * - Both production loaders must authorize and validate their data before either artifact is written.
 * - Caller-owned environment supplies database configuration; historical ledgers and existing files are preserved.
 * Execution flow:
 * 1. Validate options and distinct absent destinations, or display help without database access.
 * 2. Load the owner-scoped session and exact final report through production validation.
 * 3. Create both JSON files exclusively and close the database connection.
 * Failure cases:
 * - Invalid identity, inaccessible report, conflicting paths or file-system failure produces a nonzero exit.
 * - A disk failure during the second write may leave the first new file; it is reported and never disguised as a successful pair.
 * Side effects:
 * - Reads persisted data and artifact storage and creates only the two explicitly named local artifacts.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "assessment-id": { type: "string" },
      "owner-id": { type: "string" },
      "artifact-id": { type: "string" },
      "session-output": { type: "string" },
      "report-output": { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  const usage =
    "Usage: export-t31-deliverables.ts --assessment-id <UUID> --owner-id <user ID> --artifact-id <UUID> --session-output <session.json> --report-output <report.json>";
  if (values.help) {
    console.log(usage);
    return;
  }
  if (
    !values["owner-id"]?.trim() ||
    !values["session-output"]?.trim() ||
    !values["report-output"]?.trim()
  )
    throw new Error(usage);
  const assessmentId =
    claimAssessmentRootRequestSchema.shape.assessmentId.parse(
      values["assessment-id"],
    );
  const artifactId = z.uuid().parse(values["artifact-id"]);
  const sessionPath = resolve(values["session-output"]);
  const reportPath = resolve(values["report-output"]);
  if (
    sessionPath === reportPath ||
    existsSync(sessionPath) ||
    existsSync(reportPath)
  )
    throw new Error("Export destinations must be distinct new files");
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
    const identity = {
      assessmentId,
      sessionUserId: values["owner-id"],
      subjectRole: AUTH_USER_ROLES.customer,
      correlationId: randomUUID(),
    };
    const session = await loader.load(identity);
    const report = await reports.load({ ...identity, artifactId });
    writeFileSync(sessionPath, JSON.stringify(session, null, 2) + "\n", {
      encoding: "utf8",
      flag: "wx",
    });
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", {
      encoding: "utf8",
      flag: "wx",
    });
    console.log("Saved session export: " + sessionPath);
    console.log("Saved final report: " + reportPath);
  } finally {
    await prisma.onModuleDestroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "T31 export failed");
  process.exitCode = 1;
});
