/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import * as assert from "node:assert/strict";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { httpRequest, problemCode, successBody } from "./support/http.js";

import { AppModule } from "../src/app.module.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";

import {
  PBAC_ACTIONS,
  PBAC_STATE_GATES,
  SUBJECT_ROLES,
} from "@lcsp/contracts/pbac";
import { AUTH_MEMBERSHIP_STATUSES } from "@lcsp/contracts/auth";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_LOCK_REASONS,
  ASSESSMENT_STATUS_CODES,
  WIZARD_STATUS_CODES,
} from "@lcsp/contracts/assessment";
import { WIZARD_ERROR_CODES, WIZARD_EVENT_TYPES } from "@lcsp/contracts/wizard";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";
import {
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SNAPSHOT_STATUSES,
} from "@lcsp/contracts/github-integration";

import {
  OUTBOX_AGGREGATE_TYPES,
  OUTBOX_MESSAGE_SCHEMA_VERSION,
  OUTBOX_STATUSES,
} from "@lcsp/contracts/outbox";

describe("Wizard Endpoints (e2e) [MW-wiz-001, MW-wiz-002, MW-wiz-003]", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let managerToken: string;
  let restrictedToken: string;
  const orgId = "org-1";

  // Example Assessment ID to be created in each block
  let assessmentId: string;

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
    // Clear wizard profile and outbox messages explicitly, though resetAuthWorkspaceDatabase might clear some
    await prisma.wizardProfile.deleteMany();
    await prisma.technicalEvidenceReport.deleteMany();
    await prisma.repositorySnapshot.deleteMany();
    await prisma.repositoryConnection.deleteMany();
    await prisma.assessment.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);

    // Sign in as Manager
    const signInManager = await httpRequest(app).post("/auth/sign-in").send({
      email: "manager@acme.test",
      password: "CorrectHorseBatteryStaple!",
      organization_id: orgId,
    });
    managerToken =
      successBody<{ session_token?: string }>(signInManager).session_token ??
      "";

    // Setup Restricted User
    const restrictedPolicyId = "policy-no-wizard-access";
    await prisma.authPolicy.create({
      data: {
        id: restrictedPolicyId,
        version: "2026-07-10",
        actions: [PBAC_ACTIONS.workspaceRead], // Only workspace read
        subjectRole: SUBJECT_ROLES.manager,
        stateGate: PBAC_STATE_GATES.membershipActive,
        organizationId: orgId,
      },
    });
    const restrictedUserId = "user-no-wizard-access";
    await prisma.authUser.create({
      data: {
        id: restrictedUserId,
        email: "restricted@acme.test",
        passwordHash: (
          await import("../src/modules/auth-workspace/infrastructure/security/security.utils.js")
        ).hashSecret("CorrectHorseBatteryStaple!"),
        emailVerified: true,
        failedLoginCount: 0,
      },
    });
    await prisma.authMembership.create({
      data: {
        id: "membership-no-wizard-access",
        userId: restrictedUserId,
        organizationId: orgId,
        status: AUTH_MEMBERSHIP_STATUSES.active,
        subjectAttributes: { role: SUBJECT_ROLES.manager },
        policyId: restrictedPolicyId,
        policyVersion: "2026-07-10",
      },
    });

    const signInRestricted = await httpRequest(app).post("/auth/sign-in").send({
      email: "restricted@acme.test",
      password: "CorrectHorseBatteryStaple!",
      organization_id: orgId,
    });
    restrictedToken =
      successBody<{ session_token?: string }>(signInRestricted).session_token ??
      "";
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // Helper to create an assessment before tests
  const createAssessment = async () => {
    const res = await httpRequest(app)
      .post("/assessments")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ name: "Wizard Test Assessment" });
    assessmentId = successBody<{ assessment_id: string }>(res).assessment_id;
  };

  const createRepositorySnapshot = async (connectionId: string) => {
    await prisma.repositorySnapshot.create({
      data: {
        id: `snapshot-${connectionId}`,
        assessmentId,
        organizationId: orgId,
        connectionId,
        repositoryId: `repository-${connectionId}`,
        repositoryFullName: `acme/${connectionId}`,
        branch: "main",
        commitSha: "a".repeat(40),
        providerMetadata: { requestedRevision: "main" },
        actorId: "user-1",
        status: REPOSITORY_SNAPSHOT_STATUSES.ready,
      },
    });
  };

  describe("Save Wizard Draft [MW-wiz-001]", () => {
    beforeEach(async () => {
      await createAssessment();
    });

    it("T01 & T02: Valid partial answers and all fields provided -> 200, status IN_PROGRESS", async () => {
      // Partial answers
      const res1 = await httpRequest(app)
        .put(`/assessments/${assessmentId}/wizard/draft`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          answers: [
            {
              questionId: "businessProcess",
              value: "Test purpose",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "useCase",
              value: "User completes the primary workflow with AI assistance",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "primaryActors",
              value: "User, reviewer, AI system",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "businessTrigger",
              value: "User starts the workflow",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "expectedOutcome",
              value: "Human-reviewed result is produced",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
          ],
        });

      assert.equal(res1.status, 200);
      let body = successBody<any>(res1);
      assert.equal(body.status, WIZARD_STATUS_CODES.inProgress);
      assert.equal(body.version, 1);
      assert.ok(body.wizard_profile_id);

      // All fields provided
      const res2 = await httpRequest(app)
        .put(`/assessments/${assessmentId}/wizard/draft`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          answers: [
            {
              questionId: "businessProcess",
              value: "Updated purpose",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "useCase",
              value: "User completes the primary workflow with AI assistance",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "primaryActors",
              value: "User, reviewer, AI system",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "businessTrigger",
              value: "User starts the workflow",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "expectedOutcome",
              value: "Human-reviewed result is produced",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "aiPurpose",
              value: "Finance",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "autonomyLevel",
              value: "HUMAN_APPROVAL_REQUIRED",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "dataTypes",
              value: ["PII"],
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "affectedSubjects",
              value: ["Internal employees"],
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "decisionRole",
              value: "Advisory",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "humanReview",
              value: "Manager review",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "externalLlmUsage",
              value: "no",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
          ],
        });

      assert.equal(res2.status, 200);
      body = successBody<any>(res2);
      assert.equal(body.status, WIZARD_STATUS_CODES.inProgress);
      assert.equal(body.version, 2);
    });

    it("T03: Re-save increments version", async () => {
      const res1 = await httpRequest(app)
        .put(`/assessments/${assessmentId}/wizard/draft`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          answers: [
            {
              questionId: "businessProcess",
              value: "Draft 1",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "useCase",
              value: "User completes the primary workflow with AI assistance",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "primaryActors",
              value: "User, reviewer, AI system",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "businessTrigger",
              value: "User starts the workflow",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "expectedOutcome",
              value: "Human-reviewed result is produced",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
          ],
        });
      assert.equal(res1.status, 200);
      assert.equal(successBody<any>(res1).version, 1);

      const res2 = await httpRequest(app)
        .put(`/assessments/${assessmentId}/wizard/draft`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          answers: [
            {
              questionId: "businessProcess",
              value: "Draft 2",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "useCase",
              value: "User completes the primary workflow with AI assistance",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "primaryActors",
              value: "User, reviewer, AI system",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "businessTrigger",
              value: "User starts the workflow",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "expectedOutcome",
              value: "Human-reviewed result is produced",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
          ],
        });
      assert.equal(res2.status, 200);
      assert.equal(successBody<any>(res2).version, 2);
    });

    it("T04: Attempt to save when already submitted -> 409", async () => {
      await prisma.wizardProfile.create({
        data: {
          id: "wp-3",
          assessmentId,
          organizationId: orgId,
          ownerId: "user-1",
          status: WIZARD_STATUS_CODES.submitted,
          answers: [],
          version: 1,
          submittedAt: new Date(),
        },
      });

      await prisma.repositoryConnection.create({
        data: {
          id: "repo-conn-1",
          assessmentId,
          organizationId: orgId,
          userId: "user-1",
          installationId: "123",
          repositoryId: "gh-1",
          repositoryName: "repo",
          repositoryFullName: "acme/repo",
          defaultBranch: "main",
          permissions: {},
          status: REPOSITORY_CONNECTION_STATUSES.active,
        },
      });
      await createRepositorySnapshot("repo-conn-1");

      const res = await httpRequest(app)
        .put(`/assessments/${assessmentId}/wizard/draft`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          answers: [
            {
              questionId: "businessProcess",
              value: "Draft",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "useCase",
              value: "User completes the primary workflow with AI assistance",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "primaryActors",
              value: "User, reviewer, AI system",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "businessTrigger",
              value: "User starts the workflow",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "expectedOutcome",
              value: "Human-reviewed result is produced",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
          ],
        });
      assert.equal(res.status, 409);
      assert.equal(problemCode(res), WIZARD_ERROR_CODES.alreadySubmitted);
    });

    it("T04b: Attempt to save when already submitted BUT no repo connected -> 200", async () => {
      await prisma.wizardProfile.create({
        data: {
          id: "wp-4",
          assessmentId,
          organizationId: orgId,
          ownerId: "user-1",
          status: WIZARD_STATUS_CODES.submitted,
          answers: [],
          version: 1,
          submittedAt: new Date(),
        },
      });

      // First, clean up the repo connection
      await prisma.repositoryConnection.deleteMany();

      const res = await httpRequest(app)
        .put(`/assessments/${assessmentId}/wizard/draft`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          answers: [
            {
              questionId: "businessProcess",
              value: "Draft",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "useCase",
              value: "User completes the primary workflow with AI assistance",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "primaryActors",
              value: "User, reviewer, AI system",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "businessTrigger",
              value: "User starts the workflow",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "expectedOutcome",
              value: "Human-reviewed result is produced",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
          ],
        });
      assert.equal(res.status, 200);
      assert.equal(successBody<any>(res).status, WIZARD_STATUS_CODES.submitted);
    });

    it("T05: Invalid/missing assessment -> 404", async () => {
      const res = await httpRequest(app)
        .put(`/assessments/invalid-id/wizard/draft`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          answers: [
            {
              questionId: "businessProcess",
              value: "Draft",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "useCase",
              value: "User completes the primary workflow with AI assistance",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "primaryActors",
              value: "User, reviewer, AI system",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "businessTrigger",
              value: "User starts the workflow",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "expectedOutcome",
              value: "Human-reviewed result is produced",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
          ],
        });
      assert.equal(res.status, 404);
      assert.equal(problemCode(res), ASSESSMENT_ERROR_CODES.notFound);
    });

    it("T06: Actor lacks wizard:write -> 403 PBAC_DENIED", async () => {
      const res = await httpRequest(app)
        .put(`/assessments/${assessmentId}/wizard/draft`)
        .set("Authorization", `Bearer ${restrictedToken}`)
        .send({
          answers: [
            {
              questionId: "businessProcess",
              value: "Draft",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "useCase",
              value: "User completes the primary workflow with AI assistance",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "primaryActors",
              value: "User, reviewer, AI system",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "businessTrigger",
              value: "User starts the workflow",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "expectedOutcome",
              value: "Human-reviewed result is produced",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
          ],
        });
      assert.equal(res.status, 403);
      assert.equal(problemCode(res), AUTH_ERROR_CODES.pbacDenied);
    });

    it("T07: Partial save preserves existing fields", async () => {
      await httpRequest(app)
        .put(`/assessments/${assessmentId}/wizard/draft`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          answers: [
            {
              questionId: "businessProcess",
              value: "Original purpose",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "useCase",
              value: "User completes the primary workflow with AI assistance",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "primaryActors",
              value: "User, reviewer, AI system",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "businessTrigger",
              value: "User starts the workflow",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "expectedOutcome",
              value: "Human-reviewed result is produced",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "aiPurpose",
              value: "Healthcare",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "autonomyLevel",
              value: "HUMAN_APPROVAL_REQUIRED",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
          ],
        });

      await httpRequest(app)
        .put(`/assessments/${assessmentId}/wizard/draft`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          answers: [
            {
              questionId: "aiPurpose",
              value: "Finance",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "autonomyLevel",
              value: "HUMAN_APPROVAL_REQUIRED",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
          ],
        });

      const profile = await prisma.wizardProfile.findUnique({
        where: { assessmentId },
      });
      const answers = profile?.answers as Array<{
        questionId: string;
        value: any;
      }>;
      const bpAnswer = answers.find((a) => a.questionId === "businessProcess");
      const aipAnswer = answers.find((a) => a.questionId === "aiPurpose");
      assert.equal(bpAnswer?.value, "Original purpose");
      assert.equal(aipAnswer?.value, "Finance");
    });

    it("T08: WIZARD_DRAFT_SAVED audit event has no answer content", async () => {
      await httpRequest(app)
        .put(`/assessments/${assessmentId}/wizard/draft`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          answers: [
            {
              questionId: "businessProcess",
              value: "Super secret answers",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "useCase",
              value: "User completes the primary workflow with AI assistance",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "primaryActors",
              value: "User, reviewer, AI system",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "businessTrigger",
              value: "User starts the workflow",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "expectedOutcome",
              value: "Human-reviewed result is produced",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
          ],
        });

      const audit = await prisma.authAuditEvent.findFirst({
        where: { eventType: WIZARD_EVENT_TYPES.draftSaved },
        orderBy: { createdAt: "desc" },
      });

      assert.ok(audit);
      assert.doesNotMatch(
        JSON.stringify(audit.payload),
        /Super secret answers/,
      );
    });
  });

  describe("Submit Wizard [MW-wiz-002]", () => {
    beforeEach(async () => {
      await createAssessment();
    });

    const validAnswers = [
      {
        questionId: "businessProcess",
        value: "Test purpose",
        answerState: "ANSWERED",
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        questionId: "useCase",
        value: "User completes the primary workflow with AI assistance",
        answerState: "ANSWERED",
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        questionId: "primaryActors",
        value: "User, reviewer, AI system",
        answerState: "ANSWERED",
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        questionId: "businessTrigger",
        value: "User starts the workflow",
        answerState: "ANSWERED",
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        questionId: "expectedOutcome",
        value: "Human-reviewed result is produced",
        answerState: "ANSWERED",
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        questionId: "aiPurpose",
        value: "Finance",
        answerState: "ANSWERED",
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        questionId: "autonomyLevel",
        value: "HUMAN_APPROVAL_REQUIRED",
        answerState: "ANSWERED",
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        questionId: "dataTypes",
        value: ["PII"],
        answerState: "ANSWERED",
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        questionId: "affectedSubjects",
        value: ["Internal employees"],
        answerState: "ANSWERED",
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        questionId: "decisionRole",
        value: "Advisory",
        answerState: "ANSWERED",
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        questionId: "humanReview",
        value: "Manager review",
        answerState: "ANSWERED",
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
      {
        questionId: "externalLlmUsage",
        value: "no",
        answerState: "ANSWERED",
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
    ];

    it("T01: All critical fields present -> 200, status SUBMITTED", async () => {
      const res = await httpRequest(app)
        .post(`/assessments/${assessmentId}/wizard/submit`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ answers: validAnswers });

      assert.equal(res.status, 200);
      const body = successBody<any>(res);
      assert.equal(body.status, WIZARD_STATUS_CODES.submitted);
      assert.equal(
        body.assessment_status,
        ASSESSMENT_STATUS_CODES.wizardSubmitted,
      );
      assert.ok(body.submitted_at);
    });

    it("T02 & T03: Missing critical fields -> 422 WIZARD_VALIDATION_FAILED", async () => {
      const invalidAnswers = validAnswers.filter(
        (a) => a.questionId !== "businessProcess",
      );

      const res = await httpRequest(app)
        .post(`/assessments/${assessmentId}/wizard/submit`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ answers: invalidAnswers });

      assert.equal(res.status, 422);
      assert.equal(problemCode(res), WIZARD_ERROR_CODES.validationFailed);
      assert.doesNotMatch(
        JSON.stringify(res.body).toLowerCase(),
        /risk|severity/,
      );
    });

    it("T04: Already submitted -> 409 WIZARD_ALREADY_SUBMITTED", async () => {
      await httpRequest(app)
        .post(`/assessments/${assessmentId}/wizard/submit`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ answers: validAnswers });

      await prisma.repositoryConnection.create({
        data: {
          id: "repo-conn-2",
          assessmentId,
          organizationId: orgId,
          userId: "user-1",
          installationId: "123",
          repositoryId: "gh-1",
          repositoryName: "repo",
          repositoryFullName: "acme/repo",
          defaultBranch: "main",
          permissions: {},
          status: REPOSITORY_CONNECTION_STATUSES.active,
        },
      });
      await createRepositorySnapshot("repo-conn-2");

      const res = await httpRequest(app)
        .post(`/assessments/${assessmentId}/wizard/submit`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ answers: validAnswers });

      assert.equal(res.status, 409);
      assert.equal(problemCode(res), WIZARD_ERROR_CODES.alreadySubmitted);
    });

    it("T04b: Attempt to submit when already submitted BUT no repo connected -> 200", async () => {
      await httpRequest(app)
        .post(`/assessments/${assessmentId}/wizard/submit`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ answers: validAnswers });

      await prisma.repositoryConnection.deleteMany();

      const res = await httpRequest(app)
        .post(`/assessments/${assessmentId}/wizard/submit`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          answers: [
            {
              questionId: "businessProcess",
              value: "Updated Submitted",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
            {
              questionId: "decisionImportance",
              value: "HIGH",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
          ],
        });
      assert.equal(res.status, 200);
      assert.equal(successBody<any>(res).status, WIZARD_STATUS_CODES.submitted);
    });

    it("T05: Assessment not found -> 404", async () => {
      const res = await httpRequest(app)
        .post(`/assessments/invalid-id/wizard/submit`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ answers: validAnswers });

      assert.equal(res.status, 404);
      assert.equal(problemCode(res), ASSESSMENT_ERROR_CODES.notFound);
    });

    it("T06: Verify Assessment.status transitions correctly upon submission", async () => {
      await httpRequest(app)
        .post(`/assessments/${assessmentId}/wizard/submit`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ answers: validAnswers });

      const assessment = await prisma.assessment.findUnique({
        where: { id: assessmentId },
      });
      assert.ok(assessment);
      assert.notEqual(
        assessment.status,
        ASSESSMENT_STATUS_CODES.wizardInProgress,
      );
    });

    it("T07: Outbox message wizard.submitted is generated", async () => {
      await httpRequest(app)
        .post(`/assessments/${assessmentId}/wizard/submit`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ answers: validAnswers });

      const outbox = await prisma.outboxMessage.findFirst({
        where: {
          aggregateType: OUTBOX_AGGREGATE_TYPES.wizardProfile,
          eventType: WIZARD_EVENT_TYPES.submittedOutbox,
        },
      });

      assert.ok(outbox);
      assert.equal(outbox.status, OUTBOX_STATUSES.pending);
      const payload = outbox.payload as any;
      assert.equal(payload.schemaVersion, OUTBOX_MESSAGE_SCHEMA_VERSION);
    });

    it("T08: Answers immutable after submit (draft save rejected)", async () => {
      await httpRequest(app)
        .post(`/assessments/${assessmentId}/wizard/submit`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ answers: validAnswers });

      await prisma.repositoryConnection.create({
        data: {
          id: "repo-conn-3",
          assessmentId,
          organizationId: orgId,
          userId: "user-1",
          installationId: "123",
          repositoryId: "gh-1",
          repositoryName: "repo",
          repositoryFullName: "acme/repo",
          defaultBranch: "main",
          permissions: {},
          status: REPOSITORY_CONNECTION_STATUSES.active,
        },
      });
      await createRepositorySnapshot("repo-conn-3");

      const res = await httpRequest(app)
        .put(`/assessments/${assessmentId}/wizard/draft`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          answers: [
            {
              questionId: "businessProcess",
              value: "Edited",
              answerState: "ANSWERED",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
          ],
        });

      assert.equal(res.status, 409);
      assert.equal(problemCode(res), WIZARD_ERROR_CODES.alreadySubmitted);
    });

    it("T10: Audit payload WIZARD_SUBMITTED has no answers content", async () => {
      await httpRequest(app)
        .post(`/assessments/${assessmentId}/wizard/submit`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ answers: validAnswers });

      const audit = await prisma.authAuditEvent.findFirst({
        where: { eventType: WIZARD_EVENT_TYPES.submitted },
        orderBy: { createdAt: "desc" },
      });

      assert.ok(audit);
      assert.doesNotMatch(JSON.stringify(audit.payload), /Test purpose/);
    });
  });

  describe("Wizard Readiness State [MW-wiz-003]", () => {
    beforeEach(async () => {
      await createAssessment();
    });

    it("T01: WizardProfile submitted, no technical evidence -> classification_locked = true", async () => {
      await prisma.wizardProfile.create({
        data: {
          id: "wp-1",
          assessmentId,
          organizationId: orgId,
          ownerId: "user-1",
          status: WIZARD_STATUS_CODES.submitted,
          answers: {},
          version: 1,
          submittedAt: new Date(),
        },
      });

      const res = await httpRequest(app)
        .get(`/assessments/${assessmentId}/readiness`)
        .set("Authorization", `Bearer ${managerToken}`);

      assert.equal(res.status, 200);
      const body = successBody<any>(res);
      assert.equal(body.classification_locked, true);
      assert.equal(body.lock_reason, ASSESSMENT_LOCK_REASONS.evidenceRequired);
    });

    it("T02: WizardProfile submitted, evidence accepted -> classification_locked = false", async () => {
      await prisma.wizardProfile.create({
        data: {
          id: "wp-2",
          assessmentId,
          organizationId: orgId,
          ownerId: "user-1",
          status: WIZARD_STATUS_CODES.submitted,
          answers: {},
          version: 1,
          submittedAt: new Date(),
        },
      });

      await prisma.technicalEvidenceReport.create({
        data: {
          id: "ter-1",
          scanJobId: "job-1",
          organizationId: orgId,
          snapshotId: "snap-1",
          toolsVersion: {},
          configHash: {},
          evidencePayload: {},
          privacyFlags: {},
          schemaVersion: "1.0",
          assessmentId,
          status: TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
        },
      });

      const res = await httpRequest(app)
        .get(`/assessments/${assessmentId}/readiness`)
        .set("Authorization", `Bearer ${managerToken}`);

      assert.equal(res.status, 200);
      const body = successBody<any>(res);
      assert.equal(body.classification_locked, false);
    });

    it("T03: No repository connected -> missing_evidence includes repository_connection", async () => {
      const res = await httpRequest(app)
        .get(`/assessments/${assessmentId}/readiness`)
        .set("Authorization", `Bearer ${managerToken}`);

      assert.equal(res.status, 200);
      const body = successBody<any>(res);
      const missingEvidence = body.missing_evidence as any[];
      assert.ok(
        missingEvidence.some((item) => item.type === "repository_connection"),
      );
    });

    it("T04: Repository connected, no evidence -> missing_evidence includes technical_evidence", async () => {
      await prisma.repositoryConnection.create({
        data: {
          id: "repo-1",
          organizationId: orgId,
          userId: "user-1",
          installationId: "inst-1",
          repositoryId: "12345",
          repositoryName: "test",
          repositoryFullName: "acme/test",
          defaultBranch: "main",
          permissions: {},
          assessmentId,
          status: REPOSITORY_CONNECTION_STATUSES.active,
        },
      });

      const res = await httpRequest(app)
        .get(`/assessments/${assessmentId}/readiness`)
        .set("Authorization", `Bearer ${managerToken}`);

      assert.equal(res.status, 200);
      const body = successBody<any>(res);
      const missingEvidence = body.missing_evidence as any[];
      assert.ok(
        missingEvidence.some((item) => item.type === "technical_evidence"),
      );
    });

    it("T05: Ensure no risk labels are returned when locked", async () => {
      const res = await httpRequest(app)
        .get(`/assessments/${assessmentId}/readiness`)
        .set("Authorization", `Bearer ${managerToken}`);

      assert.equal(res.status, 200);
      const bodyStr = JSON.stringify(successBody<any>(res)).toLowerCase();
      assert.doesNotMatch(bodyStr, /risk|severity/);
    });

    it("T06: next_action uses business language", async () => {
      const res = await httpRequest(app)
        .get(`/assessments/${assessmentId}/readiness`)
        .set("Authorization", `Bearer ${managerToken}`);

      assert.equal(res.status, 200);
      const body = successBody<any>(res);
      assert.ok(body.next_action);
      assert.doesNotMatch(
        String(body.next_action).toLowerCase(),
        /risk|severity|violation|compliant/,
      );
    });

    it("T07: Assessment not in org -> 404", async () => {
      const res = await httpRequest(app)
        .get(`/assessments/invalid-id/readiness`)
        .set("Authorization", `Bearer ${managerToken}`);

      assert.equal(res.status, 404);
      assert.equal(problemCode(res), ASSESSMENT_ERROR_CODES.notFound);
    });
    it("T08: GET readiness with EXPLICIT_UNKNOWN answers returns unresolved_unknown_items", async () => {
      await prisma.wizardProfile.create({
        data: {
          id: "wp-unknowns",
          assessmentId,
          organizationId: orgId,
          ownerId: "user-1",
          status: WIZARD_STATUS_CODES.submitted,
          answers: [
            {
              questionId: "dataTypes",
              value: null,
              answerState: "EXPLICIT_UNKNOWN",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
          ],
          version: 1,
          submittedAt: new Date(),
        },
      });

      const res = await httpRequest(app)
        .get(`/assessments/${assessmentId}/readiness`)
        .set("Authorization", `Bearer ${managerToken}`);

      assert.equal(res.status, 200);
      const body = successBody<any>(res);
      assert.equal(body.classification_locked, true);
      assert.equal(body.unresolved_unknown_items.length, 1);
      assert.equal(body.unresolved_unknown_items[0].questionId, "dataTypes");
      assert.equal(body.unresolved_unknown_items[0].label, "dataTypes");
    });

    it("T09: After technical evidence, unresolved_unknown_items are still returned and classification is unlocked", async () => {
      await prisma.wizardProfile.create({
        data: {
          id: "wp-unknowns-unlocked",
          assessmentId,
          organizationId: orgId,
          ownerId: "user-1",
          status: WIZARD_STATUS_CODES.submitted,
          answers: [
            {
              questionId: "humanReview",
              value: null,
              answerState: "EXPLICIT_UNKNOWN",
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
          ],
          version: 1,
          submittedAt: new Date(),
        },
      });

      await prisma.technicalEvidenceReport.create({
        data: {
          id: "ter-unlocked",
          scanJobId: "job-2",
          organizationId: orgId,
          snapshotId: "snap-2",
          toolsVersion: {},
          configHash: {},
          evidencePayload: {},
          privacyFlags: {},
          schemaVersion: "1.0",
          assessmentId,
          status: TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
        },
      });

      const res = await httpRequest(app)
        .get(`/assessments/${assessmentId}/readiness`)
        .set("Authorization", `Bearer ${managerToken}`);

      assert.equal(res.status, 200);
      const body = successBody<any>(res);
      assert.equal(body.classification_locked, false);
      assert.equal(body.unresolved_unknown_items.length, 1);
      assert.equal(body.unresolved_unknown_items[0].questionId, "humanReview");
    });
  });
});
