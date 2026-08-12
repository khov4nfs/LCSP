import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_STATUSES,
  GAP_MATRIX_RESOLVER_TYPES,
  GAP_TRACE_LAYERS,
  GAP_TRACE_LIMITATION_CODES,
} from "@lcsp/contracts/evidence";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { GetGapEvidenceTraceHandler } from "./get-gap-evidence-trace.handler.js";
import { GetGapEvidenceTraceQuery } from "./get-gap-evidence-trace.query.js";

function createHandler(input?: {
  assessment?: object | null;
  classification?: object | null;
  legalRuleMatch?: object | null;
  verifiedProfile?: object | null;
  technicalEvidenceReport?: object | null;
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
            ? acceptedMatch()
            : input.legalRuleMatch,
        ),
    },
    verifiedProfile: {
      findFirst: jest.fn<() => Promise<object | null>>().mockResolvedValue(
        input?.verifiedProfile === undefined
          ? {
              id: "verified-profile-1",
              technicalEvidenceReportId: "report-1",
            }
          : input.verifiedProfile,
      ),
    },
    technicalEvidenceReport: {
      findFirst: jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue(
          input?.technicalEvidenceReport === undefined
            ? { id: "report-1" }
            : input.technicalEvidenceReport,
        ),
    },
  } as unknown as PrismaService;
  const write = jest
    .fn<AuditWriterService["write"]>()
    .mockResolvedValue(undefined);
  return {
    handler: new GetGapEvidenceTraceHandler(prisma, {
      write,
    } as unknown as AuditWriterService),
    write,
  };
}

function query(rowRef = "gap-row:classification-1:applicability_assessment") {
  return new GetGapEvidenceTraceQuery(
    "assessment-1",
    "organization-1",
    { rowRef },
    "user-1",
    "correlation-1",
  );
}

function acceptedClassification(input?: {
  classificationData?: unknown;
  legalRuleMatchId?: string | null;
  verifiedProfileId?: string | null;
}) {
  return {
    id: "classification-1",
    legalRuleMatchId: input?.legalRuleMatchId ?? "match-1",
    verifiedProfileId: input?.verifiedProfileId ?? "verified-profile-1",
    classificationData: input?.classificationData ?? {
      applicability_assessment: "applicable",
      risk_level: "HIGH",
      citation_basis: ["citation:chunk_allow_1"],
    },
    guardrailStatus: "PASSED",
  };
}

function acceptedMatch(input?: {
  citationAllowlist?: unknown;
  overallCoverageStatus?: string;
}) {
  return {
    id: "match-1",
    verifiedProfileId: "verified-profile-1",
    citationAllowlist: input?.citationAllowlist ?? ["citation:chunk_allow_1"],
    overallCoverageStatus: input?.overallCoverageStatus ?? "COMPLETE_CITATION",
  };
}

describe("GetGapEvidenceTraceHandler", () => {
  it("TC-01: returns a stable collect-evidence trace for a technical-evidence backed row", async () => {
    const { handler, write } = createHandler();

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.ready);
    expect(response.coverageState).toBe(
      AGENTIC_TOOL_COVERAGE_STATES.sufficient,
    );
    expect(response.result.resolverType).toBe(
      GAP_MATRIX_RESOLVER_TYPES.collectEvidence,
    );
    expect(response.result.layers.map((layer) => layer.layer)).toEqual([
      GAP_TRACE_LAYERS.technicalEvidence,
      GAP_TRACE_LAYERS.verifiedProfile,
      GAP_TRACE_LAYERS.legalRuleMatch,
      GAP_TRACE_LAYERS.classificationResult,
    ]);
    expect(JSON.stringify(write.mock.calls)).toContain("outputHash");
  });

  it("TC-02: returns review-citations trace for invalid citation provenance", async () => {
    const { handler } = createHandler({
      classification: acceptedClassification({
        classificationData: { citation_basis: ["citation:chunk_unknown_1"] },
      }),
    });

    const response = await handler.execute(
      query("gap-row:classification-1:citation_basis"),
    );

    expect(response.result.resolverType).toBe(
      GAP_MATRIX_RESOLVER_TYPES.reviewCitations,
    );
    expect(response.result.layers[0]?.layer).toBe(GAP_TRACE_LAYERS.citationSet);
  });

  it("TC-03: returns refresh-classification trace for malformed row source", async () => {
    const { handler } = createHandler({
      classification: acceptedClassification({
        classificationData: { applicability_assessment: { nested: true } },
      }),
    });

    const response = await handler.execute(query());

    expect(response.result.resolverType).toBe(
      GAP_MATRIX_RESOLVER_TYPES.refreshClassification,
    );
    expect(response.result.layers.map((layer) => layer.layer)).toEqual([
      GAP_TRACE_LAYERS.classificationResult,
      GAP_TRACE_LAYERS.verifiedProfile,
    ]);
  });

  it("TC-04: reports limited provenance when legal match coverage is incomplete", async () => {
    const { handler } = createHandler({
      legalRuleMatch: acceptedMatch({
        overallCoverageStatus: "PARTIAL_CITATION",
      }),
    });

    const response = await handler.execute(query());

    expect(response.coverageState).toBe(AGENTIC_TOOL_COVERAGE_STATES.limited);
    expect(response.limitations[0]?.code).toBe(
      GAP_TRACE_LIMITATION_CODES.provenanceLimited,
    );
  });

  it("TC-05: returns not found when the gap row cannot be resolved", async () => {
    const { handler } = createHandler({ classification: null });

    await expect(handler.execute(query())).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it("TC-06: rejects malformed row refs", async () => {
    const { handler } = createHandler();

    await expect(
      handler.execute(query("gap-row:classification-1")),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it("TC-07: maps legacy system_type row refs to applicability assessment traces", async () => {
    const { handler } = createHandler({
      classification: acceptedClassification({
        classificationData: {
          system_type: "HIGH_IMPACT_AI",
          risk_level: "HIGH",
          citation_basis: ["citation:chunk_allow_1"],
        },
      }),
    });

    const response = await handler.execute(
      query("gap-row:classification-1:system_type"),
    );

    expect(response.result.resolverType).toBe(
      GAP_MATRIX_RESOLVER_TYPES.collectEvidence,
    );
  });
});
