import { jest } from "@jest/globals";
import { EvidenceAcceptanceStatus } from "@prisma/client";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { PROVIDER_INVOCATION_PROVIDERS } from "../../contracts/evidence/provider-invocation.contract.js";
import { FindProviderInvocationsHandler } from "./find-provider-invocations.handler.js";
import { FindProviderInvocationsQuery } from "./find-provider-invocations.query.js";

describe("FindProviderInvocationsHandler", () => {
  it("keeps dependency declarations separate from actual provider invocation facts", async () => {
    const prisma = {
      technicalEvidenceReport: {
        findFirst: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: "report-1",
            status: EvidenceAcceptanceStatus.ACCEPTED,
            evidencePayload: {
              technical_findings: [
                {
                  finding_id: "call-1",
                  finding_type: "AI_PROVIDER_INVOCATION",
                  file_path: "src/a.ts",
                  line_number: 8,
                  library_group: "openai",
                },
              ],
              package_dependencies: [{ name: "openai", is_ai_relevant: true }],
            },
          }),
        ),
      },
    } as unknown as PrismaService;
    const audit = {
      write: jest.fn().mockImplementation(() => Promise.resolve()),
    } as unknown as jest.Mocked<AuditWriterService>;
    const response = await new FindProviderInvocationsHandler(
      prisma,
      audit,
    ).execute(
      new FindProviderInvocationsQuery(
        "assessment-1",
        "org-1",
        "report-1",
        10,
        "corr-1",
        PROVIDER_INVOCATION_PROVIDERS.openai,
      ),
    );
    expect(response.result.invocations).toHaveLength(1);
    expect(response.result.declared_signals).toEqual([
      { kind: "DEPENDENCY_SIGNAL", ref: "dependency:openai" },
    ]);
  });
});
