/** Provider-free bridge to the real transactional handlers on an exact task-owned database. */
import "reflect-metadata";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createHash, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  sourceReviewOperationSchema,
  claimInventoryOperationSchema,
  sourceReviewPayloadSchema,
  LEGAL_SEMANTIC_GRAPH_VERSION,
} from "@lcsp/contracts/compliance-rule-set";
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
import { LegalDocumentGraphService } from "../../src/modules/legal-source/application/services/legal-document-graph.service.js";
import { LegalSourceSnapshotLoader } from "../../src/modules/compliance-rule-set/infrastructure/persistence/legal-source-snapshot.service.js";
import { pinnedMaterializationId } from "../../src/modules/compliance-rule-set/infrastructure/persistence/preparation-inventory.persistence.js";
import type { PrismaService } from "../../src/infrastructure/prisma/prisma.service.js";
import {
  legalSourceFactory,
  fixtureLegalSource,
  validPacket,
} from "./compliance-rule-set-fixtures.js";
import { seedRetainedReferenceBinding } from "./seed-retained-reference-binding.js";
import { sourceReviewUnits } from "../../src/modules/compliance-rule-set/domain/source-review-frontier.js";
import { seedReferenceDependencies } from "./seed-reference-dependencies.js";
import type { ModelEdge } from "./reference-dependency-model.js";
import { semanticAuditInput } from "../../src/modules/compliance-rule-set/domain/semantic-audit.js";

const url = process.env.DATABASE_URL ?? "";
if (
  !/^postgresql:\/\/postgres:[^@]+@127\.0\.0\.1:55449\/lcsp_review_frontier_test(?:\?schema=public)?$/u.test(
    url,
  )
)
  throw new Error("Exact task-owned frontier test database required");
type BridgeInput = {
  action: string;
  request: unknown;
  small?: boolean;
  targetDescendant?: boolean;
  nodes?: number;
  edges?: ModelEdge[];
  requests?: unknown[];
};
const db = new PrismaClient({ adapter: new PrismaPg(url) });
const service = db as PrismaService;
const graphs = new LegalDocumentGraphService(service);
async function invoke(input: BridgeInput) {
  let result: unknown;
  if (
    input.action === "SEED_DEPENDENCIES" ||
    input.action === "SEED_FAILED_LIVE"
  ) {
    result = await seedReferenceDependencies(
      db,
      input.nodes,
      input.edges,
      input.action === "SEED_FAILED_LIVE",
    );
  } else if (input.action === "RACE") {
    result = await Promise.all(
      (input.requests ?? []).map((request) =>
        new SourceReviewHandler(service, graphs).execute(
          new SourceReviewCommand(
            sourceReviewOperationSchema.parse(request),
            "concurrency-probe",
          ),
        ),
      ),
    );
  } else if (input.action === "AUDIT_INPUT") {
    const request = input.request as {
      preparationRunId: string;
      sourceNodeId: string;
      payload: unknown;
      claimIds: string[];
    };
    const run = await db.ruleSetPreparationRun.findUniqueOrThrow({
      where: { id: request.preparationRunId },
    });
    const source = (await graphs.export(
      run.legalSourceVersionId,
      await pinnedMaterializationId(db, run.id),
    ))!;
    const rows = await db.ruleSetPreparationSourceReview.findMany({
      where: { preparationRunId: run.id, inventoryRevision: 1 },
    });
    const payloads = rows
      .filter((r) => r.sourceNodeId !== request.sourceNodeId)
      .map((r) => sourceReviewPayloadSchema.parse(r.payload))
      .concat(sourceReviewPayloadSchema.parse(request.payload));
    result = semanticAuditInput(
      source,
      {
        contractVersion: LEGAL_SEMANTIC_GRAPH_VERSION,
        materializationId: source.materializationId,
        legalSourceVersionId: source.legalSourceVersionId,
        claims: [
          ...new Map(
            payloads.flatMap((p) => p.claims).map((c) => [c.claimId, c]),
          ).values(),
        ],
        relations: [
          ...new Map(
            payloads
              .flatMap((p) =>
                p.relations.filter(
                  (r) => !p.invalidatedRelationIds?.includes(r.relationId),
                ),
              )
              .map((r) => [r.relationId, r]),
          ).values(),
        ],
        sourceAccounting: [
          {
            sourceNodeId: request.sourceNodeId,
            claimIds: request.claimIds,
            nonSemanticReason: null,
          },
        ],
        referenceAccounting: [],
      },
      request.sourceNodeId,
      1,
    );
  } else if (input.action === "STATE") {
    const { preparationRunId } = input.request as { preparationRunId: string };
    result = {
      rows: await db.ruleSetPreparationSourceReview.findMany({
        where: { preparationRunId },
        orderBy: { ordinal: "asc" },
      }),
      frontier: await db.ruleSetPreparationReviewFrontier.findFirst({
        where: { preparationRunId },
      }),
    };
  } else if (input.action === "EXPIRE_LEASE") {
    const { preparationRunId, sourceNodeId } = input.request as {
      preparationRunId: string;
      sourceNodeId: string;
    };
    result = await db.ruleSetPreparationSourceReview.update({
      where: {
        preparationRunId_inventoryRevision_sourceNodeId: {
          preparationRunId,
          inventoryRevision: 1,
          sourceNodeId,
        },
      },
      data: { leaseExpiresAt: new Date(0) },
    });
  } else if (input.action === "SEED_RETAINED") {
    result = await seedRetainedReferenceBinding(db);
  } else if (input.action === "SEED") {
    let source: { id: string };
    if (input.small) {
      const content = JSON.parse(
        readFileSync(
          new URL(
            "../../../../deepagents/tests/fixtures/review-frontier-source.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ) as { title: string; articles: string[] };
      if (input.targetDescendant)
        content.articles[5] = content.articles[5].replace(
          "\nA record",
          "\nParagraph 2. A record",
        );
      const hash = (s: string) => createHash("sha256").update(s).digest("hex");
      source = await db.legalSourceVersion.create({
        data: {
          version: "frontier-small-" + randomUUID(),
          status: "DRAFT",
          sourceManifest: {
            synthetic: true,
            purpose: "claim-discovery-diagnostic",
          },
        },
      });
      const document = await db.legalSourceDocument.create({
        data: {
          legalSourceVersionId: source.id,
          documentId: "synthetic-discovery",
          title: content.title,
          sourceUrl: "https://example.invalid/lcsp360/synthetic-discovery",
          sourceSha256: hash(content.articles.join("\n\n")),
          sourceEffectStatus: "IN_FORCE",
          ...(input.targetDescendant
            ? {
                snapshotPath: "synthetic-descendant.txt",
                extraction: {
                  pages: [content.articles.join("\n\n")],
                  pageCount: 1,
                },
              }
            : {}),
        },
      });
      await db.legalDocumentChunk.createMany({
        data: content.articles.map((text, i) => ({
          id: randomUUID(),
          legalSourceVersionId: source.id,
          legalSourceDocumentId: document.id,
          documentId: document.documentId,
          locator: "art-" + (i + 1),
          content: text,
          contentSha256: hash(text),
          hierarchy: {
            chapter: "I",
            chapterTitle: "Synthetic discovery",
            articleTitle: text.split("\n")[0].split(" — ")[1],
          },
          legalStatus: "ACTIVE",
          legalEffectStatus: "EFFECTIVE",
          legalStatusSourceRef: "synthetic-fixture:declared-in-force",
        })),
      });
      await db.legalRetrievalIndex.create({
        data: {
          legalSourceVersionId: source.id,
          version: "synthetic-frontier-v1-" + source.id,
          status: "VALID",
          configHash: hash("synthetic-frontier-v1"),
          contentHash: hash(content.articles.join("\n\n")),
          validationManifestRef: "synthetic-fixture:exact-content-hashes",
          validatedAt: new Date(),
        },
      });
    } else
      source = await legalSourceFactory(db, "frontier-" + randomUUID())(
        false,
        "DRAFT",
      );
    await graphs.materialize(source.id);
    const started = await new StartClaimDiscoveryDiagnosticHandler(
      service,
      graphs,
    ).execute(
      new StartClaimDiscoveryDiagnosticCommand(source.id, randomUUID()),
    );
    if (started.outcome !== "PASSED")
      throw new Error("Diagnostic setup refused");
    const snapshot = (
      await new LegalSourceSnapshotLoader(service, graphs).load(
        {
          id: String(started.preparationRunId),
          legalSourceVersionId: source.id,
        },
        {
          legalRequirements: [],
          assessmentRules: [],
          contextRelations: [],
        },
      )
    ).snapshot;
    const packet = validPacket();
    const prior = fixtureLegalSource().documentGraph!;
    const paths = new Map(prior.nodes.map((n) => [n.nodeId, n.structuralPath]));
    const targets = new Map(
      snapshot.documentGraph!.nodes.map((n) => [n.structuralPath, n.nodeId]),
    );
    if (!input.small)
      for (const claim of packet.semanticGraph!.claims) {
        claim.legalSourceVersionId = source.id;
        claim.sourceNodeIds = claim.sourceNodeIds.map((id) =>
          targets.get(paths.get(id)!)!,
        );
      }
    result = {
      ...started,
      source: snapshot,
      packet,
      reviewUnits: sourceReviewUnits(snapshot.documentGraph!),
    };
  } else if (input.action === "REVIEW") {
    result = await new SourceReviewHandler(service, graphs).execute(
      new SourceReviewCommand(
        sourceReviewOperationSchema.parse(input.request),
        "scripted-review",
      ),
    );
  } else if (input.action === "INVENTORY") {
    result = await new ClaimInventoryHandler(
      service,
      new LegalSourceSnapshotLoader(service, graphs),
    ).execute(
      new ClaimInventoryCommand(
        claimInventoryOperationSchema.parse(input.request),
        "scripted-freeze",
      ),
    );
  } else throw new Error("Unknown bridge action");
  return result;
}
try {
  if (process.env.REVIEW_FRONTIER_BRIDGE_STREAM === "true") {
    for await (const line of createInterface({ input: process.stdin })) {
      try {
        console.log(
          JSON.stringify({
            result: await invoke(JSON.parse(line) as BridgeInput),
          }),
        );
      } catch (error) {
        console.log(JSON.stringify({ error: String(error) }));
      }
    }
  } else
    console.log(
      JSON.stringify(
        await invoke(JSON.parse(readFileSync(0, "utf8")) as BridgeInput),
      ),
    );
} finally {
  await db.$disconnect();
}
