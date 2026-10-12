import {
  ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
  AGENT_EXECUTION_STATES,
} from "@lcsp/contracts/assessment";
import type { AssessmentDetail } from "@lcsp/contracts/assessment-domain";
/**
 * AC-001: RBAC-authorized assessment creation, audit event.
 * AC-003: Persisted canonical lifecycle; retired readiness route is absent.
 */

import * as assert from "node:assert/strict";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { jest } from "@jest/globals";
import { httpRequest, successBody } from "./support/http.js";

import { AppModule } from "../src/app.module.js";
import {
  ASSESSMENT_RUNTIME_ERASURE,
  type AssessmentRuntimeErasurePort,
} from "../src/modules/assessment/application/ports/assessment-runtime-erasure.port.js";
import type { CreateAssessmentDto } from "../src/modules/assessment/application/contracts/assessment/create-assessment.contract.js";
import type { SignInSuccess } from "../src/modules/auth/application/contracts/auth/sign-in.contract.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";

describe("Assessment ownership, canonical lifecycle and deletion (e2e) [AC-001, AC-003]", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let managerToken: string;
  const orgId = "org-1";
  // Native checkpoint/sandbox erasure is verified separately by the RELEASE deletion vertical.
  const erase = jest.fn<AssessmentRuntimeErasurePort["erase"]>();

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    pushPrismaSchema();

    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ASSESSMENT_RUNTIME_ERASURE)
      .useValue({ erase })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);
    erase.mockReset().mockImplementation(async (input) => {
      const assessment = await prisma.assessment.findUniqueOrThrow({
        where: { id: input.assessmentId },
        select: {
          ownerId: true,
          lifecycleState: true,
          runtime: {
            select: {
              threadId: true,
              executionState: true,
              leaseToken: true,
              leaseExpiresAt: true,
            },
          },
        },
      });
      assert.equal(assessment.ownerId, input.ownerId);
      assert.equal(
        assessment.lifecycleState,
        ASSESSMENT_LIFECYCLE_STATES.CANCELLED,
      );
      assert.ok(assessment.runtime);
      assert.equal(assessment.runtime.threadId, input.threadId);
      assert.equal(
        assessment.runtime.executionState,
        AGENT_EXECUTION_STATES.CANCELLED,
      );
      assert.equal(assessment.runtime.leaseToken, null);
      assert.equal(assessment.runtime.leaseExpiresAt, null);
    });

    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "manager@acme.test",
      password: "CorrectHorseBatteryStaple!",
      organization_id: orgId,
    });
    managerToken = successBody<SignInSuccess>(signIn).session_token ?? "";
    assert.ok(managerToken, "Fixture authentication must succeed");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // AC-001: Assessment creation
  it("AC-001: Manager can create an assessment and receives assessment ID", async () => {
    const result = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ name: "My AI System Assessment" });
    const body = successBody<CreateAssessmentDto>(result);

    assert.equal(result.status, 201);
    assert.ok(body.assessment_id, "Response must include assessment ID");
    assert.equal(
      body.owner_id,
      "user-1",
      "Assessment owner must be the creating Manager",
    );
    assert.equal(body.lifecycle?.state, ASSESSMENT_LIFECYCLE_STATES.PREPARING);
  });

  it("AC-001: Assessment creation writes ASSESSMENT_CREATED audit event", async () => {
    await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ name: "Audit Test Assessment" });

    const audit = await prisma.auditEvent.findFirst({
      where: { eventType: ASSESSMENT_EVENT_TYPES.created },
    });
    assert.ok(audit, "ASSESSMENT_CREATED audit event must be written");
    assert.doesNotMatch(JSON.stringify(audit), /password|token|secret/i);
  });

  it("AC-001: Unauthenticated request to create assessment returns 401", async () => {
    const result = await httpRequest(app)
      .post("/assessments")
      .send({ name: "No Auth Assessment" });
    assert.equal(result.status, 401);
  });

  it("renames an owned assessment and records an audit event", async () => {
    const create = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ name: "Before rename" });
    const assessmentId = successBody<CreateAssessmentDto>(create).assessment_id;

    const result = await httpRequest(app)
      .patch(`/assessments/${assessmentId}`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ name: "Renamed assessment" });
    const body = successBody<{ assessment_id: string; name: string }>(result);

    assert.equal(result.status, 200);
    assert.equal(body.name, "Renamed assessment");
    assert.equal(
      (await prisma.assessment.findUnique({ where: { id: assessmentId } }))
        ?.name,
      "Renamed assessment",
    );
    assert.ok(
      await prisma.auditEvent.findFirst({
        where: {
          eventType: ASSESSMENT_EVENT_TYPES.renamed,
          resourceId: assessmentId,
        },
      }),
    );
  });

  it("deletes an owned assessment and records an audit event", async () => {
    const create = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ name: "Delete me" });
    const assessmentId = successBody<CreateAssessmentDto>(create).assessment_id;

    const runtime = await prisma.assessmentRuntime.findUniqueOrThrow({
      where: { assessmentId },
      select: { threadId: true },
    });
    const result = await httpRequest(app)
      .delete(`/assessments/${assessmentId}`)
      .set("Authorization", `Bearer ${managerToken}`);
    const body = successBody<{ assessment_id: string; deleted: boolean }>(
      result,
    );

    assert.equal(result.status, 200);
    assert.equal(body.deleted, true);
    expect(erase).toHaveBeenCalledTimes(1);
    expect(erase).toHaveBeenCalledWith({
      assessmentId,
      ownerId: "user-1",
      threadId: runtime.threadId,
    });
    assert.equal(
      await prisma.assessment.findUnique({ where: { id: assessmentId } }),
      null,
    );
    assert.ok(
      await prisma.auditEvent.findFirst({
        where: {
          eventType: ASSESSMENT_EVENT_TYPES.deleted,
          resourceId: assessmentId,
        },
      }),
    );
    const afterDelete = await httpRequest(app)
      .get(`/assessments/${assessmentId}`)
      .set("Authorization", `Bearer ${managerToken}`);
    assert.equal(afterDelete.status, 404);
  });

  // AC-003 (BROWSER): readiness/classification are retired; lifecycle is canonical only
  it("AC-003: retired readiness route is gone and canonical detail exposes no readiness/classification", async () => {
    const create = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ name: "No Readiness" });

    const assessmentId = successBody<CreateAssessmentDto>(create).assessment_id;
    assert.ok(assessmentId);

    const readiness = await httpRequest(app)
      .get(`/assessments/${assessmentId}/readiness`)
      .set("Authorization", `Bearer ${managerToken}`);
    assert.equal(readiness.status, 404);

    const detail = await httpRequest(app)
      .get(`/assessments/${assessmentId}`)
      .set("Authorization", `Bearer ${managerToken}`);
    const body = successBody<AssessmentDetail>(detail);
    assert.equal(body.lifecycle?.state, ASSESSMENT_LIFECYCLE_STATES.PREPARING);
    assert.ok(!("readiness_state" in body));
    assert.ok(!("classification_result" in body));
  });
});
