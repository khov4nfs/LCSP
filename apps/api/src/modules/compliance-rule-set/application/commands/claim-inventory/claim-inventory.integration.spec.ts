import { randomUUID } from "node:crypto";
import { ensureMigratedSchema } from "../../../../../../test/support/auth-workspace-test-helpers.js";
import { beforeAll, afterAll, describe, expect, it } from "@jest/globals";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  AgentExecutionState,
  ClaimPreparationPhase,
} from "@prisma/client";
import {
  CLAIM_INVENTORY_ACTIONS as A,
  COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES as O,
  CLAIM_INVENTORY_GAPS as G,
} from "@lcsp/contracts/compliance-rule-set";
import {
  legalSourceFactory,
  validPacket,
} from "../../../../../../test/support/compliance-rule-set-fixtures.js";
import { pinFixtureRequest } from "../../../../../../test/support/pin-legal-graph-fixture.js";
import { canonicalInventoryFixture } from "../../../../../../test/support/canonical-claim-inventory-fixture.js";
import { inventoryFingerprint } from "../../../domain/claim-inventory.js";
import { completeFixtureFrontier } from "../../../../../../test/support/complete-fixture-frontier.js";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { LegalDocumentGraphService } from "../../../../legal-source/application/services/legal-document-graph.service.js";
import { LegalSourceSnapshotLoader } from "../../../infrastructure/persistence/legal-source-snapshot.service.js";
import { StartRuleSetPreparationHandler } from "../start-rule-set-preparation/start-rule-set-preparation.handler.js";
import { StartRuleSetPreparationCommand } from "../start-rule-set-preparation/start-rule-set-preparation.command.js";
import { ClaimRuleSetPreparationHandler } from "../claim-rule-set-preparation/claim-rule-set-preparation.handler.js";
import { ClaimRuleSetPreparationCommand } from "../claim-rule-set-preparation/claim-rule-set-preparation.command.js";
import { ValidateComplianceRuleSetHandler } from "../validate-compliance-rule-set/validate-compliance-rule-set.handler.js";
import { ValidateComplianceRuleSetCommand } from "../validate-compliance-rule-set/validate-compliance-rule-set.command.js";
import { SourceReviewHandler } from "../source-review/source-review.handler.js";
import { SourceReviewCommand } from "../source-review/source-review.command.js";
import { sourceReviewUnits } from "../../../domain/source-review-frontier.js";
import { SOURCE_REVIEW_ACTIONS as SR } from "@lcsp/contracts/legal-source";
import { ClaimInventoryHandler } from "./claim-inventory.handler.js";
import { ClaimInventoryCommand } from "./claim-inventory.command.js";
const url = process.env.DATABASE_URL ?? "";
const suite = /@(127\.0\.0\.1|localhost):/u.test(url)
  ? describe
  : describe.skip;
suite("Frozen inventory real PostgreSQL lifecycle", () => {
  // Graph materialization needs the migration's deferrable parent FK.
  beforeAll(ensureMigratedSchema, 180_000);
  let db: PrismaClient,
    service: PrismaService,
    handler: ClaimInventoryHandler,
    loader: LegalSourceSnapshotLoader;
  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg(url) });
    await db.$connect();
    service = db as PrismaService;
    loader = new LegalSourceSnapshotLoader(
      service,
      new LegalDocumentGraphService(service),
    );
    handler = new ClaimInventoryHandler(service, loader);
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  it("freezes idempotently, rejects mutation, reopens a new immutable revision and rejects stale Rules", async () => {
    const source = await legalSourceFactory(db, "inventory-" + randomUUID())();
    const start = await new StartRuleSetPreparationHandler(
      service,
      new OutboxRepository(service),
    ).execute(
      new StartRuleSetPreparationCommand(
        { legalSourceVersionId: source.id, idempotencyKey: randomUUID() },
        "test-worker",
        randomUUID(),
      ),
    );
    const id = start.preparationRunId;
    await new ClaimRuleSetPreparationHandler(
      service,
      new LegalDocumentGraphService(service),
    ).execute(
      new ClaimRuleSetPreparationCommand(
        { preparationRunId: id },
        randomUUID(),
      ),
    );
    const request = await pinFixtureRequest(db, {
      preparationRunId: id,
      packet: validPacket(),
    });
    const frozen = await db.ruleSetPreparationClaimInventory.findUniqueOrThrow({
      where: {
        preparationRunId_revision: { preparationRunId: id, revision: 1 },
      },
    });
    const run = await db.ruleSetPreparationRun.findUniqueOrThrow({
      where: { id },
    });
    const frontierKey = { preparationRunId: id, inventoryRevision: 1 };
    const frontier =
      await db.ruleSetPreparationReviewFrontier.findUniqueOrThrow({
        where: { preparationRunId_inventoryRevision: frontierKey },
      });
    expect(
      frontier.pendingCount + frontier.inReviewCount + frontier.blockedCount,
    ).toBe(0);
    expect(frontier.frozenAt).not.toBeNull();
    const review = await db.ruleSetPreparationSourceReview.findFirstOrThrow({
      where: frontierKey,
    });
    await expect(
      db.ruleSetPreparationSourceReview.update({
        where: {
          preparationRunId_inventoryRevision_sourceNodeId: {
            ...frontierKey,
            sourceNodeId: review.sourceNodeId,
          },
        },
        data: { reason: "Silent correction" },
      }),
    ).rejects.toThrow("Frozen review dispositions are immutable");
    await expect(
      db.ruleSetPreparationReviewFrontier.update({
        where: { preparationRunId_inventoryRevision: frontierKey },
        data: { pendingCount: 1 },
      }),
    ).rejects.toThrow("Frozen review frontier is immutable");
    expect(run.executionState).toBe(AgentExecutionState.RUNNING);
    expect(run.claimPhase).toBe(ClaimPreparationPhase.SUBMISSION_READY);
    const operation = (
      action: (typeof A)[keyof typeof A],
      revision: number,
      fields = {},
    ) =>
      handler.execute(
        new ClaimInventoryCommand(
          { preparationRunId: id, action, revision, ...fields },
          randomUUID(),
        ),
      );
    expect(
      await operation(A.FINALIZE, 1, {
        graph: frozen.graph,
        identities: frozen.identities,
      }),
    ).toMatchObject({
      outcome: O.PASSED,
      alreadyFinalized: true,
      fingerprint: frozen.fingerprint,
    });
    await expect(
      db.ruleSetPreparationClaimInventory.update({
        where: {
          preparationRunId_revision: { preparationRunId: id, revision: 1 },
        },
        data: { fingerprint: "0".repeat(64) },
      }),
    ).rejects.toThrow("Frozen claim inventory is immutable");
    await expect(
      db.ruleSetPreparationClaimInventory.delete({
        where: {
          preparationRunId_revision: { preparationRunId: id, revision: 1 },
        },
      }),
    ).rejects.toThrow("Frozen claim inventory is immutable");
    const changed = structuredClone(request.packet.semanticGraph!);
    changed.claims[0].statement += " different";
    expect(
      await operation(A.FINALIZE, 1, {
        graph: changed,
        identities: frozen.identities,
      }),
    ).toMatchObject({
      outcome: O.FAILED,
      failures: [expect.objectContaining({ code: G.FROZEN })],
    });
    expect(
      await operation(A.REOPEN, 1, {
        reason: "Material temporal claim needs correction",
      }),
    ).toMatchObject({
      outcome: O.PASSED,
      revision: 2,
      downstreamInvalidated: true,
    });
    expect(await operation(A.AUTHOR_RULES, 1)).toMatchObject({
      outcome: O.FAILED,
      failures: [expect.objectContaining({ code: G.STALE })],
    });
    expect(
      await operation(A.REOPEN, 1, {
        reason: "Material temporal claim needs correction",
      }),
    ).toMatchObject({ outcome: O.PASSED, revision: 2, alreadyReopened: true });
    const stale = await new ValidateComplianceRuleSetHandler(
      service,
      loader,
    ).execute(new ValidateComplianceRuleSetCommand(request, randomUUID()));
    expect(stale.outcome).toBe(O.FAILED);
    expect(stale.failures).toContainEqual(
      expect.objectContaining({ code: G.STALE }),
    );
    const sourceGraph = await new LegalDocumentGraphService(service).export(
      source.id,
    );
    const next = canonicalInventoryFixture(request.packet, id, 2, sourceGraph!);
    const reviewed = await completeFixtureFrontier(
      service,
      id,
      2,
      sourceGraph!,
      next.graph,
      next.identities,
    );
    expect(reviewed.outcome).toBe(O.PASSED);
    request.packet.semanticGraph = next.graph;
    request.packet.claimInventory = {
      revision: 2,
      fingerprint: inventoryFingerprint(2, next.graph),
    };
    expect(
      await operation(A.FINALIZE, 2, {
        graph: next.graph,
        identities: next.identities,
      }),
    ).toMatchObject({ outcome: O.PASSED, revision: 2 });
    expect(await operation(A.AUTHOR_RULES, 2)).toMatchObject({
      outcome: O.PASSED,
    });
    expect(await operation(A.AUTHOR_RULES, 2)).toMatchObject({
      outcome: O.PASSED,
      alreadyStarted: true,
    });
    expect(
      (
        await new ValidateComplianceRuleSetHandler(service, loader).execute(
          new ValidateComplianceRuleSetCommand(request, randomUUID()),
        )
      ).outcome,
    ).toBe(O.PASSED);
    expect(
      await db.ruleSetPreparationClaimInventory.count({
        where: { preparationRunId: id },
      }),
    ).toBe(2);
    expect(
      (
        await db.ruleSetPreparationClaimInventory.findUniqueOrThrow({
          where: {
            preparationRunId_revision: { preparationRunId: id, revision: 1 },
          },
        })
      ).fingerprint,
    ).toBe(frozen.fingerprint);
    // No submission, activation or provider is invoked by this protocol persistence test.
    await db.legalSourceVersion.update({
      where: { id: source.id },
      data: { status: "SUPERSEDED" },
    });
  }, 30000);

  it("refuses to freeze an inventory no Rule Set can be authored from, then freezes once the owning unit is reopened and repaired", async () => {
    const source = await legalSourceFactory(db, "readiness-" + randomUUID())();
    const start = await new StartRuleSetPreparationHandler(
      service,
      new OutboxRepository(service),
    ).execute(
      new StartRuleSetPreparationCommand(
        { legalSourceVersionId: source.id, idempotencyKey: randomUUID() },
        "test-worker",
        randomUUID(),
      ),
    );
    const id = start.preparationRunId;
    await new ClaimRuleSetPreparationHandler(
      service,
      new LegalDocumentGraphService(service),
    ).execute(
      new ClaimRuleSetPreparationCommand(
        { preparationRunId: id },
        randomUUID(),
      ),
    );
    // The retained live shape: operative claims, but every applicability-bearing claim is missing (re-typed as context).
    const packet = validPacket();
    const applicabilityKeys = new Set(
      packet
        .semanticGraph!.claims.filter((c) =>
          ["SCOPE", "CONDITION"].includes(c.claimType),
        )
        .map((c) => c.claimId),
    );
    const originalTypes = new Map(
      packet.semanticGraph!.claims.map((c) => [c.claimId, c.claimType]),
    );
    expect(applicabilityKeys.size).toBeGreaterThan(0);
    for (const c of packet.semanticGraph!.claims)
      if (applicabilityKeys.has(c.claimId)) c.claimType = "CONTEXT";
    const request = await pinFixtureRequest(db, {
      preparationRunId: id,
      packet,
    });
    const frontierKey = { preparationRunId: id, inventoryRevision: 1 };
    const reviews = await db.ruleSetPreparationSourceReview.findMany({
      where: frontierKey,
    });
    const identities = Object.assign(
      {},
      ...reviews.map(
        (r) =>
          (r.payload as { identities?: Record<string, string> } | null)
            ?.identities ?? {},
      ),
    ) as Record<string, string>;
    const lacking = request.packet.semanticGraph!;
    const operation = (action: (typeof A)[keyof typeof A], graph = lacking) =>
      handler.execute(
        new ClaimInventoryCommand(
          { preparationRunId: id, action, revision: 1, graph, identities },
          randomUUID(),
        ),
      );
    // An otherwise structurally complete, model-claimed audit cannot be re-recorded
    // under a forged receipt seal, even by an authenticated worker request.
    const forged = structuredClone(lacking);
    expect(forged.semanticAudits?.length).toBeGreaterThan(0);
    forged.semanticAudits![0]!.attestation = "hmac-sha256:" + "0".repeat(64);
    const refusedForgery = await operation(A.RECORD_SEMANTIC_AUDITS, forged);
    expect(refusedForgery).toMatchObject({ outcome: O.FAILED });
    expect((refusedForgery.failures as {detail: string}[]).map((f) => f.detail).join("; "))
      .toContain("VERIFIER_ATTESTATION_INVALID");
    const refused = await operation(A.FINALIZE);
    expect(refused.outcome).toBe(O.FAILED);
    expect(
      ((refused as { failures?: { code: string }[] }).failures ?? []).filter(
        (f) => f.code === "APPLICABILITY_AUTHORITY_MISSING",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      await db.ruleSetPreparationClaimInventory.count({
        where: { preparationRunId: id },
      }),
    ).toBe(0);
    expect(
      (await db.ruleSetPreparationRun.findUniqueOrThrow({ where: { id } }))
        .claimPhase,
    ).not.toBe(ClaimPreparationPhase.CLAIM_INVENTORY_READY);

    // Repair through the real queue: reopen the units that own the missing claims, re-review them with the real types.
    const sourceGraph = (await new LegalDocumentGraphService(service).export(
      source.id,
    ))!;
    const units = sourceReviewUnits(sourceGraph);
    const repaired = structuredClone(lacking);
    const owners = new Set<string>();
    for (const c of repaired.claims)
      if (applicabilityKeys.has(identities[c.claimId])) {
        c.claimType = originalTypes.get(identities[c.claimId])!;
        owners.add(
          units.find((n) => c.sourceNodeIds.includes(n.nodeId))!.nodeId,
        );
      }
    expect(owners.size).toBeGreaterThan(0);
    const frontier =
      await db.ruleSetPreparationReviewFrontier.findUniqueOrThrow({
        where: { preparationRunId_inventoryRevision: frontierKey },
      });
    const queue = new SourceReviewHandler(
      service,
      new LegalDocumentGraphService(service),
    );
    const operationId = randomUUID();
    for (const sourceNodeId of owners)
      expect(
        (
          await queue.execute(
            new SourceReviewCommand(
              {
                preparationRunId: id,
                inventoryRevision: 1,
                operationId,
                action: SR.REOPEN,
                sourceNodeId,
                reason:
                  "Register the omitted source-grounded applicability claim",
                sourceRevision: sourceGraph.materializationId,
                frontierRevision: frontier.revision,
              },
              "fixture-review",
            ),
          )
        ).outcome,
      ).toBe(O.PASSED);
    const reviewed = await completeFixtureFrontier(
      service,
      id,
      1,
      sourceGraph,
      repaired,
      identities,
    );
    expect(reviewed.outcome).toBe(O.PASSED);
    expect(await operation(A.FINALIZE, repaired)).toMatchObject({
      outcome: O.PASSED,
    });
    expect(
      await db.ruleSetPreparationClaimInventory.count({
        where: { preparationRunId: id },
      }),
    ).toBe(1);
    await db.legalSourceVersion.update({
      where: { id: source.id },
      data: { status: "SUPERSEDED" },
    });
  }, 30000);
});
