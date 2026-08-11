import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import {
  AGENTIC_TOOL_STATUSES,
  CLASSIFICATION_PROPOSAL_NEXT_STATES,
  CLASSIFICATION_PROPOSAL_VERDICTS,
  CLASSIFICATION_PROPOSAL_VIOLATION_CODES,
} from "@lcsp/contracts/evidence";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { ValidateClassificationProposalHandler } from "./validate-classification-proposal.handler.js";
import { ValidateClassificationProposalQuery } from "./validate-classification-proposal.query.js";

function createHandler(input?: {
  assessment?: object | null;
  legalRuleMatch?: object | null;
  classificationResult?: object | null;
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
    legalRuleMatch: {
      findFirst: jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue(
          input?.legalRuleMatch === undefined
            ? acceptedRuleMatch()
            : input.legalRuleMatch,
        ),
    },
    classificationResult: {
      findUnique: jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue(input?.classificationResult ?? null),
    },
  } as unknown as PrismaService;
  const write = jest
    .fn<AuditWriterService["write"]>()
    .mockResolvedValue(undefined);
  return {
    handler: new ValidateClassificationProposalHandler(prisma, {
      write,
    } as unknown as AuditWriterService),
    prisma,
    write,
  };
}

function query(input?: { candidateLabel?: string; citationRefs?: string[] }) {
  return new ValidateClassificationProposalQuery(
    "assessment-1",
    "organization-1",
    {
      baselineRef: "baseline:match-1",
      candidateLabel: input?.candidateLabel ?? "CLASSIFICATION_CANDIDATE_A",
      citationRefs: input?.citationRefs ?? ["citation:chunk_allowed1"],
    },
    "user-1",
    "policy-1",
    "1",
    "correlation-1",
  );
}

function acceptedRuleMatch(input?: {
  citationAllowlist?: unknown;
  overallCoverageStatus?: string;
  guardrailStatus?: string;
  blockedReason?: string | null;
}) {
  return {
    id: "match-1",
    citationAllowlist: input?.citationAllowlist ?? ["chunk_allowed1"],
    overallCoverageStatus: input?.overallCoverageStatus ?? "COMPLETE_CITATION",
    guardrailStatus: input?.guardrailStatus ?? "PASSED",
    blockedReason: input?.blockedReason ?? null,
  };
}

describe("ValidateClassificationProposalHandler", () => {
  it("TC-01: passes an eligible candidate with allow-listed citations and writes safe audit metadata", async () => {
    const { handler, write } = createHandler();

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.ready);
    expect(response.result.proposalGateRef).toMatch(/^classification-gate:/);
    expect(response.result.verdict).toBe(CLASSIFICATION_PROPOSAL_VERDICTS.pass);
    expect(response.result.allowedNextState).toBe(
      CLASSIFICATION_PROPOSAL_NEXT_STATES.readyForIndependentReview,
    );
    expect(response.result.violations).toEqual([]);
    expect(JSON.stringify(write.mock.calls)).toContain("proposalHash");
    expect(JSON.stringify(write.mock.calls)).not.toContain(
      "classificationData",
    );
  });

  it("TC-02: returns a proposal FAIL for unsupported labels or citations without creating state", async () => {
    const { handler, prisma } = createHandler();

    const response = await handler.execute(
      query({
        candidateLabel: "CLASSIFICATION_CANDIDATE_B",
        citationRefs: ["citation:chunk_unknown1"],
      }),
    );

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.ready);
    expect(response.result.verdict).toBe(CLASSIFICATION_PROPOSAL_VERDICTS.fail);
    expect(response.result.allowedNextState).toBeNull();
    expect(response.result.violations.map(({ code }) => code)).toEqual([
      CLASSIFICATION_PROPOSAL_VIOLATION_CODES.labelNotEligible,
      CLASSIFICATION_PROPOSAL_VIOLATION_CODES.citationOutOfAllowlist,
    ]);
    expect(
      "create" in
        (prisma.classificationResult as unknown as Record<string, unknown>),
    ).toBe(false);
  });

  it("TC-03: reports unresolved baseline as typed missing input", async () => {
    const { handler } = createHandler({ legalRuleMatch: null });

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.needsInput);
    expect(response.limitations[0]?.code).toBe(
      CLASSIFICATION_PROPOSAL_VIOLATION_CODES.baselineUnavailable,
    );
    expect(response.result.verdict).toBe(CLASSIFICATION_PROPOSAL_VERDICTS.fail);
  });

  it("TC-04: reports guardrail-blocked baseline as conflict", async () => {
    const { handler } = createHandler({
      legalRuleMatch: acceptedRuleMatch({
        guardrailStatus: "BLOCKED",
        blockedReason: "NO_CITATION_BASIS",
      }),
    });

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.conflict);
    expect(response.limitations[0]?.code).toBe(
      CLASSIFICATION_PROPOSAL_VIOLATION_CODES.guardrailBlocked,
    );
  });

  it("TC-05: reports partial citation coverage as out-of-coverage", async () => {
    const { handler } = createHandler({
      legalRuleMatch: acceptedRuleMatch({
        overallCoverageStatus: "PARTIAL_CITATION",
      }),
    });

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.outOfCoverage);
    expect(response.limitations[0]?.code).toBe(
      CLASSIFICATION_PROPOSAL_VIOLATION_CODES.citationCoverageLimited,
    );
  });

  it("TC-06: rejects duplicate classification result as a proposal failure", async () => {
    const { handler } = createHandler({
      classificationResult: { id: "classification-1" },
    });

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.ready);
    expect(response.result.verdict).toBe(CLASSIFICATION_PROPOSAL_VERDICTS.fail);
    expect(response.result.violations[0]?.code).toBe(
      CLASSIFICATION_PROPOSAL_VIOLATION_CODES.resultAlreadyExists,
    );
  });

  it("TC-07: does not resolve baseline state when assessment ownership fails", async () => {
    const { handler } = createHandler({ assessment: null });

    await expect(handler.execute(query())).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});
