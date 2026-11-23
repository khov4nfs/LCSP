import { authoredLocalizationFixture } from "../../../../../../test/support/authored-localization.fixture.js";
import { describe, expect, it, jest } from "@jest/globals";
import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_AUDIT_MODES,
  assessmentDetailSchema,
} from "@lcsp/contracts/assessment-domain";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AssessmentDetailLoader } from "../../../infrastructure/persistence/assessment-detail.loader.js";
import { GetAssessmentHandler } from "./get-assessment.handler.js";
import { GetAssessmentQuery } from "./get-assessment.query.js";

const assessmentId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-10-08T00:00:00.000Z");
function fixture(overrides: Record<string, unknown> = {}) {
  return {
    id: assessmentId,
    name: "Assessment",
    ownerId: "owner",
    lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
    lifecycleRevision: 2,
    blockerReason: null,
    blockerReference: null,
    runtime: {
      threadId: "22222222-2222-4222-8222-222222222222",
      rootAgentVersion: "assessment-root-v2",
      checkpointNamespace: assessmentId,
      checkpointId: null,
      currentExecutionId: null,
      executionState: AGENT_EXECUTION_STATES.QUEUED,
      eventSequence: 1,
      startedAt: null,
      lastResumedAt: null,
      updatedAt: now,
    },
    domainCase: {
      caseRevision: 0,
      auditRequestRevision: 0,
      auditMode: ASSESSMENT_AUDIT_MODES.LEGACY_FULL,
      ruleSetVersionId: null,
      repositorySnapshotId: null,
      repositoryScanJobId: null,
      repositoryCommit: null,
      coverage: [],
      facts: [],
      artifacts: [],
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
function handler(row: unknown) {
  const findUnique = jest.fn<() => Promise<unknown>>().mockResolvedValue(row);
  const tx = {
    assessment: { findUnique },
    llmUsageEvent: {
      aggregate: jest.fn<() => Promise<unknown>>().mockResolvedValue({
        _sum: { inputTokens: null, outputTokens: null, totalTokens: null },
        _count: { id: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      }),
    },
  };
  const prisma = {
    $transaction: async (read: (tx: unknown) => Promise<unknown>) => read(tx),
  } as unknown as PrismaService;
  return {
    handler: new GetAssessmentHandler(
      new AssessmentDetailLoader(
        prisma,
        authoredLocalizationFixture().projection,
      ),
    ),
    findUnique,
  };
}
const query = (
  owner = "owner",
  role: GetAssessmentQuery["subjectRole"] = AUTH_USER_ROLES.customer,
) => new GetAssessmentQuery(assessmentId, owner, role, "corr");

describe("canonical customer assessment read", () => {
  it("projects persisted ALS/AES and Case without legacy readiness or classification queries/writes", async () => {
    const { handler: read, findUnique } = handler(fixture());
    // Parsing the customer branch narrows the handler's intentional RBAC result union.
    const result = assessmentDetailSchema.parse(await read.execute(query()));
    expect(result.lifecycle).toEqual({
      state: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
      assessmentRevision: 2,
    });
    expect(result.runtime?.executionState).toBe(AGENT_EXECUTION_STATES.QUEUED);
    expect(result.case?.coverage).toEqual([]);
    expect(result.usage).toEqual({ invocationCount: 0, partial: false });
    expect(result).not.toHaveProperty("status");
    expect(result).not.toHaveProperty("readiness_state");
    expect(result).not.toHaveProperty("classification_result");
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
  it.each([null, fixture({ ownerId: "another" })])(
    "hides missing/foreign assessments",
    async (row) => {
      await expect(handler(row).handler.execute(query())).rejects.toMatchObject(
        { status: 404 },
      );
    },
  );
  it("returns only operational metadata to an admin", async () => {
    const result = await handler(fixture()).handler.execute(
      query("admin-user", AUTH_USER_ROLES.admin),
    );

    // ADMIN receives the strict metadata projection; customer case, runtime payload,
    // usage, and provenance remain absent even when the persistence row contains them.
    expect(result).toEqual({
      assessment_id: assessmentId,
      owner_id: "owner",
      name: "Assessment",
      lifecycle_state: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
      execution_state: AGENT_EXECUTION_STATES.QUEUED,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      correlationId: "corr",
    });
    expect(result).not.toHaveProperty("case");
    expect(result).not.toHaveProperty("runtime");
    expect(result).not.toHaveProperty("usage");
  });
  it("keeps historical all-null lifecycle explicitly unavailable", async () => {
    const result = assessmentDetailSchema.parse(
      await handler(
        fixture({
          lifecycleState: null,
          lifecycleRevision: null,
          runtime: null,
          domainCase: null,
        }),
      ).handler.execute(query()),
    );
    expect(result.lifecycle).toBeNull();
    expect(result.runtime).toBeNull();
    expect(result.case).toBeNull();
  });
  it("fails closed for partial canonical persistence", async () => {
    await expect(
      handler(fixture({ lifecycleRevision: null })).handler.execute(query()),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("rejects a runtime belonging to a different checkpoint namespace", async () => {
    const row = fixture();
    row.runtime.checkpointNamespace = "33333333-3333-4333-8333-333333333333";
    await expect(handler(row).handler.execute(query())).rejects.toMatchObject({
      status: 409,
    });
  });
});
