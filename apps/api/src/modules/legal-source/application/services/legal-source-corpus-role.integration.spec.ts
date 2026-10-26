import { sha256Ref } from "./legal-source-structure.js";
import request from "supertest";
import { Test } from "@nestjs/testing";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { RbacContextLoader } from "../../../../platform/rbac/rbac-context.loader.js";
import { AUTHORIZATION_DECISION_REPOSITORY } from "../../../../platform/rbac/authorization-decision.repository.js";
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import type { Server } from "node:http";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import { LegalSourceDocumentService } from "./legal-source-document.service.js";
import { LegalSourceManagementService } from "./legal-source-management.service.js";
import { LegalSourceService } from "./legal-source.service.js";
import { LegalDocumentGraphService } from "./legal-document-graph.service.js";
import {
  NodeSafeFetchTransport,
  SafeUrlFetcherService,
} from "./safe-url-fetcher.service.js";
import { LegalSourceAdminController } from "../../presentation/http/legal-source-admin.controller.js";
import { RBAC_METADATA_KEY } from "../../../../platform/rbac/decorators/rbac-metadata.js";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES as Roles,
  LEGAL_SOURCE_MANAGEMENT_ERROR_CODES as Errors,
  LEGAL_SOURCE_EVENT_TYPES as Events,
  updateLegalSourceDocumentCorpusRoleSchema,
  legalSourceDocumentViewSchema,
} from "@lcsp/contracts/legal-source";
import {
  LegalSourceDocumentCorpusRole,
  LegalSourceLifecycleStatus,
} from "@prisma/client";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://unused/unused");
const database =
  url.hostname === "127.0.0.1" &&
  /^554(?:7[2-9]|8\d)$/u.test(url.port) &&
  url.pathname === "/lcsp_review_frontier_test"
    ? describe
    : describe.skip;
const actorId = "00000000-0000-4000-8000-000000000001";

database("reference-only document mutation on disposable PostgreSQL", () => {
  let prisma: PrismaService,
    documents: LegalSourceDocumentService,
    management: LegalSourceManagementService;
  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const outbox = new OutboxRepository(prisma),
      audit = new AuditWriterService(prisma);
    documents = new LegalSourceDocumentService(
      prisma,
      outbox,
      audit,
      new SafeUrlFetcherService(new NodeSafeFetchTransport()),
    );
    management = new LegalSourceManagementService(
      prisma,
      audit,
      documents,
      new LegalSourceService(prisma, outbox, audit),
    );
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  async function seed() {
    const source = await management.createSource({
      actorId,
      correlationId: randomUUID(),
      request: { name: `corpus-${randomUUID()}` },
    });
    const version = await management.createVersion({
      sourceId: source.id,
      actorId,
      correlationId: randomUUID(),
      request: {},
    });
    const document = await prisma.legalSourceDocument.create({
      data: {
        legalSourceVersionId: version.id,
        documentId: "law-b",
        title: "B",
        sourceUrl: "https://example.invalid/b",
        sourceSha256: "b".repeat(64),
        sourceEffectStatus: "EFFECTIVE",
      },
    });
    return { source, version, document };
  }
  const set = (
    versionId: string,
    documentRowId: string,
    correlationId = randomUUID(),
  ) =>
    documents.updateCorpusRole({
      versionId,
      documentRowId,
      actorId,
      correlationId,
      request: { corpusRole: Roles.REFERENCE_ONLY },
    });

  it("sets a DRAFT via the controller envelope, exposes the role and audits once, idempotently", async () => {
    const { version, document } = await seed();
    expect(document.corpusRole).toBe(LegalSourceDocumentCorpusRole.OPERATIVE);
    const correlationId = randomUUID();
    const controller = new LegalSourceAdminController(management, documents);
    const req = {
      rbacContext: { userId: actorId },
      correlationId,
    } as AuthenticatedRequest;
    const result = await controller.updateDocumentCorpusRole(
      version.id,
      document.id,
      { corpusRole: Roles.REFERENCE_ONLY },
      req,
    );
    expect(result).toMatchObject({
      ok: true,
      data: { corpusRole: Roles.REFERENCE_ONLY },
    });
    expect(legalSourceDocumentViewSchema.parse(result.data).corpusRole).toBe(
      Roles.REFERENCE_ONLY,
    );
    await set(version.id, document.id, correlationId);
    expect(
      await prisma.auditEvent.count({
        where: { correlationId, eventType: Events.documentCorpusRoleUpdated },
      }),
    ).toBe(1);
    expect(
      (await management.getVersion(version.id, correlationId)).documents[0]
        .corpusRole,
    ).toBe(Roles.REFERENCE_ONLY);
  });

  it.each([
    LegalSourceLifecycleStatus.ACTIVE,
    LegalSourceLifecycleStatus.SUPERSEDED,
  ])(
    "refuses %s in service and existing database immutability guard",
    async (status) => {
      const { version, document } = await seed();
      await prisma.legalSourceVersion.update({
        where: { id: version.id },
        data: { status },
      });
      await expect(set(version.id, document.id)).rejects.toMatchObject({
        response: {
          ok: false,
          problem: { status: 409, code: Errors.versionImmutable },
        },
      });
      await expect(
        prisma.legalSourceDocument.update({
          where: { id: document.id },
          data: { corpusRole: LegalSourceDocumentCorpusRole.REFERENCE_ONLY },
        }),
      ).rejects.toThrow(/IMMUTABLE/u);
    },
  );

  it("refuses a DRAFT already pinned by preparation", async () => {
    const { version, document } = await seed();
    await prisma.ruleSetPreparationRun.create({
      data: {
        legalSourceVersionId: version.id,
        idempotencyKey: randomUUID(),
        requestedBy: actorId,
        correlationId: randomUUID(),
      },
    });
    await expect(set(version.id, document.id)).rejects.toMatchObject({
      response: { problem: { code: Errors.versionInUse } },
    });
  });

  it("serves PATCH with real RBAC, validation and success/problem envelopes", async () => {
    const { version, document } = await seed();
    const module = await Test.createTestingModule({
      controllers: [LegalSourceAdminController],
      providers: [
        { provide: LegalSourceManagementService, useValue: management },
        { provide: LegalSourceDocumentService, useValue: documents },
        RbacGuard,
        {
          provide: RbacContextLoader,
          useValue: {
            load: (token: string) =>
              Promise.resolve({
                ok: true,
                session: { id: randomUUID(), userId: actorId },
                user: {
                  role:
                    token === "admin"
                      ? AUTH_USER_ROLES.admin
                      : AUTH_USER_ROLES.customer,
                },
              }),
          },
        },
        {
          provide: AUTHORIZATION_DECISION_REPOSITORY,
          useValue: { append: () => Promise.resolve(undefined) },
        },
      ],
    }).compile();
    const app = module.createNestApplication<INestApplication<Server>>();
    await app.init();
    try {
      const path = `/admin/legal-source-versions/${version.id}/documents/${document.id}/corpus-role`;
      await request(app.getHttpServer())
        .patch(path)
        .send({ corpusRole: Roles.REFERENCE_ONLY })
        .expect(401);
      await request(app.getHttpServer())
        .patch(path)
        .auth("customer", { type: "bearer" })
        .send({ corpusRole: Roles.REFERENCE_ONLY })
        .expect(403);
      const invalid = await request(app.getHttpServer())
        .patch(path)
        .auth("admin", { type: "bearer" })
        .send({ corpusRole: "reference_only" })
        .expect(422);
      expect(invalid.body).toMatchObject({
        ok: false,
        problem: { status: 422 },
      });
      const success = await request(app.getHttpServer())
        .patch(path)
        .auth("admin", { type: "bearer" })
        .send({ corpusRole: Roles.REFERENCE_ONLY })
        .expect(200);
      expect(success.body).toMatchObject({
        ok: true,
        data: { corpusRole: Roles.REFERENCE_ONLY },
      });
      await prisma.legalSourceVersion.update({
        where: { id: version.id },
        data: { status: LegalSourceLifecycleStatus.ACTIVE },
      });
      const frozen = await request(app.getHttpServer())
        .patch(path)
        .auth("admin", { type: "bearer" })
        .send({ corpusRole: Roles.OPERATIVE })
        .expect(409);
      expect(frozen.body).toMatchObject({
        ok: false,
        problem: { status: 409, code: Errors.versionImmutable },
      });
    } finally {
      await app.close();
    }
  });

  it("copies the role into a new version, retaining all document content", async () => {
    const { source, version, document } = await seed();
    const content = "Retained reference provision";
    await prisma.legalDocumentChunk.create({
      data: {
        id: randomUUID(),
        legalSourceVersionId: version.id,
        legalSourceDocumentId: document.id,
        documentId: document.documentId,
        locator: "art-1",
        content,
        contentSha256: sha256Ref(content),
        hierarchy: {},
        legalStatus: "EFFECTIVE",
      },
    });
    await set(version.id, document.id);
    await prisma.legalSourceVersion.update({
      where: { id: version.id },
      data: { status: LegalSourceLifecycleStatus.SUPERSEDED },
    });
    const copy = await management.createVersion({
      sourceId: source.id,
      actorId,
      correlationId: randomUUID(),
      request: { basedOnVersionId: version.id },
    });
    expect(copy.documents).toHaveLength(1);
    expect(copy.documents[0]).toMatchObject({
      documentId: document.documentId,
      corpusRole: Roles.REFERENCE_ONLY,
    });
    expect(
      await prisma.legalDocumentChunk.findMany({
        where: { legalSourceVersionId: copy.id },
        select: { content: true },
      }),
    ).toEqual([{ content }]);
  });

  it("binds the role to materialization identity and exports only database-owned roles", async () => {
    const { version, document } = await seed();
    const graphs = new LegalDocumentGraphService(prisma);
    const before = await graphs.materialize(version.id);
    await set(version.id, document.id);
    const after = await graphs.materialize(version.id);
    expect(after.materializationId).not.toBe(before.materializationId);
    expect(after.referenceOnlyDocumentIds).toEqual([document.documentId]);
    expect((await graphs.export(version.id))?.referenceOnlyDocumentIds).toEqual(
      [document.documentId],
    );
  });

  it("runs the operational script twice on a DRAFT and refuses ACTIVE", async () => {
    const { version, document } = await seed();
    const run = () =>
      spawnSync(
        "pnpm",
        [
          "exec",
          "tsx",
          "scripts/phase1-set-corpus-role.ts",
          version.id,
          document.documentId,
        ],
        { encoding: "utf8", env: process.env },
      );
    const first = run();
    expect(first.status).toBe(0);
    expect(first.stdout).toContain(
      '"before":"OPERATIVE","after":"REFERENCE_ONLY"',
    );
    const second = run();
    expect(second.status).toBe(0);
    expect(second.stdout).toContain(
      '"before":"REFERENCE_ONLY","after":"REFERENCE_ONLY"',
    );
    await prisma.legalSourceVersion.update({
      where: { id: version.id },
      data: { status: LegalSourceLifecycleStatus.ACTIVE },
    });
    const active = run();
    expect(active.status).not.toBe(0);
    expect(active.stderr).toContain("Only DRAFT versions");
  });
});

describe("corpus-role API contract", () => {
  it("retains the effect endpoint's admin policy, PATCH route and allowlist", () => {
    expect(
      Reflect.getMetadata(RBAC_METADATA_KEY, LegalSourceAdminController),
    ).toEqual({ type: "roles", roles: [AUTH_USER_ROLES.admin] });
    // Reflect inspects the method without invoking it or detaching application behavior.
    const method =
      LegalSourceAdminController.prototype.updateDocumentCorpusRole; // eslint-disable-line @typescript-eslint/unbound-method
    expect(Reflect.getMetadata("path", method)).toBe(
      "legal-source-versions/:versionId/documents/:documentRowId/corpus-role",
    );
    const routes: unknown = JSON.parse(
      readFileSync(
        new URL("../../../../app.routes.allowlist.json", import.meta.url),
        "utf8",
      ),
    );
    expect(routes).toContain(
      "PATCH /admin/legal-source-versions/:versionId/documents/:documentRowId/corpus-role",
    );
  });
  it("accepts only the two canonical role values", () => {
    expect(Object.values(Roles)).toEqual(["OPERATIVE", "REFERENCE_ONLY"]);
    for (const corpusRole of Object.values(Roles))
      expect(
        updateLegalSourceDocumentCorpusRoleSchema.parse({ corpusRole }),
      ).toEqual({ corpusRole });
    for (const corpusRole of ["reference_only", "operative", "", null])
      expect(
        updateLegalSourceDocumentCorpusRoleSchema.safeParse({ corpusRole })
          .success,
      ).toBe(false);
    expect(
      updateLegalSourceDocumentCorpusRoleSchema.safeParse({
        corpusRole: Roles.REFERENCE_ONLY,
        referenceOnlyDocumentIds: ["injected"],
      }).success,
    ).toBe(false);
  });
});
