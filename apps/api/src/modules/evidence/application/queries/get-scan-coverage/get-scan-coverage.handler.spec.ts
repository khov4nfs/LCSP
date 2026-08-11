import { jest } from "@jest/globals";
import { EvidenceAcceptanceStatus } from "@prisma/client";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { SCAN_COVERAGE_DISPOSITIONS } from "../../contracts/evidence/scan-coverage.contract.js";
import { GetScanCoverageHandler } from "./get-scan-coverage.handler.js";
import { GetScanCoverageQuery } from "./get-scan-coverage.query.js";

describe("GetScanCoverageHandler", () => {
  it("returns sorted safe file coverage and explicit limitations", async () => {
    const prisma = {
      technicalEvidenceReport: {
        findFirst: jest.fn().mockResolvedValue({
          id: "report-1",
          status: EvidenceAcceptanceStatus.ACCEPTED,
          evidencePayload: {
            scan_coverage: {
              files: [
                {
                  file_path: "src/z.py",
                  language: "python",
                  support_level: "FULL",
                  coverage_limitation: false,
                },
                {
                  file_path: "src/a.ts",
                  language: "typescript",
                  support_level: "SKIP",
                  skip_reason: "file_access_failed",
                  coverage_limitation: true,
                  raw_source: "secret",
                },
              ],
            },
          },
        }),
      },
    } as unknown as PrismaService;
    const audit = {
      write: jest.fn<AuditWriterService["write"]>(),
    } as unknown as jest.Mocked<AuditWriterService>;
    const response = await new GetScanCoverageHandler(prisma, audit).execute(
      new GetScanCoverageQuery(
        "assessment-1",
        "org-1",
        "report-1",
        10,
        "corr-1",
      ),
    );
    expect(response.result.files).toEqual([
      expect.objectContaining({
        path: "src/a.ts",
        disposition: SCAN_COVERAGE_DISPOSITIONS.limited,
      }),
      expect.objectContaining({
        path: "src/z.py",
        disposition: SCAN_COVERAGE_DISPOSITIONS.analyzed,
      }),
    ]);
    expect(JSON.stringify(response)).not.toContain("raw_source");
    expect(JSON.stringify(response)).not.toContain("secret");
  });
});
