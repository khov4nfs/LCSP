import * as assert from "node:assert/strict";

import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";
import {
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
} from "@lcsp/contracts/github-integration";
import { Test, type TestingModule } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { AppModule } from "../src/app.module.js";
import type { SignInSuccess } from "../src/modules/auth-workspace/application/contracts/auth-workspace/sign-in.contract.js";
import { httpRequest, successBody } from "./support/http.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  seedRepositorySnapshotGraph,
} from "./support/auth-workspace-test-helpers.js";

describe("Program Evidence Graph ownership (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let customerToken: string;
  let adminToken: string;

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

  beforeEach(async () => {
    await prisma.technicalEvidenceReport.deleteMany();
    await prisma.repositoryScanJob.deleteMany();
    await prisma.repositorySnapshot.deleteMany();
    await prisma.repositoryConnection.deleteMany();
    await prisma.assessment.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);
    customerToken = await signIn(
      "manager@acme.test",
      "CorrectHorseBatteryStaple!",
    );
    adminToken = await signIn("nomembership@acme.test", "NoMembership123!");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("allows the owner, denies another customer, and preserves admin access", async () => {
    await createAcceptedEvidence("assessment-owned", "user-1");
    await createAcceptedEvidence("assessment-other", "user-2");

    const own = await request("assessment-owned", customerToken);
    assert.equal(own.status, 200);

    const other = await request("assessment-other", customerToken);
    assert.equal(other.status, 404);

    const admin = await request("assessment-other", adminToken);
    assert.equal(admin.status, 200);
  });

  async function signIn(email: string, password: string): Promise<string> {
    const result = await httpRequest(app)
      .post("/auth/sign-in")
      .send({ email, password, organization_id: "org-1" });
    return successBody<SignInSuccess>(result).session_token ?? "";
  }

  async function createAcceptedEvidence(
    assessmentId: string,
    userId: string,
  ): Promise<void> {
    await seedRepositorySnapshotGraph(prisma, {
      assessmentId,
      userId,
      connectionId: `connection-${assessmentId}`,
      snapshotId: `snapshot-${assessmentId}`,
    });
    await prisma.repositoryScanJob.create({
      data: {
        id: `scan-${assessmentId}`,
        assessmentId,
        snapshotId: `snapshot-${assessmentId}`,
        idempotencyKey: `key-${assessmentId}`,
        correlationId: `corr-${assessmentId}`,
        triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.trusted,
        status: REPOSITORY_SCAN_JOB_STATUSES.completed,
      },
    });
    await prisma.technicalEvidenceReport.create({
      data: {
        id: `report-${assessmentId}`,
        assessmentId,
        scanJobId: `scan-${assessmentId}`,
        snapshotId: `snapshot-${assessmentId}`,
        toolsVersion: { scanner: "1" },
        configHash: { scanner: "hash" },
        evidencePayload: {},
        privacyFlags: { containsSourceCode: false, secretsRedacted: true },
        schemaVersion: "1.0.0",
        status: TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
      },
    });
  }

  function request(assessmentId: string, token: string) {
    return httpRequest(app)
      .get(`/assessments/${assessmentId}/evidence-graph`)
      .set("Authorization", `Bearer ${token}`);
  }
});
