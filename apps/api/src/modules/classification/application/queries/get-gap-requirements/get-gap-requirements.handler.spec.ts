import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import { ClassificationGuardrailStatus } from "@prisma/client";
import {
  AGENTIC_TOOL_STATUSES,
  GAP_REQUIREMENT_LIMITATION_CODES,
} from "@lcsp/contracts/evidence";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { GetGapRequirementsHandler } from "./get-gap-requirements.handler.js";
import { GetGapRequirementsQuery } from "./get-gap-requirements.query.js";

function createHandler(input?: {
  assessment?: object | null;
  classification?: object | null;
  authPolicy?: { actions: string[] } | null;
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
    authPolicy: {
      findFirst: jest
        .fn<() => Promise<{ actions: string[] } | null>>()
        .mockResolvedValue(
          input?.authPolicy === undefined
            ? { actions: [PBAC_ACTIONS.gapRequirementsRead] }
            : input.authPolicy,
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
  policyId?: string | null;
  policyVersion?: string | null;
}) {
  return new GetGapRequirementsQuery(
    "assessment-1",
    "organization-1",
    {
      classificationRef: "classification:classification-1",
      policyProfileVersionId:
        input?.policyProfileVersionId ?? "policy_policy-1_2026-07-29",
    },
    "user-1",
    input?.policyId === undefined ? "policy-1" : input.policyId,
    input?.policyVersion === undefined ? "2026-07-29" : input.policyVersion,
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
  it("TC-01: returns deterministic requirement refs from accepted classification fields", async () => {
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
    expect(JSON.stringify(write.mock.calls)).not.toContain("HIGH_IMPACT_AI");
  });

  it("TC-02: blocks stale or mismatched policy pins", async () => {
    const { handler } = createHandler();

    const response = await handler.execute(
      query({ policyProfileVersionId: "policy_other_2026-07-29" }),
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

  it("TC-05b: accepts legacy system_type payloads through compatibility mapping", async () => {
    const { handler } = createHandler({
      classification: acceptedClassification({
        classificationData: {
          system_type: "HIGH_IMPACT_AI",
          risk_level: "HIGH",
          citation_basis: ["citation:chunk_allow_1"],
        },
      }),
    });

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.ready);
    expect(response.result.requirements).toContainEqual({
      requirementId: "requirement:classification-1:applicability_assessment",
      locator: "classification.applicability_assessment",
    });
  });

  it("TC-06: rejects cross-tenant assessment access before reading classification", async () => {
    const { handler } = createHandler({ assessment: null });

    await expect(handler.execute(query())).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});
