import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import { ClassificationGuardrailStatus } from "@prisma/client";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_STATUSES,
  GAP_MATRIX_LIMITATION_CODES,
  GAP_MATRIX_RATIONALE_CODES,
  GAP_MATRIX_RESOLVER_TYPES,
  GAP_MATRIX_ROW_STATUSES,
} from "@lcsp/contracts/evidence";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { EvaluateGapMatrixHandler } from "./evaluate-gap-matrix.handler.js";
import { EvaluateGapMatrixQuery } from "./evaluate-gap-matrix.query.js";

function createHandler(input?: {
  assessment?: object | null;
  classification?: object | null;
  legalRuleMatch?: object | null;
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
    legalRuleMatch: {
      findFirst: jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue(
          input?.legalRuleMatch === undefined
            ? acceptedRuleMatch()
            : input.legalRuleMatch,
        ),
    },
  } as unknown as PrismaService;
  const write = jest
    .fn<AuditWriterService["write"]>()
    .mockResolvedValue(undefined);
  return {
    handler: new EvaluateGapMatrixHandler(prisma, {
      write,
    } as unknown as AuditWriterService),
    write,
  };
}

function query(input?: { evidenceRefs?: string[]; matrixRef?: string }) {
  return new EvaluateGapMatrixQuery(
    "assessment-1",
    {
      matrixRef: input?.matrixRef ?? "matrix:classification-1",
      evidenceRefs: input?.evidenceRefs ?? ["citation:chunk_allow_1"],
    },
    "user-1",
    "correlation-1",
  );
}

function acceptedClassification(input?: {
  classificationData?: unknown;
  guardrailStatus?: string;
  blockedReason?: string | null;
  legalRuleMatchId?: string | null;
}) {
  return {
    id: "classification-1",
    legalRuleMatchId: input?.legalRuleMatchId ?? "match-1",
    verifiedProfileId: "verified-profile-1",
    classificationData: input?.classificationData ?? {
      applicability_assessment: "applicable",
      risk_level: "HIGH",
      citation_basis: ["citation:chunk_allow_1"],
    },
    guardrailStatus: input?.guardrailStatus ?? "PASSED",
    blockedReason: input?.blockedReason ?? null,
  };
}

function acceptedRuleMatch(input?: {
  citationAllowlist?: unknown;
  overallCoverageStatus?: string;
  guardrailStatus?: string;
  blockedReason?: string | null;
}) {
  return {
    id: "match-1",
    verifiedProfileId: "verified-profile-1",
    citationAllowlist: input?.citationAllowlist ?? ["citation:chunk_allow_1"],
    overallCoverageStatus: input?.overallCoverageStatus ?? "COMPLETE_CITATION",
    guardrailStatus: input?.guardrailStatus ?? "PASSED",
    blockedReason: input?.blockedReason ?? null,
  };
}

describe("EvaluateGapMatrixHandler", () => {
  it("TC-01: returns SATISFIED rows when classification fields are backed by allow-listed evidence", async () => {
    const { handler, write } = createHandler();

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.ready);
    expect(response.coverageState).toBe(
      AGENTIC_TOOL_COVERAGE_STATES.sufficient,
    );
    expect(response.result.rows.map((row) => row.status)).toEqual([
      GAP_MATRIX_ROW_STATUSES.satisfied,
      GAP_MATRIX_ROW_STATUSES.satisfied,
      GAP_MATRIX_ROW_STATUSES.satisfied,
    ]);
    expect(response.result.rows[0]?.resolverType).toBe(
      GAP_MATRIX_RESOLVER_TYPES.collectEvidence,
    );
    expect(JSON.stringify(write.mock.calls)).toContain("outputHash");
    expect(JSON.stringify(write.mock.calls)).not.toContain(
      "classificationData",
    );
  });

  it("TC-02: returns MISSING for absent classification fields with no verified evidence", async () => {
    const { handler } = createHandler({
      classification: acceptedClassification({
        classificationData: {
          applicability_assessment: null,
          risk_level: null,
          citation_basis: [],
        },
      }),
    });

    const response = await handler.execute(query());

    expect(response.result.rows.map((row) => row.status)).toEqual([
      GAP_MATRIX_ROW_STATUSES.missing,
      GAP_MATRIX_ROW_STATUSES.missing,
      GAP_MATRIX_ROW_STATUSES.missing,
    ]);
    expect(response.result.rows[0]?.rationaleCode).toBe(
      GAP_MATRIX_RATIONALE_CODES.noVerifiedEvidence,
    );
  });

  it("TC-03: returns OUT_OF_COVERAGE when legal match coverage is partial", async () => {
    const { handler } = createHandler({
      legalRuleMatch: acceptedRuleMatch({
        overallCoverageStatus: "PARTIAL_CITATION",
      }),
    });

    const response = await handler.execute(query());

    expect(response.coverageState).toBe(AGENTIC_TOOL_COVERAGE_STATES.partial);
    expect(
      response.result.rows.every(
        (row) => row.status === GAP_MATRIX_ROW_STATUSES.outOfCoverage,
      ),
    ).toBe(true);
    expect(response.result.rows[0]?.rationaleCode).toBe(
      GAP_MATRIX_RATIONALE_CODES.coverageLimited,
    );
  });

  it("TC-04: returns CONTRADICTED when supplied evidence falls outside the citation allow-list", async () => {
    const { handler } = createHandler();

    const response = await handler.execute(
      query({ evidenceRefs: ["citation:chunk_other_1"] }),
    );

    expect(response.result.rows[0]?.status).toBe(
      GAP_MATRIX_ROW_STATUSES.contradicted,
    );
    expect(response.result.rows[2]?.status).toBe(
      GAP_MATRIX_ROW_STATUSES.contradicted,
    );
    expect(response.result.rows[0]?.resolverType).toBe(
      GAP_MATRIX_RESOLVER_TYPES.reviewCitations,
    );
  });

  it("TC-05: returns UNKNOWN for malformed non-null classification fields", async () => {
    const { handler } = createHandler({
      classification: acceptedClassification({
        classificationData: {
          applicability_assessment: { nested: true },
          risk_level: ["HIGH"],
          citation_basis: "citation:chunk_allow_1",
        },
      }),
    });

    const response = await handler.execute(query());

    expect(response.result.rows.map((row) => row.status)).toEqual([
      GAP_MATRIX_ROW_STATUSES.unknown,
      GAP_MATRIX_ROW_STATUSES.unknown,
      GAP_MATRIX_ROW_STATUSES.unknown,
    ]);
    expect(response.result.rows[0]?.resolverType).toBe(
      GAP_MATRIX_RESOLVER_TYPES.refreshClassification,
    );
  });

  it("TC-06: reports unresolved matrix refs as typed missing input", async () => {
    const { handler } = createHandler({ classification: null });

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.needsInput);
    expect(response.limitations[0]?.code).toBe(
      GAP_MATRIX_LIMITATION_CODES.matrixUnavailable,
    );
  });

  it("TC-07: blocks guardrail-blocked classifications", async () => {
    const { handler } = createHandler({
      classification: acceptedClassification({
        guardrailStatus: ClassificationGuardrailStatus.BLOCKED,
        blockedReason: "NO_CITATION_BASIS",
      }),
    });

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.blocked);
    expect(response.limitations[0]?.code).toBe(
      GAP_MATRIX_LIMITATION_CODES.classificationBlocked,
    );
  });

  it("TC-08: rejects inaccessible assessments before reading matrix projections", async () => {
    const { handler } = createHandler({ assessment: null });

    await expect(handler.execute(query())).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it("TC-09: preserves compatibility for legacy system_type values", async () => {
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

    expect(response.result.rows[0]?.rowRef).toBe(
      "gap-row:classification-1:applicability_assessment",
    );
    expect(response.result.rows[0]?.status).toBe(
      GAP_MATRIX_ROW_STATUSES.satisfied,
    );
  });
});
