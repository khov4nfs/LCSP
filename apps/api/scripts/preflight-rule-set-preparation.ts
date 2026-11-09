import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "dotenv";
import {
  PrismaClient,
  LegalSourceLifecycleStatus,
  ArtifactLifecycleState,
  Prisma,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loadRuleSetPreparationAvailability } from "../src/modules/compliance-rule-set/infrastructure/persistence/rule-set-preparation-availability.loader.js";
/** Read-only diagnostic: no HTTP command, model invocation, migration, activation or canonical write. */
const file = process.env.LCSP_PREFLIGHT_ENV_FILE;
const config = file ? parse(readFileSync(file)) : {};
const url = process.env.DATABASE_URL ?? config.DATABASE_URL;
if (!url)
  throw Error(
    "Explicit local DATABASE_URL or LCSP_PREFLIGHT_ENV_FILE required",
  );
const endpoint = new URL(url);
if (!["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname))
  throw Error("Only a local diagnostic database may be inspected");
const db = new PrismaClient({ adapter: new PrismaPg(url) });
try {
  const evidence = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
      const sources = await tx.legalSourceVersion.findMany({
        where: { status: LegalSourceLifecycleStatus.ACTIVE },
        select: {
          id: true,
          version: true,
          status: true,
          activatedAt: true,
          createdAt: true,
          integrityManifestRef: true,
          sourceManifest: true,
          _count: { select: { documents: true, chunks: true } },
          activations: {
            where: { status: LegalSourceLifecycleStatus.ACTIVE },
            orderBy: { activatedAt: "desc" },
            take: 1,
            select: {
              integrityManifestRef: true,
              retrievalValidationRef: true,
            },
          },
          retrievalIndexes: {
            select: {
              status: true,
              validationManifestRef: true,
              validatedAt: true,
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 10,
      });
      const columns = await tx.$queryRaw<
        Array<{ table_name: string; column_name: string }>
      >`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('ComplianceRuleSetVersion','RuleSetPreparationRun')`;
      const required = [
        ["ComplianceRuleSetVersion", "targetActivityScope"],
        ["RuleSetPreparationRun", "targetActivityScope"],
        ["RuleSetPreparationRun", "executionContract"],
        ["RuleSetPreparationRun", "claimPhase"],
        ["RuleSetPreparationRun", "claimInventoryRevision"],
      ];
      const schemaGaps = required
        .filter(
          ([table, column]) =>
            !columns.some(
              (item) =>
                item.table_name === table && item.column_name === column,
            ),
        )
        .map(([table, column]) => `${table}.${column}`);
      const availability = schemaGaps.length
        ? null
        : await loadRuleSetPreparationAvailability(tx);
      const rules = await tx.complianceRuleSetVersion.findMany({
        where: {
          lifecycleState: ArtifactLifecycleState.ACTIVE,
          legalSourceVersionId: { in: sources.map((source) => source.id) },
        },
        select: {
          id: true,
          version: true,
          ruleSetDigest: true,
          legalSourceVersionId: true,
        },
      });
      const runs = await tx.ruleSetPreparationRun.findMany({
        where: {
          legalSourceVersionId: { in: sources.map((source) => source.id) },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          legalSourceVersionId: true,
          executionState: true,
          failureReason: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
        },
      });
      return {
        database: {
          host: endpoint.hostname,
          port: endpoint.port,
          localDatabase: endpoint.pathname,
          readOnly: true,
        },
        schemaGaps,
        preflightState: schemaGaps.length
          ? "BLOCKED_RUNTIME_CONFIGURATION"
          : "READ_ONLY_METADATA_COLLECTED",
        sources: sources.map(({ sourceManifest, ...source }) => ({
          ...source,
          diagnosticManifestJsonSha256: createHash("sha256")
            .update(JSON.stringify(sourceManifest))
            .digest("hex"),
          digestCaveat:
            "Diagnostic JSON serialization hash, not a substitute for the activated integrity-manifest identity",
        })),
        availability,
        activeRuleSets: rules,
        existingRuns: runs,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 15000,
    },
  );
  console.log(JSON.stringify(evidence, null, 2));
} catch (error: unknown) {
  const code =
    error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
  console.error(
    JSON.stringify({
      preflightState: "BLOCKED_RUNTIME_CONFIGURATION",
      errorClass: error instanceof Error ? error.name : "UNKNOWN",
      code,
    }),
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
