import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import { ClassificationGuardrailStatus } from "@prisma/client";
import {
  AGENTIC_TOOL_STATUSES,
  GAP_REQUIREMENT_LIMITATION_CODES,
} from "@lcsp/contracts/evidence";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { GetGapRequirementsHandler } from "./get-gap-requirements.handler.js";
import { GetGapRequirementsQuery } from "./get-gap-requirements.query.js";

function createHandler(input?: {
  assessment?: object | null;
  classification?: object | null;
}) {
  const prisma = {
    assessment: {
      findFirst: jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue(
          input?.assessment === undefined
            ? { id: "assessment-1" }
            : input.assessment,
        ),
    },
    classificationResult: {
      findFirst: jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue(
          input?.classification === undefined
            ? acceptedClassification()
            : input.classification,
        ),
    },
  } as unknown as PrismaService;
  const write = jest
    .fn<AuditWriterService["write"]>()
    .mockResolvedValue(undefined);
  return {
    handler: new GetGapRequirementsHandler(prisma, {
      write,
    } as unknown as AuditWriterService),
    write,
  };
}

function query(input?: {
  policyProfileVersionId?: string;
  actorRole?: (typeof AUTH_USER_ROLES)[keyof typeof AUTH_USER_ROLES];
}) {
  return new GetGapRequirementsQuery(
    "assessment-1",
    {
      classificationRef: "classification:classification-1",
      policyProfileVersionId:
        input?.policyProfileVersionId ?? "rbac-role_CUSTOMER",
    },
    "user-1",
    input?.actorRole ?? AUTH_USER_ROLES.customer,
    "correlation-1",
  );
}

function acceptedClassification(input?: {
  classificationData?: unknown;
  guardrailStatus?: string;
  blockedReason?: string | null;
}) {
  return {
    id: "classification-1",
    classificationData: input?.classificationData ?? {
      applicability_assessment: "applicable",
      risk_level: "HIGH",
      citation_basis: ["citation:chunk_allow_1"],
    },
    guardrailStatus: input?.guardrailStatus ?? "PASSED",
    blockedReason: input?.blockedReason ?? null,
  };
}

describe("GetGapRequirementsHandler", () => {
  it("TC-01: returns deterministic requirement refs for CUSTOMER role profile", async () => {
    const { handler, write } = createHandler();

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.ready);
    expect(response.result.matrixRef).toBe("matrix:classification-1");
    expect(response.result.requirements).toEqual([
      {
        requirementId: "requirement:classification-1:applicability_assessment",
        locator: "classification.applicability_assessment",
      },
      {
        requirementId: "requirement:classification-1:citation_basis",
        locator: "classification.citation_basis",
      },
      {
        requirementId: "requirement:classification-1:risk_level",
        locator: "classification.risk_level",
      },
    ]);
    expect(JSON.stringify(write.mock.calls)).toContain("requirementCount");
  });

  it("TC-02: blocks stale role-profile pins", async () => {
    const { handler } = createHandler();

    const response = await handler.execute(
      query({ policyProfileVersionId: "rbac-role_ADMIN" }),
    );

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.blocked);
    expect(response.limitations[0]?.code).toBe(
      GAP_REQUIREMENT_LIMITATION_CODES.policyUnavailable,
    );
  });

  it("TC-02b: blocks ADMIN because gap requirements are CUSTOMER-only", async () => {
    const { handler } = createHandler();

    const response = await handler.execute(
      query({
        policyProfileVersionId: "rbac-role_ADMIN",
        actorRole: AUTH_USER_ROLES.admin,
      }),
    );

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.blocked);
    expect(response.limitations[0]?.code).toBe(
      GAP_REQUIREMENT_LIMITATION_CODES.policyUnavailable,
    );
  });

  it("TC-03: reports missing accepted classification as typed input", async () => {
    const { handler } = createHandler({ classification: null });

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.needsInput);
    expect(response.limitations[0]?.code).toBe(
      GAP_REQUIREMENT_LIMITATION_CODES.classificationUnavailable,
    );
  });

  it("TC-04: blocks guardrail-blocked classifications", async () => {
    const { handler } = createHandler({
      classification: acceptedClassification({
        guardrailStatus: ClassificationGuardrailStatus.BLOCKED,
        blockedReason: "NO_CITATION_BASIS",
      }),
    });

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.blocked);
    expect(response.limitations[0]?.code).toBe(
      GAP_REQUIREMENT_LIMITATION_CODES.classificationBlocked,
    );
  });

  it("TC-05: reports deterministic-unavailable classifications as typed input", async () => {
    const { handler } = createHandler({
      classification: acceptedClassification({
        classificationData: { nested: true },
      }),
    });

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.needsInput);
    expect(response.limitations[0]?.code).toBe(
      GAP_REQUIREMENT_LIMITATION_CODES.requirementsUnavailable,
    );
  });

  it("TC-06: rejects inaccessible assessment before reading classification", async () => {
    const { handler } = createHandler({ assessment: null });

    await expect(handler.execute(query())).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});
