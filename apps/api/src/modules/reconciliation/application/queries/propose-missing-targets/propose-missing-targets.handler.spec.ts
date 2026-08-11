import { jest } from "@jest/globals";
import { EvidenceAcceptanceStatus } from "@prisma/client";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { TARGET_CANDIDATE_KINDS } from "../../contracts/missing-target-proposal.contract.js";
import { ProposeMissingTargetsHandler } from "./propose-missing-targets.handler.js";
import { ProposeMissingTargetsQuery } from "./propose-missing-targets.query.js";
describe("ProposeMissingTargetsHandler", () => {
  it("proposes provider candidates without wizard writes or source leakage", async () => {
    const prisma = {
      wizardProfile: {
        findFirst: jest.fn().mockResolvedValue({ id: "wizard-1" }),
      },
      technicalEvidenceReport: {
        findFirst: jest.fn().mockResolvedValue({
          id: "report-1",
          status: EvidenceAcceptanceStatus.ACCEPTED,
          evidencePayload: {
            technical_findings: [
              { finding_id: "f-1", provider: "OPENAI", raw_source: "secret" },
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
        25,
        "corr-1",
      ),
    );
    expect(response.result.candidates).toEqual([
      expect.objectContaining({ attributes: { provider: "OPENAI" } }),
    ]);
    expect(JSON.stringify(response)).not.toContain("secret");
    expect("update" in prisma.wizardProfile).toBe(false);
  });
});
