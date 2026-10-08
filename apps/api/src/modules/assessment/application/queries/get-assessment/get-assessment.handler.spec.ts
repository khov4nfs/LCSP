import { describe, expect, it, jest } from "@jest/globals";
import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
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
      legalPortfolioVersionId: null,
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
  const tx = { assessment: { findUnique } };
  const prisma = {
    $transaction: async (read: (tx: unknown) => Promise<unknown>) => read(tx),
  } as unknown as PrismaService;
  return {
    handler: new GetAssessmentHandler(new AssessmentDetailLoader(prisma)),
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
    const result = await read.execute(query());
    expect(result.lifecycle).toEqual({
      state: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
      assessmentRevision: 2,
    });
    expect(result.runtime?.executionState).toBe(AGENT_EXECUTION_STATES.QUEUED);
    expect(result.case?.coverage).toEqual([]);
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
  it("does not expose customer cases to an admin", async () => {
    await expect(
      handler(fixture()).handler.execute(query("owner", AUTH_USER_ROLES.admin)),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("keeps historical all-null lifecycle explicitly unavailable", async () => {
    const result = await handler(
      fixture({
        lifecycleState: null,
        lifecycleRevision: null,
        runtime: null,
        domainCase: null,
      }),
    ).handler.execute(query());
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
