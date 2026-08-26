import { describe, expect, it, jest } from "@jest/globals";
import {
  ASSESSMENT_STATUS_CODES,
  WIZARD_STATUS_CODES,
} from "@lcsp/contracts/assessment";
import { AUTH_USER_ROLES, type AuthUserRole } from "@lcsp/contracts/auth";
import { UnprocessableEntityException } from "@nestjs/common";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { Assessment } from "../../../domain/entities/assessment.entity.js";
import type {
  AssessmentListResult,
  AssessmentRepository,
} from "../../ports/persistence/assessment.repository.js";
import { ListAssessmentsHandler } from "./list-assessments.handler.js";
import { ListAssessmentsQuery } from "./list-assessments.query.js";

function makeAssessment(name = "Assessment") {
  return Assessment.create({
    ownerId: "user-1",
    name,
  });
}

function buildHandler(input: {
  result?: AssessmentListResult;
  wizardProfiles?: Array<{ assessmentId: string; status: string }>;
}) {
  const findMany = jest
    .fn<AssessmentRepository["findMany"]>()
    .mockResolvedValue(input.result ?? { items: [], total: 0 });
  const repository: AssessmentRepository = {
    save: jest.fn<AssessmentRepository["save"]>(),
    saveInTx: jest.fn<AssessmentRepository["saveInTx"]>(),
    findById: jest.fn<AssessmentRepository["findById"]>(),
    findMany,
  };

  const wizardFindMany = jest
    .fn<() => Promise<Array<{ assessmentId: string; status: string }>>>()
    .mockResolvedValue(input.wizardProfiles ?? []);
  const prisma = {
    wizardProfile: { findMany: wizardFindMany },
  } as unknown as PrismaService;

  const handler = new ListAssessmentsHandler(repository, prisma);
  return { handler, findMany, wizardFindMany };
}

function query(
  overrides: Partial<{
    subjectRole: AuthUserRole;
    scope: string | null;
    page: number | undefined;
    pageSize: number | undefined;
    status: string | undefined;
  }> = {},
) {
  return new ListAssessmentsQuery(
    "user-1",
    overrides.subjectRole ?? AUTH_USER_ROLES.customer,
    overrides.scope ?? null,
    overrides.page,
    overrides.pageSize,
    overrides.status,
    "corr-1",
  );
}

describe("ListAssessmentsHandler", () => {
  // T01
  it("returns a paginated list for a Manager with assessments", async () => {
    const assessment = makeAssessment("First");
    const { handler } = buildHandler({
      result: { items: [assessment], total: 1 },
    });

    const result = await handler.execute(query());

    expect(result.assessments).toHaveLength(1);
    expect(result.assessments[0].assessment_id).toBe(assessment.id);
    expect(result.assessments[0].name).toBe("First");
    expect(result.assessments[0].wizard_status).toBe(
      WIZARD_STATUS_CODES.notStarted,
    );
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.page_size).toBe(20);
    expect(result.correlationId).toBe("corr-1");
  });

  // T02
  it("returns an empty array for a Manager with no assessments", async () => {
    const { handler } = buildHandler({ result: { items: [], total: 0 } });

    const result = await handler.execute(query());

    expect(result.assessments).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("scopes the query to ownerId for a customer", async () => {
    const { handler, findMany } = buildHandler({});

    await handler.execute(query({ subjectRole: AUTH_USER_ROLES.customer }));

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: "user-1" }),
    );
    const criteria = findMany.mock.calls[0][0];
    expect(criteria.assessmentId).toBeUndefined();
  });

  // T03
  it("passes page_size through to the repository criteria", async () => {
    const { handler, findMany } = buildHandler({});

    await handler.execute(query({ pageSize: 5 }));

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 5 }),
    );
  });

  // T04
  it("passes a valid status filter through to the repository criteria", async () => {
    const { handler, findMany } = buildHandler({});

    await handler.execute(
      query({ status: ASSESSMENT_STATUS_CODES.wizardInProgress }),
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ASSESSMENT_STATUS_CODES.wizardInProgress,
      }),
    );
  });

  it("rejects an unknown status filter with INVALID_REQUEST", async () => {
    const { handler } = buildHandler({});

    await expect(
      handler.execute(query({ status: "NOT_A_REAL_STATUS" })),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it("returns an empty list without querying for an admin, even with scope", async () => {
    const { handler, findMany } = buildHandler({});

    const result = await handler.execute(
      query({ subjectRole: AUTH_USER_ROLES.admin, scope: "assessment-42" }),
    );

    expect(result.assessments).toEqual([]);
    expect(result.total).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("returns an empty list without querying when an admin has no scope", async () => {
    const { handler, findMany } = buildHandler({});

    const result = await handler.execute(
      query({ subjectRole: AUTH_USER_ROLES.admin, scope: null }),
    );

    expect(result.assessments).toEqual([]);
    expect(result.total).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  // T07
  it("clamps page_size above 100 down to 100", async () => {
    const { handler, findMany } = buildHandler({});

    const result = await handler.execute(query({ pageSize: 500 }));

    expect(result.page_size).toBe(100);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 100 }),
    );
  });

  it("clamps page below 1 up to 1", async () => {
    const { handler } = buildHandler({});

    const result = await handler.execute(query({ page: 0 }));

    expect(result.page).toBe(1);
  });

  // T08
  it("never includes risk/severity/classification wording in the response", async () => {
    const assessment = makeAssessment();
    const { handler } = buildHandler({
      result: { items: [assessment], total: 1 },
    });

    const result = await handler.execute(query());

    const serialized = JSON.stringify(result).toLowerCase();
    expect(serialized).not.toMatch(/\brisk\b|\bseverity\b|classification/);
  });

  it("resolves wizard_status per assessment from WizardProfile rows", async () => {
    const assessment = makeAssessment();
    const { handler } = buildHandler({
      result: { items: [assessment], total: 1 },
      wizardProfiles: [
        { assessmentId: assessment.id, status: WIZARD_STATUS_CODES.submitted },
      ],
    });

    const result = await handler.execute(query());

    expect(result.assessments[0].wizard_status).toBe(
      WIZARD_STATUS_CODES.submitted,
    );
  });
});
