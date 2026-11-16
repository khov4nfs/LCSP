import "reflect-metadata";
import { ensureMigratedSchema } from "./support/auth-workspace-test-helpers.js";
import { randomUUID, createHash } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect, jest } from "@jest/globals";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CommandBus } from "@nestjs/cqrs";
import request from "supertest";
import {
  AgentExecutionState as A,
  LegalSourceLifecycleStatus,
  LegalRetrievalIndexStatus,
  LegalEffectStatus,
  Prisma,
} from "@prisma/client";
import { LEGAL_SOURCE_DELETION_BLOCKERS } from "@lcsp/contracts/legal-source";
import { LegalSourceDeletionService } from "../src/modules/legal-source/application/services/legal-source-deletion.service.js";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  LEGAL_RULE_SELECTION_MODES as M,
  LEGAL_RULE_CATALOG_ERRORS as E,
  LEGAL_RULE_PREPARATION_STATES as S,
  preparationRuleOutputSchema,
  preparationRuleInputSchema,
  type PreparationRuleBatch,
} from "@lcsp/contracts/legal-rule-catalog";
import {
  COMPLIANCE_RULE_SET_EVENT_TYPES,
  RULE_SET_PREPARATION_FAILURE_REASONS,
} from "@lcsp/contracts/compliance-rule-set";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../src/platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../src/platform/outbox/outbox.repository.js";
import { RbacGuard } from "../src/platform/rbac/rbac.guard.js";
import { RbacContextLoader } from "../src/platform/rbac/rbac-context.loader.js";
import { AUTHORIZATION_DECISION_REPOSITORY } from "../src/platform/rbac/authorization-decision.repository.js";
import { WorkerApiKeyGuard } from "../src/common/guards/worker-api-key.guard.js";
import { LegalRuleCatalogService } from "../src/modules/legal-rule-catalog/application/services/legal-rule-catalog.service.js";
import { PreparationRuleService } from "../src/modules/legal-rule-catalog/application/services/preparation-rule.service.js";
import {
  LegalRuleCatalogController,
  PreparationRuleWorkerController,
} from "../src/modules/legal-rule-catalog/presentation/http/legal-rule-catalog.controller.js";
import { LegalSourceActivatedConsumer } from "../src/modules/compliance-rule-set/infrastructure/messaging/legal-source-activated.consumer.js";
import { validPacket } from "./support/compliance-rule-set-fixtures.js";
import type { RabbitMqClient } from "../src/platform/outbox/rabbitmq.client.js";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://unused/unused");
const disposable =
  url.hostname === "127.0.0.1" &&
  ((url.port === "55569" && url.pathname === "/lcsp_369_test") ||
    (url.port === "55434" && url.pathname === "/lcsp_api_e2e"));
const database = disposable ? describe : describe.skip;
const root = "/admin/legal-rule-catalog";
const workerRoot = "/internal/legal-rule-preparation";
const key = "lcsp369-provider-free-worker-key";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

database(
  "LCSP-369 complete selected Preparation Rule Set API flow (no provider/broker)",
  () => {
    let app: INestApplication;
    let db: PrismaService;
    let catalog: LegalRuleCatalogService;
    let catalogId: string;
    let sourceId: string;
    let indexId: string;
    let revision: number;
    let ruleIds: string[];
    let batch: PreparationRuleBatch;
    const tag = randomUUID();
    const actor = `lcsp369-admin-${tag}`;
    const post = (path: string, body: object, token = "admin") =>
      request(app.getHttpServer())
        .post(`${root}${path}`)
        .set("Authorization", `Bearer ${token}`)
        .send(body);
    const get = (path: string, token = "admin") =>
      request(app.getHttpServer())
        .get(`${root}${path}`)
        .set("Authorization", `Bearer ${token}`);
    const worker = (path: string, body: object) =>
      request(app.getHttpServer())
        .post(`${workerRoot}${path}`)
        .set("x-worker-api-key", key)
        .send(body);
    const receipt = (content: string) => ({
      revision: `sha256:${hash(content)}`,
      fingerprint: hash(content),
      content,
      bundleFingerprint: hash(`bundle:${content}`),
    });
    let sourceRef: {
      documentId: string;
      locator: string;
      contentSha256: string;
    };
    const output = (
      analysis = "Synthetic selected-rule preparation result",
    ) => {
      const packet = validPacket();
      const parentId = `${ruleIds[0]}:requirement-1`;
      const parent = {
        ...packet.legalRequirements[0],
        legalRequirementId: parentId,
        sourceRefs: [sourceRef],
        operativePropositions:
          packet.legalRequirements[0].operativePropositions!.map(
            (proposition) => ({ ...proposition, sourceRefs: [sourceRef] }),
          ),
        claimBindings: [],
      };
      const rule = {
        ...packet.assessmentRules[0],
        assessmentRuleId: `${ruleIds[0]}:assessment-1`,
        legalRequirementIds: [parentId],
        sourceRefs: [sourceRef],
        legalIntent: undefined,
        applicabilityGuidance: undefined,
        contextRelationIds: [],
        unresolvedConditions: undefined,
        unresolvedConditionBindings: [],
        criteria: [
          {
            ...packet.assessmentRules[0].criteria[0],
            legalRequirementIds: [parentId],
            statement: undefined,
          },
        ],
      };
      return preparationRuleOutputSchema.parse({
        analysis,
        legalRequirements: [parent],
        assessmentRules: [rule],
        contextRelations: [],
      });
    };
    const select = (ids: string[], expectedRevision = revision) =>
      post("/selections", {
        catalogVersionId: catalogId,
        expectedRevision,
        mode: M.EXPLICIT,
        filters: { search: "" },
        ruleIds: ids,
      });

    beforeAll(async () => {
      await ensureMigratedSchema();
      db = new PrismaService();
      await db.$connect();
      const builder = await Test.createTestingModule({
        controllers: [
          LegalRuleCatalogController,
          PreparationRuleWorkerController,
        ],
        providers: [
          { provide: PrismaService, useValue: db },
          LegalRuleCatalogService,
          PreparationRuleService,
          AuditWriterService,
          OutboxRepository,
          RbacGuard,
          WorkerApiKeyGuard,
          {
            provide: ConfigService,
            useValue: new ConfigService({ worker: { apiKey: key } }),
          },
          {
            provide: CommandBus,
            useValue: { execute: jest.fn(async () => ({})) },
          },
          {
            provide: AUTHORIZATION_DECISION_REPOSITORY,
            useValue: { append: jest.fn(async () => undefined) },
          },
          {
            provide: RbacContextLoader,
            useValue: {
              load: async (token: string) =>
                token === "invalid"
                  ? { ok: false, reason: "SESSION_INVALID" }
                  : {
                      ok: true,
                      session: {
                        id: randomUUID(),
                        userId:
                          token === "other-admin" ? `${actor}-other` : actor,
                        mfaGenerationId: "generation",
                      },
                      user: {
                        role:
                          token === "customer"
                            ? AUTH_USER_ROLES.customer
                            : AUTH_USER_ROLES.admin,
                        mfaGenerationId: "generation",
                      },
                    },
            },
          },
        ],
      }).compile();
      app = builder.createNestApplication();
      app.useLogger(false);
      await app.init();
      catalog = builder.get(LegalRuleCatalogService);
      const source = await db.legalSourceVersion.create({
        data: {
          version: `lcsp369-${tag}`,
          status: LegalSourceLifecycleStatus.ACTIVE,
          sourceManifest: {},
          integrityManifestRef: `integrity:${tag}`,
        },
      });
      sourceId = source.id;
      const content =
        "\n Synthetic provider-free fixture: the operator must retain a software event log. This is not an official legal source. \n";
      sourceRef = {
        documentId: "SYNTHETIC-LCSP369",
        locator: "art-1",
        contentSha256: `sha256:${hash(content)}`,
      };
      const document = await db.legalSourceDocument.create({
        data: {
          legalSourceVersionId: sourceId,
          documentId: "SYNTHETIC-LCSP369",
          title: "Synthetic preparation fixture",
          sourceUrl: "https://example.invalid/lcsp369",
          sourceSha256: hash(content),
          sourceEffectStatus: "IN_FORCE",
        },
      });
      await db.legalDocumentChunk.create({
        data: {
          id: `lcsp369-chunk-${tag}`,
          legalSourceVersionId: sourceId,
          legalSourceDocumentId: document.id,
          documentId: document.documentId,
          locator: "art-1",
          content,
          contentSha256: `sha256:${hash(content)}`,
          hierarchy: {},
          legalStatus: "ACTIVE",
          legalEffectStatus: LegalEffectStatus.EFFECTIVE,
        },
      });
      const index = await db.legalRetrievalIndex.create({
        data: {
          legalSourceVersionId: sourceId,
          version: `lcsp369-index-${tag}`,
          status: LegalRetrievalIndexStatus.VALID,
          contentHash: hash(content),
          configHash: hash("fixture-config"),
          validationManifestRef: `validation:${tag}`,
          validatedAt: new Date(),
        },
      });
      indexId = index.id;
      const created = await post("", {
        version: `catalog-${tag}`,
        legalSourceVersionId: sourceId,
      }).expect(201);
      catalogId = created.body.data.id;
      revision = created.body.data.revision;
      ruleIds = [];
      for (let index = 1; index <= 52; index++) {
        const saved = await post(`/${catalogId}/rules`, {
          legalRuleId: `LR${String(index).padStart(3, "0")}`,
          title: index <= 51 ? `Notice ${index}` : "Other scope",
          description:
            "Explicitly authored synthetic catalog rule for provider-free workflow verification.",
          citationLocatorRefs: [
            { documentId: document.documentId, locator: "art-1" },
          ],
          expectedRevision: revision,
        }).expect(200);
        revision = saved.body.data.catalogRevision;
        ruleIds.push(saved.body.data.rule.id);
      }
      // Simulate a pre-existing imported reference that no longer resolves, to prove it remains visible but unselectable.
      await db.legalRule.create({
        data: {
          catalogVersionId: catalogId,
          legalRuleId: "LRBAD",
          title: "Notice invalid citation",
          description: "Synthetic imported invalid reference",
          citationLocatorRefs: [
            { documentId: document.documentId, locator: "missing" },
          ],
          authoredBy: actor,
          updatedBy: actor,
        },
      });
    }, 60000);

    afterAll(async () => {
      if (sourceId)
        await db.legalSourceVersion.update({
          where: { id: sourceId },
          data: { status: LegalSourceLifecycleStatus.SUPERSEDED },
        });
      await app?.close();
      await db?.$disconnect();
    });

    it("does not author, select or dispatch anything on chunk/source activation", async () => {
      const before = await db.ruleSetPreparationRun.count({
        where: { legalSourceVersionId: sourceId },
      });
      const rulesBefore = await db.legalRule.count({
        where: { catalogVersionId: catalogId },
      });
      await new LegalSourceActivatedConsumer({} as RabbitMqClient).handle({
        legalSourceVersionId: sourceId,
      });
      expect(
        await db.ruleSetPreparationRun.count({
          where: { legalSourceVersionId: sourceId },
        }),
      ).toBe(before);
      expect(
        await db.legalRule.count({ where: { catalogVersionId: catalogId } }),
      ).toBe(rulesBefore);
    });

    it("protects catalog source pins in the existing deletion preview before any model work", async () => {
      const source = await db.legalSourceVersion.findUniqueOrThrow({
        where: { id: sourceId },
      });
      expect(source.legalSourceId).not.toBeNull();
      const deletion = new LegalSourceDeletionService(
        db,
        new AuditWriterService(db),
        new OutboxRepository(db),
      );
      const impact = await deletion.getImpact(
        source.legalSourceId!,
        randomUUID(),
      );
      expect(impact.eligibility.eligibleAtSnapshot).toBe(false);
      expect(impact.eligibility.blockers).toContain(
        LEGAL_SOURCE_DELETION_BLOCKERS.catalogReferenceExists,
      );
    });

    it("enforces Admin/session and worker authentication independently", async () => {
      await request(app.getHttpServer()).get(root).expect(401);
      await get("", "customer").expect(403);
      await post(
        "/selections",
        { catalogVersionId: catalogId },
        "invalid",
      ).expect(401);
      await request(app.getHttpServer())
        .post(`${workerRoot}/claim`)
        .send({ preparationRunId: randomUUID() })
        .expect(401);
    });

    it("pages/filter rules on the server and Select all spans both pages while excluding invalid citations", async () => {
      const first = await get(
        `/${catalogId}/rules?limit=50&page=1&search=Notice`,
      ).expect(200);
      const second = await get(
        `/${catalogId}/rules?limit=50&page=2&search=Notice`,
      ).expect(200);
      expect(first.body.data.items).toHaveLength(50);
      expect(second.body.data.items).toHaveLength(2);
      expect(first.body.data.total).toBe(52);
      expect(first.body.data.eligibleTotal).toBe(51);
      const all = await post("/selections", {
        catalogVersionId: catalogId,
        expectedRevision: revision,
        mode: M.ALL_MATCHING,
        filters: { search: "Notice" },
        ruleIds: [],
      }).expect(201);
      expect(all.body.data.selectedCount).toBe(51);
      expect(new Set(all.body.data.ruleIds)).toEqual(
        new Set(ruleIds.slice(0, 51)),
      );
      expect(
        await db.preparationRule.count({
          where: { legalRule: { catalogVersionId: catalogId } },
        }),
      ).toBe(0);
      const invalid = await get(
        `/${catalogId}/rules?state=${S.INELIGIBLE}`,
      ).expect(200);
      expect(
        invalid.body.data.items.map(
          (item: { legalRuleId: string }) => item.legalRuleId,
        ),
      ).toEqual(["LRBAD"]);
    });

    it("rejects empty, foreign, ineligible and stale catalog/source selections before dispatch", async () => {
      await select([]).expect(422);
      await select([randomUUID()]).expect(409);
      await select([ruleIds[0]], revision - 1).expect(409);
      const invalid = await db.legalRule.findUniqueOrThrow({
        where: {
          catalogVersionId_legalRuleId: {
            catalogVersionId: catalogId,
            legalRuleId: "LRBAD",
          },
        },
      });
      await select([invalid.id]).expect(409);
      const preview = (await select([ruleIds[0]]).expect(201)).body.data;
      await post(
        "/preparations",
        { selectionId: preview.selectionId, idempotencyKey: randomUUID() },
        "other-admin",
      ).expect(404);
      const index = await db.legalRetrievalIndex.findUniqueOrThrow({
        where: { id: indexId },
      });
      await db.legalRetrievalIndex.update({
        where: { id: indexId },
        data: { contentHash: hash("changed-index") },
      });
      await post("/preparations", {
        selectionId: preview.selectionId,
        idempotencyKey: randomUUID(),
      }).expect(409);
      await db.legalRetrievalIndex.update({
        where: { id: indexId },
        data: { contentHash: index.contentHash },
      });
      expect(
        await db.preparationRuleResult.count({
          where: { preparationRun: { legalSourceVersionId: sourceId } },
        }),
      ).toBe(0);
    });

    it("atomically persists exact IDs/pins and idempotently dispatches only two selected rules under concurrent duplicate submission", async () => {
      const preview = (await select(ruleIds.slice(0, 2)).expect(201)).body.data;
      const command = {
        selectionId: preview.selectionId,
        idempotencyKey: randomUUID(),
      };
      const responses = await Promise.all([
        post("/preparations", command),
        post("/preparations", command),
      ]);
      responses.forEach((response) => expect(response.status).toBe(202));
      expect(responses[0].body.data.id).toBe(responses[1].body.data.id);
      batch = responses[0].body.data;
      expect(batch.selected).toBe(2);
      expect(batch.items.map((item) => item.ruleId)).toEqual(
        ruleIds.slice(0, 2),
      );
      expect(
        await db.preparationRule.count({
          where: { legalRule: { catalogVersionId: catalogId } },
        }),
      ).toBe(2);
      expect(
        await db.outboxMessage.count({
          where: {
            aggregateId: sourceId,
            eventType: COMPLIANCE_RULE_SET_EVENT_TYPES.preparationRequested,
          },
        }),
      ).toBe(2);
      const other = (await select([ruleIds[2]]).expect(201)).body.data;
      await post("/preparations", {
        ...command,
        selectionId: other.selectionId,
      }).expect(409);
      await expect(
        db.preparationRuleSelection.update({
          where: { id: preview.selectionId },
          data: { inputs: [] },
        }),
      ).rejects.toThrow();
    });

    it("claims each item once and retains a successful result when the other item fails", async () => {
      for (const item of batch.items)
        await worker("/claim", {
          preparationRunId: item.preparationRunId,
        }).expect(200);
      await worker("/claim", {
        preparationRunId: batch.items[0].preparationRunId,
      }).expect(409);
      await worker("/instructions", {
        preparationRunId: batch.items[0].preparationRunId,
        receipt: receipt("instruction-v1"),
      }).expect(200);
      const success = {
        preparationRunId: batch.items[0].preparationRunId,
        executionState: A.SUCCEEDED,
        output: output(),
        failureCode: null,
      };
      const foreign = output();
      foreign.legalRequirements[0].operativePropositions![0].sourceRefs[0] = {
        ...sourceRef,
        locator: "foreign-locator",
      };
      await worker("/complete", { ...success, output: foreign }).expect(422);
      const weakened = output();
      weakened.assessmentRules[0].applicabilityGuidance =
        "Discard parent conditions";
      await worker("/complete", { ...success, output: weakened }).expect(422);
      const collision = output();
      collision.assessmentRules[0].assessmentRuleId = "UNRELATED:assessment-1";
      await worker("/complete", { ...success, output: collision }).expect(422);
      await worker("/complete", success).expect(200);
      await worker("/complete", success).expect(200);
      await worker("/complete", {
        ...success,
        output: output("conflicting replay"),
      }).expect(409);
      await worker("/complete", {
        preparationRunId: batch.items[1].preparationRunId,
        executionState: A.FAILED,
        output: null,
        failureCode: RULE_SET_PREPARATION_FAILURE_REASONS.RUNTIME_ERROR,
      }).expect(200);
      const detail = await get(`/preparations/${batch.id}`).expect(200);
      expect(detail.body.data).toMatchObject({
        prepared: 1,
        failed: 1,
        complete: true,
      });
      expect(detail.body.data.items[0].output.analysis).toBe(output().analysis);
      await expect(
        db.preparationRuleResult.update({
          where: { id: batch.items[0].resultId },
          data: { output: output("overwritten") },
        }),
      ).rejects.toThrow();
    });

    it("retries only failed items and replays the same retry request without another attempt", async () => {
      const command = { idempotencyKey: randomUUID() };
      const retried = await post(
        `/preparations/${batch.id}/retries`,
        command,
      ).expect(202);
      const replayed = await post(
        `/preparations/${batch.id}/retries`,
        command,
      ).expect(202);
      expect(replayed.body.data.id).toBe(retried.body.data.id);
      expect(retried.body.data.items[0]).toMatchObject({
        resultId: batch.items[0].resultId,
        skipped: true,
      });
      expect(retried.body.data.items[1].revision).toBe(2);
      expect(
        await db.ruleSetPreparationRun.count({
          where: { legalSourceVersionId: sourceId },
        }),
      ).toBe(3);
    });

    it("rejects a catalog edit race and exposes stale prepared inputs", async () => {
      const preview = (await select([ruleIds[2]]).expect(201)).body.data;
      const saved = await post(`/${catalogId}/rules`, {
        legalRuleId: "LR001",
        title: "Changed selected rule title",
        description:
          "Explicit development update; previous results must retain their old input.",
        citationLocatorRefs: [
          { documentId: "SYNTHETIC-LCSP369", locator: "art-1" },
        ],
        expectedRevision: revision,
      }).expect(200);
      revision = saved.body.data.catalogRevision;
      await post("/preparations", {
        selectionId: preview.selectionId,
        idempotencyKey: randomUUID(),
      }).expect(409);
      const stale = await get(`/${catalogId}/rules?state=${S.STALE}`).expect(
        200,
      );
      expect(
        stale.body.data.items.some(
          (item: { id: string }) => item.id === ruleIds[0],
        ),
      ).toBe(true);
    });

    it("regenerates exactly one rule with a new instruction fingerprint while preserving default input pins and both result revisions", async () => {
      const before = (await get(`/rules/${ruleIds[0]}/results`).expect(200))
        .body.data;
      const command = {
        idempotencyKey: randomUUID(),
        expectedResultId: before.latestResultId,
        useLatestInputs: false,
      };
      const [first, duplicate] = await Promise.all([
        post(`/rules/${ruleIds[0]}/regenerate`, command),
        post(`/rules/${ruleIds[0]}/regenerate`, command),
      ]);
      expect(first.status).toBe(202);
      expect(duplicate.status).toBe(202);
      expect(first.body.data.id).toBe(duplicate.body.data.id);
      expect(first.body.data.selected).toBe(1);
      expect(first.body.data.scope.ruleIds).toEqual([ruleIds[0]]);
      const item = first.body.data.items[0];
      const claim = await worker("/claim", {
        preparationRunId: item.preparationRunId,
      }).expect(200);
      expect(claim.body.data.input.citations[0].content.startsWith("\n ")).toBe(
        true,
      );
      expect(claim.body.data.inputFingerprint).toBe(
        before.results[0].inputFingerprint,
      );
      expect(claim.body.data.input.title).not.toBe(
        "Changed selected rule title",
      );
      await worker("/instructions", {
        preparationRunId: item.preparationRunId,
        receipt: receipt("instruction-v2"),
      }).expect(200);
      await worker("/complete", {
        preparationRunId: item.preparationRunId,
        executionState: A.SUCCEEDED,
        output: output("New instruction result"),
        failureCode: null,
      }).expect(200);
      const after = (await get(`/rules/${ruleIds[0]}/results`).expect(200)).body
        .data;
      expect(after.results).toHaveLength(2);
      expect(after.currentResultId).toBe(item.resultId);
      expect(after.results[0].instructionReceipt.fingerprint).not.toBe(
        after.results[1].instructionReceipt.fingerprint,
      );
      expect(after.results[0].input).toEqual(after.results[1].input);
      expect(after.results[1].output).toEqual(before.results[0].output);
      const older = (
        await get(`/rules/${ruleIds[0]}/results?beforeRevision=2`).expect(200)
      ).body.data;
      expect(
        older.results.map((row: { revision: number }) => row.revision),
      ).toEqual([1]);
      expect(older.currentResultId).toBe(item.resultId);
      expect(
        await db.ruleSetPreparationRun.count({
          where: { legalSourceVersionId: sourceId },
        }),
      ).toBe(4);
      expect(
        await db.complianceRuleSetVersion.count({
          where: { legalSourceVersionId: sourceId },
        }),
      ).toBe(0);
    });

    it("changes pinned inputs only on an explicit latest-input regeneration choice", async () => {
      const history = (await get(`/rules/${ruleIds[0]}/results`).expect(200))
        .body.data;
      const next = await post(`/rules/${ruleIds[0]}/regenerate`, {
        idempotencyKey: randomUUID(),
        expectedResultId: history.latestResultId,
        useLatestInputs: true,
      }).expect(202);
      const runId = next.body.data.items[0].preparationRunId;
      const claim = await worker("/claim", { preparationRunId: runId }).expect(
        200,
      );
      expect(claim.body.data.input.catalogRevision).toBe(revision);
      expect(claim.body.data.input.title).toBe("Changed selected rule title");
      expect(claim.body.data.inputFingerprint).not.toBe(
        history.results[0].inputFingerprint,
      );
      await worker("/complete", {
        preparationRunId: runId,
        executionState: A.INTERRUPTED,
        output: null,
        failureCode: RULE_SET_PREPARATION_FAILURE_REASONS.RUNTIME_ERROR,
      }).expect(200);
      const audits = await db.auditEvent.count({
        where: {
          actorId: actor,
          eventType: { startsWith: "event.legal-rule-catalog." },
        },
      });
      expect(audits).toBeGreaterThan(52);
    });
    it("refuses invalidated pinned sources at claim without model work or instruction receipts", async () => {
      const preview = (await select([ruleIds[2]]).expect(201)).body.data;
      const queued = (
        await post("/preparations", {
          selectionId: preview.selectionId,
          idempotencyKey: randomUUID(),
        }).expect(202)
      ).body.data;
      await db.legalRetrievalIndex.update({
        where: { id: indexId },
        data: { status: LegalRetrievalIndexStatus.INVALID },
      });
      const refused = await worker("/claim", {
        preparationRunId: queued.items[0].preparationRunId,
      }).expect(200);
      expect(refused.body.data.refused).toBe(true);
      expect(
        (await get(`/preparations/${queued.id}`).expect(200)).body.data,
      ).toMatchObject({ failed: 1, prepared: 0 });
      const result = await db.preparationRuleResult.findUniqueOrThrow({
        where: { id: queued.items[0].resultId },
      });
      expect(result.instructionReceipt).toBeNull();
      expect(result.output).toBeNull();
      await db.legalRetrievalIndex.update({
        where: { id: indexId },
        data: { status: LegalRetrievalIndexStatus.VALID },
      });
    });

    it("dispatches the exact filtered selection and leaves excluded rules without artifacts", async () => {
      const pending = await db.preparationRuleResult.findFirstOrThrow({
        where: {
          preparationRule: { legalRuleId: ruleIds[1] },
          preparationRun: { executionState: A.QUEUED },
        },
      });
      await worker("/claim", {
        preparationRunId: pending.preparationRunId,
      }).expect(200);
      await worker("/complete", {
        preparationRunId: pending.preparationRunId,
        executionState: A.FAILED,
        output: null,
        failureCode: RULE_SET_PREPARATION_FAILURE_REASONS.RUNTIME_ERROR,
      }).expect(200);
      const preview = (
        await post("/selections", {
          catalogVersionId: catalogId,
          expectedRevision: revision,
          mode: M.ALL_MATCHING,
          filters: { search: "Notice" },
          ruleIds: [],
        }).expect(201)
      ).body.data;
      const result = (
        await post("/preparations", {
          selectionId: preview.selectionId,
          idempotencyKey: randomUUID(),
        }).expect(202)
      ).body.data;
      expect(result.selected).toBe(preview.selectedCount);
      expect(
        new Set(result.items.map((item: { ruleId: string }) => item.ruleId)),
      ).toEqual(new Set(preview.ruleIds));
      expect(
        await db.preparationRule.count({ where: { legalRuleId: ruleIds[51] } }),
      ).toBe(0);
      expect(
        await db.preparationRule.count({
          where: {
            legalRule: { legalRuleId: "LRBAD", catalogVersionId: catalogId },
          },
        }),
      ).toBe(0);
    });
    it("preserves active chunk immutability and refuses a mismatched pinned locator before work", async () => {
      const result = await db.preparationRuleResult.findFirstOrThrow({
        where: {
          preparationRule: { legalRuleId: ruleIds[40] },
          preparationRun: { executionState: A.QUEUED },
        },
      });
      const chunk = await db.legalDocumentChunk.findFirstOrThrow({
        where: { legalSourceVersionId: sourceId },
      });
      await expect(
        db.legalDocumentChunk.update({
          where: { id: chunk.id },
          data: { locator: "moved-locator" },
        }),
      ).rejects.toThrow();
      const input = preparationRuleInputSchema.parse(result.inputSnapshot);
      input.citations[0].locator = "mismatched-locator";
      await expect(
        catalog.hydrate(db, [input], randomUUID()),
      ).rejects.toThrow();
      expect(
        (
          await db.preparationRuleResult.findUniqueOrThrow({
            where: { id: result.id },
          })
        ).instructionReceipt,
      ).toBeNull();
    });
  },
);
