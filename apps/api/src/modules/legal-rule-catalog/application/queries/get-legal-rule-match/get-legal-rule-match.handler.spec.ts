import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import {
  AGENTIC_TOOL_STATUSES,
  LEGAL_RULE_MATCH_APPLICABILITY,
  LEGAL_RULE_MATCH_LIMITATION_CODES,
} from "@lcsp/contracts/evidence";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { GetLegalRuleMatchHandler } from "./get-legal-rule-match.handler.js";
import { GetLegalRuleMatchQuery } from "./get-legal-rule-match.query.js";

function createHandler(input?: {
  assessment?: object | null;
  verifiedProfile?: object | null;
  rule?: object | null;
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
    verifiedProfile: {
      findFirst: jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue(
          input?.verifiedProfile === undefined
            ? { id: "verified-profile-1" }
            : input.verifiedProfile,
        ),
    },
    legalRule: {
      findFirst: jest
        .fn<() => Promise<object | null>>()
        .mockResolvedValue(
          input?.rule === undefined ? approvedRule() : input.rule,
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
    handler: new GetLegalRuleMatchHandler(prisma, {
      write,
    } as unknown as AuditWriterService),
    prisma,
    write,
  };
}

function query(citationRefs = ["citation:chunk_allowed1"]) {
  return new GetLegalRuleMatchQuery(
    "assessment-1",
    "organization-1",
    {
      verifiedProfileId: "profile_verified-profile-1",
      ruleId: "rule_ai_notice",
      citationRefs,
    },
    "user-1",
    "policy-1",
    "1",
    "correlation-1",
  );
}

function approvedRule(input?: { requiredFacts?: unknown }) {
  return {
    legalRuleId: "rule_ai_notice",
    legalRuleCatalogVersionId: "catalog-1",
    requiredFacts: input?.requiredFacts ?? ["fact:data-use", "claim:notice"],
  };
}

function acceptedRuleMatch(input?: {
  matches?: unknown;
  citationAllowlist?: unknown;
  overallCoverageStatus?: string;
  guardrailStatus?: string;
  blockedReason?: string | null;
}) {
  return {
    id: "match-1",
    corpusVersionId: "corpus-1",
    legalRuleCatalogVersionId: "catalog-1",
    matches: input?.matches ?? [
      {
        rule_id: "rule_ai_notice",
        usage_claim_ref: "claim:notice",
        known_facts: ["fact:data-use"],
        citation_chunk_ids: ["chunk_allowed1"],
        coverage_status: "COMPLETE_CITATION",
      },
    ],
    citationAllowlist: input?.citationAllowlist ?? ["chunk_allowed1"],
    overallCoverageStatus: input?.overallCoverageStatus ?? "COMPLETE_CITATION",
    guardrailStatus: input?.guardrailStatus ?? "PASSED",
    blockedReason: input?.blockedReason ?? null,
  };
}

describe("GetLegalRuleMatchHandler", () => {
  it("TC-01: returns a sanitized accepted rule match and records safe audit metadata", async () => {
    const { handler, write } = createHandler();

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.ready);
    expect(response.result.legalRuleMatchId).toBe("legal_rule_match_match-1");
    expect(response.result.applicability).toBe(
      LEGAL_RULE_MATCH_APPLICABILITY.applicable,
    );
    expect(response.result.allowedCitationRefs).toEqual([
      "citation:chunk_allowed1",
    ]);
    expect(response.result.knownFacts).toEqual([
      "claim:notice",
      "fact:data-use",
    ]);
    expect(response.evidenceRefs).toEqual([
      "citation:chunk_allowed1",
      "legal_rule_match_match-1",
    ]);
    expect(JSON.stringify(write.mock.calls)).toContain("citationRefHash");
    expect(JSON.stringify(write.mock.calls)).not.toContain("known_facts");
  });

  it("TC-02: reports missing accepted match as typed missing input", async () => {
    const { handler } = createHandler({ legalRuleMatch: null });

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.needsInput);
    expect(response.limitations[0]?.code).toBe(
      LEGAL_RULE_MATCH_LIMITATION_CODES.noAcceptedMatch,
    );
    expect(response.result.legalRuleMatchId).toBeNull();
  });

  it("TC-03: fails closed when requested citations are outside the allowlist", async () => {
    const { handler } = createHandler();

    const response = await handler.execute(query(["citation:chunk_unknown"]));

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.blocked);
    expect(response.limitations[0]?.code).toBe(
      LEGAL_RULE_MATCH_LIMITATION_CODES.citationMismatch,
    );
  });

  it("TC-04: reports guardrail-blocked matches as conflicts without profile payload", async () => {
    const { handler, write } = createHandler({
      legalRuleMatch: acceptedRuleMatch({
        guardrailStatus: "BLOCKED",
        blockedReason: "NO_CITATION_BASIS",
      }),
    });

    const response = await handler.execute(query());

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.conflict);
    expect(response.result.applicability).toBe(
      LEGAL_RULE_MATCH_APPLICABILITY.unavailable,
    );
    expect(JSON.stringify(write.mock.calls)).not.toContain("profileData");
  });

  it("TC-05: does not resolve rule-match state when assessment ownership fails", async () => {
    const { handler } = createHandler({ assessment: null });

    await expect(handler.execute(query())).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});
