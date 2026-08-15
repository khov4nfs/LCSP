/** MW-rec-002: List Conflicts Endpoint. */

import * as assert from "node:assert/strict";

import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_STATUS_CODES,
} from "@lcsp/contracts/assessment";
import { AUTH_MEMBERSHIP_STATUSES } from "@lcsp/contracts/auth";
import {
  PBAC_ACTIONS,
  PBAC_REASON_CODE,
  PBAC_STATE_GATES,
  SUBJECT_ROLES,
} from "@lcsp/contracts/pbac";
import {
  CONFLICT_RECORD_STATUSES,
  type ConflictRecordStatus,
} from "@lcsp/contracts/scan";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { AppModule } from "../src/app.module.js";
import { hashSecret } from "../src/modules/auth-workspace/infrastructure/security/security.utils.js";
import type { ConflictListDto } from "../src/modules/reconciliation/application/contracts/reconciliation/conflict-list.contract.js";
import {
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  TEST_DATABASE_URL,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, problemCode, successBody } from "./support/http.js";

describe("List Conflicts Endpoint (e2e) [MW-rec-002]", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let managerToken: string;
  const orgId = "org-1";

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
    await prisma.conflictRecord.deleteMany();
    await prisma.assessment.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);
    await prisma.authPolicy.update({
      where: {
        id_version: {
          id: "policy-manager-workspace",
          version: "2026-06-26",
        },
      },
      data: {
        actions: [
          PBAC_ACTIONS.workspaceRead,
          PBAC_ACTIONS.assessmentCreate,
          PBAC_ACTIONS.assessmentRead,
          PBAC_ACTIONS.assessmentList,
          PBAC_ACTIONS.githubConnect,
          PBAC_ACTIONS.scanRead,
          PBAC_ACTIONS.scanTrigger,
          PBAC_ACTIONS.documentGenerate,
          PBAC_ACTIONS.snapshotCreate,
          PBAC_ACTIONS.conflictRead,
        ],
      },
    });
    await prisma.assessment.create({
      data: {
        id: "assessment-conflicts-1",
        organizationId: orgId,
        ownerId: "user-1",
        name: "Conflict review assessment",
        status: ASSESSMENT_STATUS_CODES.scanInProgress,
      },
    });

    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "manager@acme.test",
      password: "CorrectHorseBatteryStaple!",
      organization_id: orgId,
    });
    managerToken =
      successBody<{ session_token?: string }>(signIn).session_token ?? "";
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // T01
  it("T01: pending conflicts exist -> 200 list returned", async () => {
    await seedConflict({ id: "conflict-pending-1" });
    await seedConflict({
      id: "conflict-pending-2",
      conflictType: "scope_mismatch",
      conflictScore: 0.41,
      evidenceRefs: ["evidence-report-1::finding-2"],
    });

    const result = await listConflicts();
    const body = successBody<ConflictListDto>(result);

    assert.equal(result.status, 200);
    assert.equal(body.conflicts.length, 2);
    assert.equal(body.total, 2);
    assert.equal(body.page, 1);
    assert.equal(body.page_size, 20);
    assert.ok(body.correlationId);
    body.conflicts.forEach((conflict) => {
      assert.ok(conflict.conflict_id);
      assert.ok(conflict.conflict_type);
      assert.equal(conflict.status, CONFLICT_RECORD_STATUSES.pending);
      assert.ok(conflict.conflict_score >= 0);
      assert.ok(conflict.conflict_score <= 1);
      assert.ok(conflict.score_explanation);
      assert.equal(
        conflict.explanation_basis.affected_field,
        "external_llm_usage",
      );
      assert.equal(conflict.explanation_basis.confidence, "high");
      assert.match(
        conflict.explanation_basis.score_priority_explanation,
        /prioritizes Manager review effort/i,
      );
      assert.doesNotMatch(
        conflict.explanation_basis.score_priority_explanation,
        /^legal risk$/i,
      );
      assert.deepEqual(conflict.explanation_basis.source_values, {
        manager_answer: "No external AI use",
        technical_evidence: "External model invocation detected",
      });
      assert.equal(
        conflict.explanation_basis.evidence_context[0]?.coverage_limitations,
        "Evidence covers invocation detection only and does not classify compliance status.",
      );
      assert.ok(conflict.created_at);
      assert.ok(Array.isArray(conflict.evidence_refs));
    });
  });

  // T02
  it("T02: no conflicts -> 200 empty list", async () => {
    const result = await listConflicts();
    const body = successBody<ConflictListDto>(result);

    assert.equal(result.status, 200);
    assert.deepEqual(body.conflicts, []);
    assert.equal(body.total, 0);
  });

  // T03
  it("T03: status filter returns only resolved conflicts", async () => {
    await seedConflict({ id: "conflict-pending-1" });
    await seedConflict({
      id: "conflict-resolved-1",
      status: CONFLICT_RECORD_STATUSES.resolved,
    });

    const result = await listConflicts({
      status: CONFLICT_RECORD_STATUSES.resolved,
    });
    const body = successBody<ConflictListDto>(result);

    assert.equal(result.status, 200);
    assert.equal(body.conflicts.length, 1);
    assert.equal(body.conflicts[0]?.conflict_id, "conflict-resolved-1");
    assert.equal(body.conflicts[0]?.status, CONFLICT_RECORD_STATUSES.resolved);
  });

  // T04
  it("T04: actor lacks conflict:read -> 403 PBAC_DENIED", async () => {
    const restrictedPolicyId = "policy-no-conflict-read";
    await prisma.authPolicy.create({
      data: {
        id: restrictedPolicyId,
        version: "2026-07-10",
        actions: [PBAC_ACTIONS.workspaceRead],
        subjectRole: SUBJECT_ROLES.manager,
        stateGate: PBAC_STATE_GATES.membershipActive,
        organizationId: orgId,
      },
    });
    await prisma.authUser.create({
      data: {
        id: "user-no-conflict-read",
        email: "no-conflict-read@acme.test",
        passwordHash: hashSecret("CorrectHorseBatteryStaple!"),
        emailVerified: true,
        failedLoginCount: 0,
      },
    });
    await prisma.authMembership.create({
      data: {
        id: "membership-no-conflict-read",
        userId: "user-no-conflict-read",
        organizationId: orgId,
        status: AUTH_MEMBERSHIP_STATUSES.active,
        subjectAttributes: { role: SUBJECT_ROLES.manager },
        policyId: restrictedPolicyId,
        policyVersion: "2026-07-10",
      },
    });
    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "no-conflict-read@acme.test",
      password: "CorrectHorseBatteryStaple!",
      organization_id: orgId,
    });
    const restrictedToken =
      successBody<{ session_token?: string }>(signIn).session_token ?? "";

    const result = await httpRequest(app)
      .get("/assessments/assessment-conflicts-1/conflicts")
      .set("Authorization", `Bearer ${restrictedToken}`);

    assert.equal(result.status, 403);
    assert.equal(problemCode(result), PBAC_REASON_CODE.denied);
  });

  // T05
  it("T05: assessment not in org -> 404 ASSESSMENT_NOT_FOUND", async () => {
    await prisma.assessment.create({
      data: {
        id: "assessment-other-org",
        organizationId: "org-2",
        ownerId: "user-2",
        name: "Other org assessment",
        status: ASSESSMENT_STATUS_CODES.scanInProgress,
      },
    });

    const result = await httpRequest(app)
      .get("/assessments/assessment-other-org/conflicts")
      .set("Authorization", `Bearer ${managerToken}`);

    assert.equal(result.status, 404);
    assert.equal(problemCode(result), ASSESSMENT_ERROR_CODES.notFound);
  });

  // T06
  it("T06: evidence_refs are IDs only, not finding or source content", async () => {
    await seedConflict({
      id: "conflict-privacy-1",
      evidenceRefs: [
        "evidence-report-1::finding-source",
        {
          content: "finding text must not leak",
          source_code: "const secret = 1;",
        },
      ],
    });

    const result = await listConflicts();
    const body = successBody<ConflictListDto>(result);
    const serialized = JSON.stringify(body);

    assert.equal(result.status, 200);
    assert.deepEqual(body.conflicts[0]?.evidence_refs, [
      "evidence-report-1::finding-source",
    ]);
    assert.doesNotMatch(serialized, /finding text must not leak/);
    assert.doesNotMatch(serialized, /const secret = 1/);
  });

  function listConflicts(query: Record<string, string> = {}) {
    return httpRequest(app)
      .get("/assessments/assessment-conflicts-1/conflicts")
      .query(query)
      .set("Authorization", `Bearer ${managerToken}`);
  }

  async function seedConflict(
    overrides: Partial<{
      id: string;
      assessmentId: string;
      organizationId: string;
      conflictType: string;
      conflictScore: number;
      scoreExplanation: string;
      evidenceRefs: unknown;
      explanationBasis: unknown;
      status: ConflictRecordStatus;
    }> = {},
  ) {
    return prisma.conflictRecord.create({
      data: {
        id: overrides.id ?? "conflict-pending-1",
        aiUsageFlowId: "ai-flow-conflict-list",
        assessmentId: overrides.assessmentId ?? "assessment-conflicts-1",
        organizationId: overrides.organizationId ?? orgId,
        conflictType: overrides.conflictType ?? "evidence_contradiction",
        conflictScore: overrides.conflictScore ?? 0.87,
        scoreExplanation:
          overrides.scoreExplanation ??
          "Manager answer and technical evidence disagree.",
        evidenceRefs: overrides.evidenceRefs ?? [
          "evidence-report-1::finding-1",
        ],
        explanationBasis: overrides.explanationBasis ?? {
          affected_field: "external_llm_usage",
          confidence: "high",
          materiality_reason:
            "The manager answer and technical evidence differ on whether external AI is used.",
          score_priority_explanation:
            "This score prioritizes Manager review effort and is not a legal risk, compliance status, or final classification.",
          source_values: {
            manager_answer: "No external AI use",
            technical_evidence: "External model invocation detected",
          },
          source_refs: {
            wizard_answer: "answers.external_llm_usage",
            ai_usage_flow_claim: "claim-1",
          },
          evidence_context: [
            {
              evidence_ref: "evidence-report-1::finding-1",
              redacted_context:
                "A scanner finding indicates external model invocation. Raw source and secrets are redacted.",
              coverage_limitations:
                "Evidence covers invocation detection only and does not classify compliance status.",
            },
          ],
        },
        status: overrides.status ?? CONFLICT_RECORD_STATUSES.pending,
      },
    });
  }
});
