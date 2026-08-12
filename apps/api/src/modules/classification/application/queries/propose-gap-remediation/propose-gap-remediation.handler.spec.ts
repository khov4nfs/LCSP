import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_STATUSES,
  GAP_REMEDIATION_LIMITATION_CODES,
  GAP_REMEDIATION_TEMPLATE_IDS,
} from "@lcsp/contracts/evidence";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { ProposeGapRemediationHandler } from "./propose-gap-remediation.handler.js";
import { ProposeGapRemediationQuery } from "./propose-gap-remediation.query.js";

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
      findFirst: jest.fn<() => Promise<object | null>>().mockResolvedValue(
        input?.classification === undefined
          ? {
              id: "classification-1",
              legalRuleMatchId: "match-1",
              classificationData: {
                system_type: "HIGH_IMPACT_AI",
                citation_basis: ["citation:chunk_allow_1"],
              },
              guardrailStatus: "PASSED",
            }
          : input.classification,
      ),
    },
    legalRuleMatch: {
      findFirst: jest.fn<() => Promise<object | null>>().mockResolvedValue(
        input?.legalRuleMatch === undefined
          ? {
              citationAllowlist: ["citation:chunk_allow_1"],
              overallCoverageStatus: "COMPLETE_CITATION",
              guardrailStatus: "PASSED",
            }
          : input.legalRuleMatch,
      ),
    },
  } as unknown as PrismaService;

  return {
    handler: new ProposeGapRemediationHandler(prisma, {
      write: jest
        .fn<AuditWriterService["write"]>()
        .mockResolvedValue(undefined),
    } as unknown as AuditWriterService),
  };
}

function query(
  rowRef = "gap-row:classification-1:system_type",
  templateId = GAP_REMEDIATION_TEMPLATE_IDS.collectEvidence,
) {
  return new ProposeGapRemediationQuery(
    "assessment-1",
    "organization-1",
    { rowRef, templateId },
    "user-1",
    "correlation-1",
  );
}

describe("ProposeGapRemediationHandler", () => {
  it("TC-01: returns a bounded proposal for a missing row", async () => {
    const { handler } = createHandler();

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.ready);
    expect(response.coverageState).toBe(
      AGENTIC_TOOL_COVERAGE_STATES.sufficient,
    );
    expect(response.result.templateId).toBe(
      GAP_REMEDIATION_TEMPLATE_IDS.collectEvidence,
    );
    expect(response.result.requiredIndependentValidation).toBe(true);
  });

  it("TC-02: blocks a stale satisfied row from self-closing", async () => {
    const { handler } = createHandler();

    const response = await handler.execute(
      query(
        "gap-row:classification-1:citation_basis",
        GAP_REMEDIATION_TEMPLATE_IDS.collectEvidence,
      ),
    );

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.blocked);
    expect(response.limitations[0]?.code).toBe(
      GAP_REMEDIATION_LIMITATION_CODES.staleSatisfiedRow,
    );
  });

  it("TC-03: blocks templates that are not allowed for the current row state", async () => {
    const { handler } = createHandler();

    const response = await handler.execute(
      query(
        "gap-row:classification-1:system_type",
        GAP_REMEDIATION_TEMPLATE_IDS.resolveConflict,
      ),
    );

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.blocked);
    expect(response.limitations[0]?.code).toBe(
      GAP_REMEDIATION_LIMITATION_CODES.templateNotAllowed,
    );
  });

  it("TC-04: returns a deterministic proposal ref on replay", async () => {
    const { handler } = createHandler();

    const first = await handler.execute(query());
    const second = await handler.execute(query());

    expect(first.result.proposalRef).toBe(second.result.proposalRef);
  });

  it("TC-05: returns NEEDS_INPUT when the row cannot be resolved", async () => {
    const { handler } = createHandler({ classification: null });

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.needsInput);
    expect(response.limitations[0]?.code).toBe(
      GAP_REMEDIATION_LIMITATION_CODES.rowUnavailable,
    );
  });

  it("TC-06: rejects malformed row refs", async () => {
    const { handler } = createHandler();

    await expect(
      handler.execute(query("gap-row:classification-1")),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
