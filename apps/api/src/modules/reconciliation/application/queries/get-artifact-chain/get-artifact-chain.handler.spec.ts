import {
  AGENTIC_TOOL_COVERAGE_STATES,
  ARTIFACT_CHAIN_INTEGRITY,
  ARTIFACT_CHAIN_STAGES,
} from "@lcsp/contracts/evidence";
import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  EvidenceAcceptanceStatus,
  VerifiedProfileStatus,
  WizardProfileStatus,
} from "@prisma/client";
import { jest } from "@jest/globals";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { GetArtifactChainQuery } from "./get-artifact-chain.query.js";
import { GetArtifactChainHandler } from "./get-artifact-chain.handler.js";

/* eslint-disable @typescript-eslint/unbound-method */

describe("GetArtifactChainHandler", () => {
  const assessment = { id: "assessment-1" };

  function makeHandler(overrides: Record<string, unknown> = {}) {
    const prisma = {
      assessment: { findFirst: jest.fn().mockResolvedValue(assessment) },
      technicalEvidenceReport: {
        findFirst: jest.fn().mockResolvedValue({
          id: "report-1",
          schemaVersion: "1.0.0",
          status: EvidenceAcceptanceStatus.ACCEPTED,
        }),
      },
      wizardProfile: {
        findUnique: jest.fn().mockResolvedValue({
          id: "wizard-1",
          version: 2,
          status: WizardProfileStatus.SUBMITTED,
        }),
      },
      technicalProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "profile-1",
          schemaVersion: "1.0.0",
          status: EvidenceAcceptanceStatus.ACCEPTED,
        }),
      },
      aIUsageFlow: {
        findFirst: jest.fn().mockResolvedValue({
          id: "flow-1",
          schemaVersion: "1.0.0",
          status: EvidenceAcceptanceStatus.ACCEPTED,
        }),
      },
      conflictRecord: { findMany: jest.fn().mockResolvedValue([]) },
      verifiedProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: "verified-1",
          schemaVersion: "1.0.0",
          status: VerifiedProfileStatus.APPROVED,
        }),
      },
      ...overrides,
    } as unknown as PrismaService;
    const auditWriter = {
      write: jest.fn<AuditWriterService["write"]>(),
    } as unknown as jest.Mocked<AuditWriterService>;

    return {
      handler: new GetArtifactChainHandler(prisma, auditWriter),
      auditWriter,
    };
  }

  it("T01: returns ordered, payload-free immutable artifact refs", async () => {
    const { handler, auditWriter } = makeHandler();

    const response = await handler.execute(
      new GetArtifactChainQuery("assessment-1", "org-1", "corr-1"),
    );

    expect(response.coverage_state).toBe(
      AGENTIC_TOOL_COVERAGE_STATES.sufficient,
    );
    expect(response.result.integrity).toBe(ARTIFACT_CHAIN_INTEGRITY.valid);
    expect(response.result.links.map((link) => link.stage)).toEqual([
      ARTIFACT_CHAIN_STAGES.technicalEvidence,
      ARTIFACT_CHAIN_STAGES.wizardProfile,
      ARTIFACT_CHAIN_STAGES.aiUsageFlow,
      ARTIFACT_CHAIN_STAGES.verifiedProfile,
    ]);
    expect(JSON.stringify(response)).not.toContain("profileData");
    expect(auditWriter.write).toHaveBeenCalledWith(
      expect.objectContaining({ decision: AUDIT_DECISIONS.allow }),
    );
  });

  it("T02: reports a missing required stage as a limitation", async () => {
    const { handler } = makeHandler({
      verifiedProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    const response = await handler.execute(
      new GetArtifactChainQuery("assessment-1", "org-1", "corr-2", [
        ARTIFACT_CHAIN_STAGES.verifiedProfile,
      ]),
    );

    expect(response.coverage_state).toBe(AGENTIC_TOOL_COVERAGE_STATES.limited);
    expect(response.result.missing_stages).toEqual([
      {
        stage: ARTIFACT_CHAIN_STAGES.verifiedProfile,
        reason: "ARTIFACT_LINK_MISSING",
      },
    ]);
  });
});
