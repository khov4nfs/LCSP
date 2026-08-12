import { jest } from "@jest/globals";
import { EvidenceAcceptanceStatus, WizardProfileStatus } from "@prisma/client";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_STATUSES,
} from "@lcsp/contracts/evidence";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import {
  TARGET_CANDIDATE_KINDS,
  TARGET_CANDIDATE_LIMITATION_CODES,
} from "../../contracts/missing-target-proposal.contract.js";
import { ProposeMissingTargetsHandler } from "./propose-missing-targets.handler.js";
import { ProposeMissingTargetsQuery } from "./propose-missing-targets.query.js";

describe("ProposeMissingTargetsHandler", () => {
  it("returns OUT_OF_COVERAGE when submitted target ids are unavailable", async () => {
    const prisma = {
      wizardProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "wizard-1",
          status: WizardProfileStatus.SUBMITTED,
        }),
      },
      technicalEvidenceReport: {
        findFirst: jest.fn().mockResolvedValue({
          id: "report-1",
          status: EvidenceAcceptanceStatus.ACCEPTED,
          evidencePayload: {
            technical_findings: [
              {
                finding_id: "finding_01",
                provider: "OPENAI",
                raw_source: "secret",
              },
            ],
          },
        }),
      },
    } as unknown as PrismaService;
    const audit = {
      write: jest.fn<AuditWriterService["write"]>(),
    } as unknown as jest.Mocked<AuditWriterService>;

    const response = await new ProposeMissingTargetsHandler(
      prisma,
      audit,
    ).execute(
      new ProposeMissingTargetsQuery(
        "assessment-1",
        "org-1",
        "wizard-1",
        "report-1",
        [TARGET_CANDIDATE_KINDS.providerUsage],
        [],
        [],
        25,
        "corr-1",
      ),
    );

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.outOfCoverage);
    expect(response.coverage_state).toBe(AGENTIC_TOOL_COVERAGE_STATES.partial);
    expect(response.limitations).toContain(
      TARGET_CANDIDATE_LIMITATION_CODES.submittedTargetIdsUnavailable,
    );
    expect(response.result.candidates).toEqual([]);
    expect(JSON.stringify(response)).not.toContain("secret");
  });

  it("proposes provider candidates when caller supplies explicit excludes", async () => {
    const prisma = {
      wizardProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "wizard-1",
          status: WizardProfileStatus.SUBMITTED,
        }),
      },
      technicalEvidenceReport: {
        findFirst: jest.fn().mockResolvedValue({
          id: "report-1",
          status: EvidenceAcceptanceStatus.ACCEPTED,
          evidencePayload: {
            technical_findings: [
              { finding_id: "finding_02", provider: "OPENAI" },
              { finding_id: "finding_03", provider: "ANTHROPIC" },
            ],
          },
        }),
      },
    } as unknown as PrismaService;
    const audit = {
      write: jest.fn<AuditWriterService["write"]>(),
    } as unknown as jest.Mocked<AuditWriterService>;

    const response = await new ProposeMissingTargetsHandler(
      prisma,
      audit,
    ).execute(
      new ProposeMissingTargetsQuery(
        "assessment-1",
        "org-1",
        "wizard-1",
        "report-1",
        [TARGET_CANDIDATE_KINDS.providerUsage],
        [],
        ["target:provider_openai"],
        25,
        "corr-1",
      ),
    );

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.outOfCoverage);
    expect(response.coverage_state).toBe(AGENTIC_TOOL_COVERAGE_STATES.partial);
    expect(response.limitations).toContain(
      TARGET_CANDIDATE_LIMITATION_CODES.submittedTargetIdsUnavailable,
    );
    expect(response.result.candidates).toEqual([
      expect.objectContaining({
        candidate_ref: "candidate:provider_anthropic",
        target_ref: "target:provider_anthropic",
        attributes: { provider: "ANTHROPIC" },
      }),
    ]);
    expect(response.evidence_refs).toEqual(["finding:finding_03"]);
  });

  it("returns NEEDS_INPUT when wizard profile is not submitted", async () => {
    const prisma = {
      wizardProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "wizard-1",
          status: WizardProfileStatus.IN_PROGRESS,
        }),
      },
      technicalEvidenceReport: {
        findFirst: jest.fn().mockResolvedValue({
          id: "report-1",
          status: EvidenceAcceptanceStatus.ACCEPTED,
          evidencePayload: {},
        }),
      },
    } as unknown as PrismaService;
    const audit = {
      write: jest.fn<AuditWriterService["write"]>(),
    } as unknown as jest.Mocked<AuditWriterService>;

    const response = await new ProposeMissingTargetsHandler(
      prisma,
      audit,
    ).execute(
      new ProposeMissingTargetsQuery(
        "assessment-1",
        "org-1",
        "wizard-1",
        "report-1",
        [TARGET_CANDIDATE_KINDS.providerUsage],
        [],
        ["target:provider_openai"],
        25,
        "corr-1",
      ),
    );

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.needsInput);
    expect(response.coverage_state).toBe(
      AGENTIC_TOOL_COVERAGE_STATES.unavailable,
    );
  });
});
