/** Isolated Phase 5 fixture port. No AppModule, consumers, activation or authoring. */
import "reflect-metadata";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  LegalSourceLifecycleStatus,
  LegalRetrievalIndexStatus,
  Prisma,
  PrismaClient,
  type LegalSourceDocument,
} from "@prisma/client";
import {
  claimInventoryOperationSchema,
  sourceReviewOperationSchema,
  COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES as O,
  RULE_SET_PREPARATION_FAILURE_REASONS as R,
} from "@lcsp/contracts/compliance-rule-set";
import type { PrismaService } from "../../src/infrastructure/prisma/prisma.service.js";
import { LegalDocumentGraphService } from "../../src/modules/legal-source/application/services/legal-document-graph.service.js";
import {
  SourceReviewHandler,
  StartClaimDiscoveryDiagnosticHandler,
} from "../../src/modules/compliance-rule-set/application/commands/source-review/source-review.handler.js";
import {
  SourceReviewCommand,
  StartClaimDiscoveryDiagnosticCommand,
} from "../../src/modules/compliance-rule-set/application/commands/source-review/source-review.command.js";
import { ClaimInventoryHandler } from "../../src/modules/compliance-rule-set/application/commands/claim-inventory/claim-inventory.handler.js";
import { ClaimInventoryCommand } from "../../src/modules/compliance-rule-set/application/commands/claim-inventory/claim-inventory.command.js";
import { LegalSourceSnapshotLoader } from "../../src/modules/compliance-rule-set/infrastructure/persistence/legal-source-snapshot.service.js";
import { FailRuleSetPreparationHandler } from "../../src/modules/compliance-rule-set/application/commands/fail-rule-set-preparation/fail-rule-set-preparation.handler.js";
import { FailRuleSetPreparationCommand } from "../../src/modules/compliance-rule-set/application/commands/fail-rule-set-preparation/fail-rule-set-preparation.command.js";

const url =
  "postgresql://postgres:postgres@127.0.0.1:55449/lcsp_review_frontier_test";
if (process.env.DATABASE_URL !== url)
  throw new Error("Exact evaluator database required");
const [container] = JSON.parse(
  execFileSync("docker", ["inspect", "lcsp-fbd-eval-pg"], { encoding: "utf8" }),
) as {
  Id: string;
  Config: { Labels: Record<string, string> };
  NetworkSettings: { Ports: Record<string, { HostPort: string }[] | null> };
}[];
if (
  !process.env.LCSP_FBD_EVAL_OWNER ||
  container.Id !== process.env.LCSP_FBD_EVAL_CONTAINER_ID ||
  container.Config.Labels["lcsp.fbd.eval.owner"] !==
    process.env.LCSP_FBD_EVAL_OWNER ||
  container.NetworkSettings.Ports["5432/tcp"]?.[0]?.HostPort !== "55449"
)
  throw new Error("Database was not created by this evaluator");
const db = new PrismaClient({ adapter: new PrismaPg(url) });
const service = db as PrismaService;
const graphs = new LegalDocumentGraphService(service);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

type SeedEntry = {
  document: Prisma.LegalSourceDocumentCreateManyInput;
  chunks: Prisma.LegalDocumentChunkCreateManyInput[];
};
type Seed = {
  entries: SeedEntry[];
  expectedNodes?: number;
  expectedReferences?: number;
};
async function seed(input: Seed) {
  // Same Prisma fixture pattern as review-frontier-bridge; preserve source bytes and hashes.
  const source = await db.legalSource.create({
    data: {
      slug: "fbd-eval-" + randomUUID(),
      name: "Phase 5 isolated evaluation",
    },
  });
  const version = await db.legalSourceVersion.create({
    data: {
      legalSourceId: source.id,
      version: "fbd-eval-" + randomUUID(),
      status: LegalSourceLifecycleStatus.DRAFT,
      sourceManifest: {
        purpose: "claim-discovery-diagnostic",
        exportedVersion: "c5579ca5-748a-499d-b5d1-327f9e39ef17",
      },
    },
  });
  const documents: LegalSourceDocument[] = [];
  for (const entry of input.entries) {
    const documentData = { ...entry.document };
    delete documentData.id;
    delete documentData.createdAt;
    delete documentData.blobSha256;
    const document = await db.legalSourceDocument.create({
      data: {
        ...documentData,
        legalSourceVersionId: version.id,
        // psql row_to_json emits zone-less timestamps; they are UTC.
        effectiveDate: documentData.effectiveDate
          ? documentData.effectiveDate instanceof Date
            ? documentData.effectiveDate
            : new Date(`${documentData.effectiveDate}Z`)
          : null,
        ingestedAt: documentData.ingestedAt
          ? documentData.ingestedAt instanceof Date
            ? documentData.ingestedAt
            : new Date(`${documentData.ingestedAt}Z`)
          : null,
        extraction: documentData.extraction ?? Prisma.JsonNull,
        provenance: documentData.provenance ?? Prisma.JsonNull,
      },
    });
    await db.legalDocumentChunk.createMany({
      data: entry.chunks.map((chunk) => {
        const copied = {
          ...chunk,
          legalSourceVersionId: version.id,
          legalSourceDocumentId: document.id,
        };
        delete copied.createdAt;
        return copied;
      }),
    });
    documents.push(document);
  }
  const input_chunks = input.entries.flatMap((e) => e.chunks);
  const copied = await db.legalDocumentChunk.findMany({
    where: { legalSourceVersionId: version.id },
    orderBy: { locator: "asc" },
  });
  const expected = new Map(input_chunks.map((c) => [c.id, c]));
  if (
    copied.length !== expected.size ||
    copied.some(
      (c) =>
        c.content !== expected.get(c.id)?.content ||
        c.contentSha256 !== expected.get(c.id)?.contentSha256,
    )
  )
    throw new Error("Exported chunk bytes/hashes changed");
  await db.legalRetrievalIndex.create({
    data: {
      legalSourceVersionId: version.id,
      version: "fbd-eval-" + version.id,
      status: LegalRetrievalIndexStatus.VALID,
      configHash: hash("phase5-fixture"),
      contentHash: hash(copied.map((c) => c.contentSha256).join("\n")),
      validationManifestRef: "phase5:copied-source-hashes",
      validatedAt: new Date(),
    },
  });
  const graph = await graphs.materialize(version.id);
  if (
    (input.expectedNodes !== undefined &&
      graph.nodes.length !== input.expectedNodes) ||
    (input.expectedReferences !== undefined &&
      graph.references.length !== input.expectedReferences)
  )
    throw new Error(
      `Materialization mismatch: ${graph.nodes.length} nodes, ${graph.references.length} references`,
    );
  const started = await new StartClaimDiscoveryDiagnosticHandler(
    service,
    graphs,
  ).execute(new StartClaimDiscoveryDiagnosticCommand(version.id, randomUUID()));
  if (started.outcome !== O.PASSED) throw new Error(JSON.stringify(started));
  return {
    ...started,
    legalSourceVersionId: version.id,
    legalSourceVersion: version.version,
    documents: documents.map((document) => ({
      ...document,
      chunks: copied
        .filter((c) => c.legalSourceDocumentId === document.id)
        .map((c) => ({ ...c, chunkId: c.id })),
    })),
  };
}

async function invoke(input: { action: string; request: unknown }) {
  if (input.action === "SEED") return seed(input.request as Seed);
  if (input.action === "REVIEW")
    return new SourceReviewHandler(service, graphs).execute(
      new SourceReviewCommand(
        sourceReviewOperationSchema.parse(input.request),
        "phase5-eval",
      ),
    );
  if (input.action === "INVENTORY")
    return new ClaimInventoryHandler(
      service,
      new LegalSourceSnapshotLoader(service, graphs),
    ).execute(
      new ClaimInventoryCommand(
        claimInventoryOperationSchema.parse(input.request),
        "phase5-eval",
      ),
    );
  const preparationRunId = String(
    (input.request as { preparationRunId: string }).preparationRunId,
  );
  const run = await db.ruleSetPreparationRun.findUniqueOrThrow({
    where: { id: preparationRunId },
  });
  if (!run.claimDiscoveryOnly) throw new Error("Discovery-only run required");
  if (input.action === "PAUSE")
    return new FailRuleSetPreparationHandler(service).execute(
      new FailRuleSetPreparationCommand(
        { preparationRunId, reason: R.AGENT_BUDGET_REACHED },
        "phase5-eval",
      ),
    );
  if (input.action === "STATE")
    return {
      run,
      rows: await db.ruleSetPreparationSourceReview.findMany({
        where: { preparationRunId },
        orderBy: { ordinal: "asc" },
      }),
      frontier: await db.ruleSetPreparationReviewFrontier.findFirst({
        where: { preparationRunId },
      }),
      ruleSets: await db.complianceRuleSetVersion.count({
        where: { preparationRunId },
      }),
    };
  throw new Error("Unknown evaluation action");
}
try {
  for await (const line of createInterface({ input: process.stdin })) {
    try {
      console.log(
        JSON.stringify({
          result: await invoke(
            JSON.parse(line) as { action: string; request: unknown },
          ),
        }),
      );
    } catch (error) {
      console.log(JSON.stringify({ error: String(error) }));
    }
  }
} finally {
  await db.$disconnect();
}
