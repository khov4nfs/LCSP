import { describe, expect, it, jest } from "@jest/globals";
import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import { OUTBOX_AGGREGATE_TYPES } from "@lcsp/contracts/outbox";
import {
  LEGAL_RULE_MATCH_GUARDRAIL_STATUSES,
  OVERALL_COVERAGE_STATUSES,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
} from "@lcsp/contracts/scan";
import {
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";

import { toPrismaOverallCoverageStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import type { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import type { AssessmentRuntimeEventService } from "../../../../../platform/runtime-events/assessment-runtime-event.service.js";
import type { AcceptLegalRuleMatchDto } from "../../contracts/classification/legal-rule-match-callback.contract.js";
import { CitationGuardrailService } from "../../services/classification/citation-guardrail.service.js";
import { AcceptLegalRuleMatchCommand } from "./accept-legal-rule-match.command.js";
import { AcceptLegalRuleMatchHandler } from "./accept-legal-rule-match.handler.js";

type VerifiedProfileRecord = {
  id: string;
  assessmentId: string;
  organizationId: string;
};

type FindApprovedVersionArgs = {
  where?: {
    id?: string;
  };
};

describe("AcceptLegalRuleMatchHandler", () => {
  let handler: AcceptLegalRuleMatchHandler;
  let prisma: jest.Mocked<PrismaService>;
  let citationGuardrail: CitationGuardrailService;
  let mockFindFirstVerifiedProfile: jest.Mock<
    (args: unknown) => Promise<VerifiedProfileRecord | null>
  >;
  let mockFindApprovedCorpus: jest.Mock<
    (args: FindApprovedVersionArgs) => Promise<{ id: string } | null>
  >;
  let mockFindApprovedCatalog: jest.Mock<
    (args: FindApprovedVersionArgs) => Promise<{ id: string } | null>
  >;
  let mockCreateLegalRuleMatch: jest.Mock<
    (args: { data: unknown }) => Promise<unknown>
  >;
  let mockEnqueueOutbox: jest.Mock<
    (event: unknown, tx: unknown) => Promise<void>
  >;
  let mockWriteAuditInTx: jest.Mock<
    (event: unknown, tx: unknown) => Promise<void>
  >;
  let mockRecordToolCompleted: jest.Mock<(event: unknown) => Promise<void>>;

  const validPayload: AcceptLegalRuleMatchDto = {
    verified_profile_id: "vp-123",
    assessment_id: "asm-123",
    corpus_version_id: "LCSP-LEGAL-CORPUS-v0.1.0",
    legal_rule_catalog_version_id: "LCSP-RULE-CATALOG-v0.1.0",
    schema_version: "1.0.0",
    citation_allowlist: ["chunk-1", "chunk-2"],
    overall_coverage_status: OVERALL_COVERAGE_STATUSES.completeCitation,
    matches: [
      {
        match_id: "match-1",
        rule_id: "rule-1",
        legal_rule_catalog_version_id: "LCSP-RULE-CATALOG-v0.1.0",
        article_ref: "Art. 1",
        clause_ref: "Cl. 2",
        match_type: "PRIMARY_MATCH",
        citation_chunk_ids: ["chunk-1"],
        confidence: 0.95,
        coverage_status: OVERALL_COVERAGE_STATUSES.completeCitation,
        usage_claim_ref: "claim-1",
      },
      {
        match_id: "match-2",
        rule_id: "rule-2",
        legal_rule_catalog_version_id: "LCSP-RULE-CATALOG-v0.1.0",
        article_ref: "Art. 3",
        clause_ref: "Cl. 4",
        match_type: "REFERENCED_CONTEXT",
        citation_chunk_ids: ["chunk-2"],
        confidence: 0.85,
        coverage_status: OVERALL_COVERAGE_STATUSES.completeCitation,
        usage_claim_ref: "claim-2",
      },
    ],
  };

  beforeEach(() => {
    mockFindFirstVerifiedProfile = jest
      .fn<(args: unknown) => Promise<VerifiedProfileRecord | null>>()
      .mockResolvedValue({
        id: "vp-123",
        assessmentId: "asm-123",
        organizationId: "org-123",
      });

    mockFindApprovedCorpus = jest
      .fn<(args: FindApprovedVersionArgs) => Promise<{ id: string } | null>>()
      .mockImplementation((args) =>
        Promise.resolve(
          args.where?.id === "unapproved-corpus-v0"
            ? null
            : { id: String(args.where?.id ?? "") },
        ),
      );

    mockFindApprovedCatalog = jest
      .fn<(args: FindApprovedVersionArgs) => Promise<{ id: string } | null>>()
      .mockImplementation((args) =>
        Promise.resolve(
          args.where?.id === "unapproved-catalog-v0"
            ? null
            : { id: String(args.where?.id ?? "") },
        ),
      );

    mockCreateLegalRuleMatch = jest
      .fn<(args: { data: unknown }) => Promise<unknown>>()
      .mockImplementation(({ data }: { data: unknown }) =>
        Promise.resolve(data),
      );
    mockEnqueueOutbox = jest
      .fn<(event: unknown, tx: unknown) => Promise<void>>()
      .mockResolvedValue(undefined);
    mockWriteAuditInTx = jest
      .fn<(event: unknown, tx: unknown) => Promise<void>>()
      .mockResolvedValue(undefined);
    mockRecordToolCompleted = jest
      .fn<(event: unknown) => Promise<void>>()
      .mockResolvedValue(undefined);

    prisma = {
      legalCorpusVersion: {
        findFirst: mockFindApprovedCorpus,
      },
      legalRuleCatalogVersion: {
        findFirst: mockFindApprovedCatalog,
      },
      verifiedProfile: {
        findFirst: mockFindFirstVerifiedProfile,
      },
      legalRuleMatch: {
        create: mockCreateLegalRuleMatch,
      },
      $transaction: jest
        .fn()
        .mockImplementation(
          async (callback: (tx: unknown) => Promise<unknown>) =>
            callback(prisma),
        ),
    } as unknown as jest.Mocked<PrismaService>;

    const auditWriter = {
      writeInTx: mockWriteAuditInTx,
    } as unknown as jest.Mocked<AuditWriterService>;

    const outboxRepository = {
      enqueue: mockEnqueueOutbox,
    } as unknown as jest.Mocked<OutboxRepository>;
    const runtimeEvents = {
      recordToolCompleted: mockRecordToolCompleted,
    } as unknown as jest.Mocked<AssessmentRuntimeEventService>;

    citationGuardrail = new CitationGuardrailService();

    handler = new AcceptLegalRuleMatchHandler(
      prisma,
      auditWriter,
      outboxRepository,
      citationGuardrail,
      runtimeEvents,
    );
  });

  it("T01: accepts valid matches with allowlisted citations and returns passed guardrail status", async () => {
    const command = new AcceptLegalRuleMatchCommand(validPayload, "corr-123");
    const result = await handler.execute(command);

    expect(result.accepted).toBe(true);
    expect(result.guardrail_status).toBe(
      LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.passed,
    );
    expect(result.correlationId).toBe("corr-123");

    expect(mockCreateLegalRuleMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verifiedProfileId: "vp-123",
          assessmentId: "asm-123",
          organizationId: "org-123",
          corpusVersionId: "LCSP-LEGAL-CORPUS-v0.1.0",
          guardrailStatus: LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.passed,
          overallCoverageStatus: toPrismaOverallCoverageStatus(
            OVERALL_COVERAGE_STATUSES.completeCitation,
          ),
        }),
      }),
    );

    expect(mockEnqueueOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: SCAN_EVENT_TYPES.legalRuleMatchReady,
        aggregateType: OUTBOX_AGGREGATE_TYPES.legalRuleMatch,
      }),
      prisma,
    );

    expect(mockWriteAuditInTx).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: SCAN_EVENT_TYPES.legalRuleMatchAcceptedAudit,
        decision: AUDIT_DECISIONS.allow,
      }),
      prisma,
    );
    expect(mockRecordToolCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "asm-123",
        stage: "LEGAL_RETRIEVAL",
        toolName: "legal_rule_match",
        outputSummary: expect.objectContaining({ matchCount: 2 }),
      }),
    );
  });

  it("T02: accepts empty matches but sets guardrail status to blocked", async () => {
    const emptyPayload: AcceptLegalRuleMatchDto = {
      ...validPayload,
      matches: [],
      overall_coverage_status: OVERALL_COVERAGE_STATUSES.noCitation,
    };
    const command = new AcceptLegalRuleMatchCommand(emptyPayload, "corr-empty");
    const result = await handler.execute(command);

    expect(result.accepted).toBe(true);
    expect(result.guardrail_status).toBe(
      LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.blocked,
    );

    expect(mockCreateLegalRuleMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          guardrailStatus: LEGAL_RULE_MATCH_GUARDRAIL_STATUSES.blocked,
          overallCoverageStatus: toPrismaOverallCoverageStatus(
            OVERALL_COVERAGE_STATUSES.noCitation,
          ),
          blockedReason: "NO_CITATION_BASIS",
        }),
      }),
    );

    expect(mockWriteAuditInTx).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: SCAN_EVENT_TYPES.legalRuleMatchBlockedAudit,
        decision: AUDIT_DECISIONS.deny,
      }),
      prisma,
    );
  });

  it("T03: rejects citation chunk not in allowlist with CITATION_OUT_OF_ALLOWLIST", async () => {
    const invalidPayload: AcceptLegalRuleMatchDto = {
      ...validPayload,
      citation_allowlist: ["chunk-1"],
    };
    const command = new AcceptLegalRuleMatchCommand(
      invalidPayload,
      "corr-fail",
    );

    await expect(handler.execute(command)).rejects.toThrow(
      UnprocessableEntityException,
    );
    try {
      await handler.execute(command);
    } catch (err: unknown) {
      const response = (err as UnprocessableEntityException).getResponse() as {
        problem: { code: string };
      };
      expect(response.problem.code).toBe(
        SCAN_ERROR_CODES.citationOutOfAllowlist,
      );
    }
  });

  it("T04: rejects unapproved corpus version with CORPUS_VERSION_NOT_APPROVED", async () => {
    const invalidPayload: AcceptLegalRuleMatchDto = {
      ...validPayload,
      corpus_version_id: "unapproved-corpus-v0",
    };
    const command = new AcceptLegalRuleMatchCommand(
      invalidPayload,
      "corr-corpus",
    );

    try {
      await handler.execute(command);
    } catch (err: unknown) {
      const response = (err as UnprocessableEntityException).getResponse() as {
        problem: { code: string };
      };
      expect(response.problem.code).toBe(
        SCAN_ERROR_CODES.corpusVersionNotApproved,
      );
    }
  });

  it("T04b: rejects unapproved rule catalog version with RULE_CATALOG_VERSION_NOT_APPROVED", async () => {
    const invalidPayload: AcceptLegalRuleMatchDto = {
      ...validPayload,
      legal_rule_catalog_version_id: "unapproved-catalog-v0",
    };
    const command = new AcceptLegalRuleMatchCommand(
      invalidPayload,
      "corr-catalog",
    );

    try {
      await handler.execute(command);
    } catch (err: unknown) {
      const response = (err as UnprocessableEntityException).getResponse() as {
        problem: { code: string };
      };
      expect(response.problem.code).toBe(
        SCAN_ERROR_CODES.ruleCatalogVersionNotApproved,
      );
    }
  });

  it("T04c: rejects citation chunk with legal_status = REPEALED with CITATION_REPEALED", async () => {
    const repealedPayload: AcceptLegalRuleMatchDto = {
      ...validPayload,
      matches: [
        {
          ...validPayload.matches[0],
          legal_status: "REPEALED",
        },
      ],
    };
    const command = new AcceptLegalRuleMatchCommand(
      repealedPayload,
      "corr-repealed",
    );

    try {
      await handler.execute(command);
    } catch (err: unknown) {
      const response = (err as UnprocessableEntityException).getResponse() as {
        problem: { code: string };
      };
      expect(response.problem.code).toBe(SCAN_ERROR_CODES.citationRepealed);
    }
  });

  it("T05: maintains distinct PRIMARY_MATCH and REFERENCED_CONTEXT match types", async () => {
    const command = new AcceptLegalRuleMatchCommand(
      validPayload,
      "corr-distinct",
    );
    await handler.execute(command);

    const firstCall = mockCreateLegalRuleMatch.mock.calls[0] as [
      { data: { matches: AcceptLegalRuleMatchDto["matches"] } },
    ];
    const savedMatches = firstCall[0].data.matches;

    expect(savedMatches[0]?.match_type).toBe("PRIMARY_MATCH");
    expect(savedMatches[1]?.match_type).toBe("REFERENCED_CONTEXT");
  });

  it("T06: throws NotFoundException when VerifiedProfile does not exist", async () => {
    mockFindFirstVerifiedProfile.mockResolvedValue(null);
    const command = new AcceptLegalRuleMatchCommand(
      validPayload,
      "corr-not-found",
    );

    try {
      await handler.execute(command);
    } catch (err: unknown) {
      const response = (err as NotFoundException).getResponse() as {
        problem: { code: string };
      };
      expect(response.problem.code).toBe(
        SCAN_ERROR_CODES.verifiedProfileNotFound,
      );
    }
  });
});
