import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import {
  AGENTIC_TOOL_STATUSES,
  CLASSIFICATION_BASELINE_LABELS,
  CLASSIFICATION_BASELINE_LIMITATION_CODES,
  CLASSIFICATION_BASELINE_PREREQUISITES,
} from "@lcsp/contracts/evidence";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { GetClassificationBaselineHandler } from "./get-classification-baseline.handler.js";
import { GetClassificationBaselineQuery } from "./get-classification-baseline.query.js";

function createHandler(input?: {
  assessment?: object | null;
  verifiedProfile?: object | null;
  legalRuleMatch?: object | null;
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
    verifiedProfile: {
      findFirst: jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue(
          input?.verifiedProfile === undefined
            ? { id: "verified-profile-1" }
            : input.verifiedProfile,
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
    authPolicy: {
      findFirst: jest
        .fn<() => Promise<{ actions: string[] } | null>>()
        .mockResolvedValue(
          input?.authPolicy === undefined
            ? { actions: [PBAC_ACTIONS.classificationRun] }
            : input.authPolicy,
        ),
    },
  } as unknown as PrismaService;
  const write = jest
    .fn<AuditWriterService["write"]>()
    .mockResolvedValue(undefined);
  return {
    handler: new GetClassificationBaselineHandler(prisma, {
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
  return new GetClassificationBaselineQuery(
    "assessment-1",
    "organization-1",
    {
      verifiedProfileId: "profile_verified-profile-1",
      ruleMatchRef: "rule-match:match-1",
      policyProfileVersionId:
        input?.policyProfileVersionId ?? "policy_policy-1_2026-07-29",
    },
    "user-1",
    input?.policyId === undefined ? "policy-1" : input.policyId,
    input?.policyVersion === undefined ? "2026-07-29" : input.policyVersion,
    "correlation-1",
  );
}

function acceptedRuleMatch(input?: {
  overallCoverageStatus?: string;
  guardrailStatus?: string;
  blockedReason?: string | null;
}) {
  return {
    id: "match-1",
    verifiedProfileId: "verified-profile-1",
    assessmentId: "assessment-1",
    organizationId: "organization-1",
    overallCoverageStatus: input?.overallCoverageStatus ?? "COMPLETE_CITATION",
    guardrailStatus: input?.guardrailStatus ?? "PASSED",
    blockedReason: input?.blockedReason ?? null,
  };
}

describe("GetClassificationBaselineHandler", () => {
  it("TC-01: returns a deterministic baseline ledger without persisting classification", async () => {
    const { handler, write } = createHandler();

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.ready);
    expect(response.result.baselineRef).toBe("baseline:match-1");
    expect(response.result.eligibleLabels).toEqual([
      CLASSIFICATION_BASELINE_LABELS.candidateA,
    ]);
    expect(response.result.unmetPrerequisites).toEqual([]);
    expect(response.evidenceRefs).toEqual(["rule-match:match-1"]);
    expect(JSON.stringify(write.mock.calls)).toContain("outputHash");
    expect(JSON.stringify(write.mock.calls)).not.toContain("profileData");
  });

  it("TC-02: blocks stale or mismatched policy pins", async () => {
    const { handler } = createHandler();

    const response = await handler.execute(
      query({ policyProfileVersionId: "policy_other_2026-07-29" }),
    );

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.blocked);
    expect(response.limitations[0]?.code).toBe(
      CLASSIFICATION_BASELINE_LIMITATION_CODES.policyUnavailable,
    );
    expect(response.result.unmetPrerequisites).toContain(
      CLASSIFICATION_BASELINE_PREREQUISITES.policyProfilePinned,
    );
  });

  it("TC-03: reports missing accepted rule match as typed input", async () => {
    const { handler } = createHandler({ legalRuleMatch: null });

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.needsInput);
    expect(response.limitations[0]?.code).toBe(
      CLASSIFICATION_BASELINE_LIMITATION_CODES.ruleMatchUnavailable,
    );
    expect(response.result.baselineRef).toBeNull();
  });

  it("TC-04: reports guardrail-blocked rule matches as conflict", async () => {
    const { handler } = createHandler({
      legalRuleMatch: acceptedRuleMatch({
        guardrailStatus: "BLOCKED",
        blockedReason: "NO_CITATION_BASIS",
      }),
    });

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.conflict);
    expect(response.limitations[0]?.code).toBe(
      CLASSIFICATION_BASELINE_LIMITATION_CODES.guardrailBlocked,
    );
    expect(response.result.eligibleLabels).toEqual([]);
  });

  it("TC-05: reports partial citation coverage without authorizing a label", async () => {
    const { handler } = createHandler({
      legalRuleMatch: acceptedRuleMatch({
        overallCoverageStatus: "PARTIAL_CITATION",
      }),
    });

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.outOfCoverage);
    expect(response.limitations[0]?.code).toBe(
      CLASSIFICATION_BASELINE_LIMITATION_CODES.coverageLimited,
    );
    expect(response.result.eligibleLabels).toEqual([]);
  });

  it("TC-06: does not inspect artifacts when assessment ownership fails", async () => {
    const { handler } = createHandler({ assessment: null });

    await expect(handler.execute(query())).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});
