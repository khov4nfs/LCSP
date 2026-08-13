import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import { VerifiedProfileStatus } from "@prisma/client";
import {
  AGENTIC_TOOL_NAMES,
  VERIFIED_PROFILE_REQUIRED_FOR,
  VERIFIED_PROFILE_REVIEW_STATES,
} from "@lcsp/contracts/evidence";
import { SCAN_ERROR_CODES } from "@lcsp/contracts/scan";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { GetVerifiedProfileHandler } from "./get-verified-profile.handler.js";
import { GetVerifiedProfileQuery } from "./get-verified-profile.query.js";

function buildHandler(input?: {
  profile?: object | null;
  pendingConflicts?: number;
}) {
  const defaultProfile = {
    id: "vp-1",
    version: 3,
    aiUsageFlowId: "flow-1",
    status: VerifiedProfileStatus.APPROVED,
    approvedAt: new Date("2026-08-12T00:00:00.000Z"),
    profileData: {
      verified_claims: [
        {
          claim_category: "MODEL_PROVIDER_USAGE",
          claim_value: { providers: ["openai"], prompt: "must never leak" },
          evidence_refs: ["finding:provider-1"],
        },
        {
          claim_category: "HUMAN_REVIEW",
          claim_value: { deploymentCategories: ["workload"] },
          evidence_refs: ["review:1"],
        },
      ],
      fact_evidence_refs: ["finding:provider-1", "review:1"],
      merged_profile: { businessProcess: "must never leak" },
    },
  };
  const findFirst = jest
    .fn()
    .mockImplementation(() =>
      Promise.resolve(
        input && "profile" in input ? input.profile : defaultProfile,
      ),
    );
  const count = jest
    .fn<() => Promise<number>>()
    .mockImplementation(() => Promise.resolve(input?.pendingConflicts ?? 0));
  const prisma = {
    verifiedProfile: { findFirst },
    conflictRecord: { count },
  } as unknown as PrismaService;
  const write = jest
    .fn<AuditWriterService["write"]>()
    .mockImplementation(() => Promise.resolve());
  const audit = { write } as unknown as AuditWriterService;
  return {
    handler: new GetVerifiedProfileHandler(prisma, audit),
    findFirst,
    count,
    write,
  };
}

function query(expectedVersion = "3") {
  return new GetVerifiedProfileQuery(
    "assessment-1",
    "org-1",
    "vp-1",
    expectedVersion,
    VERIFIED_PROFILE_REQUIRED_FOR.legalMatching,
    "corr-1",
  );
}

describe("GetVerifiedProfileHandler", () => {
  it("TC-01/TC-04: returns only approved, typed facts and safe refs", async () => {
    const { handler, write } = buildHandler();

    const response = await handler.execute(query());

    expect(response.tool_name).toBe(AGENTIC_TOOL_NAMES.getVerifiedProfile);
    expect(response.result).toMatchObject({
      profile_ref: "verified:vp-1",
      version: "3",
      legal_safe_facts: {
        aiUsageTypes: ["HUMAN_REVIEW", "MODEL_PROVIDER_USAGE"],
        providers: ["OPENAI"],
        reviewState: VERIFIED_PROFILE_REVIEW_STATES.present,
        deploymentCategories: ["WORKLOAD"],
      },
      fact_evidence_refs: ["finding:provider-1", "review:1"],
    });
    expect(JSON.stringify(response)).not.toContain("must never leak");
    expect(JSON.stringify(write.mock.calls)).toContain(
      VERIFIED_PROFILE_REQUIRED_FOR.legalMatching,
    );
  });

  it.each([
    [
      "version mismatch",
      { version: 2 },
      0,
      SCAN_ERROR_CODES.verifiedProfileWrongState,
    ],
    [
      "pending profile",
      { status: VerifiedProfileStatus.PENDING_APPROVAL },
      0,
      SCAN_ERROR_CODES.verifiedProfileWrongState,
    ],
    ["open conflict", {}, 1, SCAN_ERROR_CODES.pendingConflictsExist],
  ])("TC-02: blocks %s", async (_name, profile, pendingConflicts, code) => {
    const base = {
      id: "vp-1",
      version: 3,
      aiUsageFlowId: "flow-1",
      status: VerifiedProfileStatus.APPROVED,
      approvedAt: new Date(),
      profileData: {},
    };
    const { handler } = buildHandler({
      profile: { ...base, ...profile },
      pendingConflicts,
    });

    let thrown: unknown;
    try {
      await handler.execute(query());
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getResponse()).toMatchObject({
      problem: { code },
    });
  });

  it("TC-03: tenant/assessment isolation is a not-found result", async () => {
    const { handler, findFirst } = buildHandler({ profile: null });

    await expect(handler.execute(query())).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(JSON.stringify(findFirst.mock.calls)).toContain("assessment-1");
    expect(JSON.stringify(findFirst.mock.calls)).toContain("org-1");
  });
});
