import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { AppModule } from "../src/app.module.js";
import { createAuthSessionRecord } from "./support/auth-record-test-helpers.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, successBody } from "./support/http.js";

describe("Legal Source hard deletion HTTP API (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;
  let adminId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    pushPrismaSchema();
    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await resetAuthWorkspaceDatabase(prisma);
    adminId = randomUUID();
    const admin = await prisma.user.create({
      data: {
        id: adminId,
        email: `legal-source-delete-${randomUUID()}@example.test`,
        displayName: "Legal Source deletion Admin",
        emailVerified: true,
        passwordHash: "test-hash-not-used-for-authentication",
        failedLoginCount: 0,
        role: AUTH_USER_ROLES.admin,
      },
    });
    adminToken = `legal-source-delete-session-${randomUUID()}`;
    await createAuthSessionRecord(prisma, {
      id: randomUUID(),
      userId: admin.id,
      token: adminToken,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
  });

  it("deletes a source through authenticated HTTP and retains its receipt", async () => {
    const source = await prisma.legalSource.create({
      data: {
        slug: `http-delete-${randomUUID()}`,
        name: "HTTP deletion source",
      },
    });
    const impactResponse = await httpRequest(app)
      .get(`/admin/legal-sources/${source.id}/deletion-impact`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(impactResponse.status).toBe(200);
    const impact = successBody<{
      source: { slug: string };
      snapshot: { etag: string };
      eligibility: { eligibleAtSnapshot: boolean };
    }>(impactResponse);
    expect(impact.eligibility.eligibleAtSnapshot).toBe(true);

    const deletionResponse = await httpRequest(app)
      .delete(`/admin/legal-sources/${source.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        expectedImpactEtag: impact.snapshot.etag,
        confirmationSlug: impact.source.slug,
        reason: { code: "OTHER", text: "Disposable HTTP integration test" },
        idempotencyKey: randomUUID(),
      });
    expect(deletionResponse.status).toBe(200);
    const result = successBody<{
      sourceId: string;
      deletionReceiptId: string;
      retainedAuditEvidence: true;
    }>(deletionResponse);
    expect(result.sourceId).toBe(source.id);
    expect(result.retainedAuditEvidence).toBe(true);
    expect(await prisma.legalSource.count({ where: { id: source.id } })).toBe(
      0,
    );
    expect(
      await prisma.legalSourceDeletionReceipt.count({
        where: { id: result.deletionReceiptId, actorId: adminId },
      }),
    ).toBe(1);
  });
});
