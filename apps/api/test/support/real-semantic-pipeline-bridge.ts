/** Real application handlers, confined to a fresh task-owned database; no HTTP/production connection. */
import "reflect-metadata";
import { createInterface } from "node:readline";
import { createHash, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  claimInventoryOperationSchema,
  sourceReviewOperationSchema,
  complianceRuleSetValidateRequestSchema,
  complianceRuleSetSubmitRequestSchema,
} from "@lcsp/contracts/compliance-rule-set";
import { LEGAL_SOURCE_CHUNK_STATUSES } from "@lcsp/contracts/legal-source";
import type { PrismaService } from "../../src/infrastructure/prisma/prisma.service.js";
import { OutboxRepository } from "../../src/platform/outbox/outbox.repository.js";
import { AuditWriterService } from "../../src/platform/audit/audit-writer.service.js";
import { LegalDocumentGraphService } from "../../src/modules/legal-source/application/services/legal-document-graph.service.js";
import { LegalSourceSnapshotLoader } from "../../src/modules/compliance-rule-set/infrastructure/persistence/legal-source-snapshot.service.js";
import { ComplianceRuleSetActivation } from "../../src/modules/compliance-rule-set/infrastructure/persistence/compliance-rule-set-activation.service.js";
import { StartRuleSetPreparationHandler } from "../../src/modules/compliance-rule-set/application/commands/start-rule-set-preparation/start-rule-set-preparation.handler.js";
import { StartRuleSetPreparationCommand } from "../../src/modules/compliance-rule-set/application/commands/start-rule-set-preparation/start-rule-set-preparation.command.js";
import { ClaimRuleSetPreparationHandler } from "../../src/modules/compliance-rule-set/application/commands/claim-rule-set-preparation/claim-rule-set-preparation.handler.js";
import { ClaimRuleSetPreparationCommand } from "../../src/modules/compliance-rule-set/application/commands/claim-rule-set-preparation/claim-rule-set-preparation.command.js";
import { SourceReviewHandler } from "../../src/modules/compliance-rule-set/application/commands/source-review/source-review.handler.js";
import { SourceReviewCommand } from "../../src/modules/compliance-rule-set/application/commands/source-review/source-review.command.js";
import { ClaimInventoryHandler } from "../../src/modules/compliance-rule-set/application/commands/claim-inventory/claim-inventory.handler.js";
import { ClaimInventoryCommand } from "../../src/modules/compliance-rule-set/application/commands/claim-inventory/claim-inventory.command.js";
import { ValidateComplianceRuleSetHandler } from "../../src/modules/compliance-rule-set/application/commands/validate-compliance-rule-set/validate-compliance-rule-set.handler.js";
import { ValidateComplianceRuleSetCommand } from "../../src/modules/compliance-rule-set/application/commands/validate-compliance-rule-set/validate-compliance-rule-set.command.js";
import { SubmitComplianceRuleSetHandler } from "../../src/modules/compliance-rule-set/application/commands/submit-compliance-rule-set/submit-compliance-rule-set.handler.js";
import { SubmitComplianceRuleSetCommand } from "../../src/modules/compliance-rule-set/application/commands/submit-compliance-rule-set/submit-compliance-rule-set.command.js";

const url = process.env.DATABASE_URL ?? "";
if (
  !/^postgresql:\/\/postgres:[^@]+@127\.0\.0\.1:55449\/lcsp_semantic_pipeline_test$/u.test(
    url,
  )
)
  throw new Error("Exact isolated semantic-pipeline database required");
const db = new PrismaClient({ adapter: new PrismaPg(url) });
const prisma = db as PrismaService;
const graphs = new LegalDocumentGraphService(prisma);
const source = new LegalSourceSnapshotLoader(prisma, graphs);
const outbox = new OutboxRepository(prisma);
const activation = new ComplianceRuleSetActivation(
  outbox,
  new AuditWriterService(prisma),
);
const correlationId = randomUUID();
type Input = { action: string; request: unknown };

async function invoke(input: Input) {
  if (input.action === "SETUP") {
    if (
      (await db.legalSourceVersion.count()) ||
      (await db.ruleSetPreparationRun.count())
    )
      throw new Error(
        "Fresh isolated database required; never reseed an existing run",
      );
    const value = input.request as {
      documentId: string;
      title: string;
      provenance: string;
      pdfSha256: string;
      ingestion: {
        extraction: object;
        chunks: Array<{
          locator: string;
          content: string;
          contentSha256: string;
          hierarchy: object;
          pageStart: number | null;
          pageEnd: number | null;
        }>;
      };
    };
    const version = await db.legalSourceVersion.create({
      data: {
        version: "lcsp360-semantic-pipeline-" + randomUUID(),
        status: "ACTIVE",
        sourceManifest: {
          synthetic: true,
          isolatedSemanticAcceptance: true,
          pdfSha256: value.pdfSha256,
        },
      },
    });
    const document = await db.legalSourceDocument.create({
      data: {
        legalSourceVersionId: version.id,
        documentId: value.documentId,
        title: value.title,
        sourceSha256: value.pdfSha256,
        sourceUrl: "https://example.invalid/lcsp360-isolated",
        sourceEffectStatus: "IN_FORCE",
        extraction: value.ingestion.extraction,
      },
    });
    await db.legalDocumentChunk.createMany({
      data: value.ingestion.chunks.map((c) => ({
        ...c,
        id: randomUUID(),
        legalSourceVersionId: version.id,
        legalSourceDocumentId: document.id,
        documentId: value.documentId,
        legalStatus: "UNKNOWN",
        legalEffectStatus: LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE,
        legalStatusSourceRef: value.provenance,
      })),
    });
    await graphs.materialize(version.id);
    await db.legalRetrievalIndex.create({
      data: {
        legalSourceVersionId: version.id,
        version: "isolated-v1",
        status: "VALID",
        configHash: createHash("sha256").update("isolated-v1").digest("hex"),
        contentHash: value.pdfSha256,
        validationManifestRef: "isolated:exact-pdf-ingestion",
        validatedAt: new Date(),
      },
    });
    return {
      legalSourceVersionId: version.id,
      documentGraph: await graphs.export(version.id),
      preparations: await db.ruleSetPreparationRun.count(),
    };
  }
  if (input.action === "START") {
    const { legalSourceVersionId } = input.request as {
      legalSourceVersionId: string;
    };
    if (await db.ruleSetPreparationRun.count())
      throw new Error(
        "Exactly one isolated Producer run; existing run must be resumed",
      );
    const started = await new StartRuleSetPreparationHandler(
      prisma,
      outbox,
    ).execute(
      new StartRuleSetPreparationCommand(
        { legalSourceVersionId, idempotencyKey: randomUUID() },
        "isolated-semantic-evaluation",
        correlationId,
      ),
    );
    return new ClaimRuleSetPreparationHandler(prisma, graphs).execute(
      new ClaimRuleSetPreparationCommand(
        { preparationRunId: started.preparationRunId },
        correlationId,
      ),
    );
  }
  if (input.action === "REVIEW")
    return new SourceReviewHandler(prisma, graphs).execute(
      new SourceReviewCommand(
        sourceReviewOperationSchema.parse(input.request),
        correlationId,
      ),
    );
  if (input.action === "INVENTORY")
    return new ClaimInventoryHandler(prisma, source).execute(
      new ClaimInventoryCommand(
        claimInventoryOperationSchema.parse(input.request),
        correlationId,
      ),
    );
  if (input.action === "VALIDATE")
    return new ValidateComplianceRuleSetHandler(prisma, source).execute(
      new ValidateComplianceRuleSetCommand(
        complianceRuleSetValidateRequestSchema.parse(input.request),
        correlationId,
      ),
    );
  if (input.action === "SUBMIT")
    return new SubmitComplianceRuleSetHandler(
      prisma,
      source,
      activation,
    ).execute(
      new SubmitComplianceRuleSetCommand(
        complianceRuleSetSubmitRequestSchema.parse(input.request),
        "isolated-semantic-evaluation",
        correlationId,
      ),
    );
  if (input.action === "SNAPSHOT") {
    const { preparationRunId } = input.request as { preparationRunId: string };
    return {
      run: await db.ruleSetPreparationRun.findUniqueOrThrow({
        where: { id: preparationRunId },
      }),
      reviews: await db.ruleSetPreparationSourceReview.findMany({
        where: { preparationRunId },
        orderBy: { ordinal: "asc" },
      }),
      inventories: await db.ruleSetPreparationClaimInventory.findMany({
        where: { preparationRunId },
      }),
      ruleSets: await db.complianceRuleSetVersion.findMany({
        where: { preparationRunId },
      }),
    };
  }
  throw new Error("Unknown isolated pipeline action");
}

try {
  for await (const line of createInterface({ input: process.stdin })) {
    try {
      console.log(
        JSON.stringify({ result: await invoke(JSON.parse(line) as Input) }),
      );
    } catch (error) {
      console.log(JSON.stringify({ error: String(error) }));
    }
  }
} finally {
  await db.$disconnect();
}
