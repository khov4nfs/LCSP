import { jest } from "@jest/globals";
import { EvidenceAcceptanceStatus } from "@prisma/client";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { SCAN_COVERAGE_DISPOSITIONS } from "../../contracts/evidence/scan-coverage.contract.js";
import { GetScanCoverageHandler } from "./get-scan-coverage.handler.js";
import { GetScanCoverageQuery } from "./get-scan-coverage.query.js";

describe("GetScanCoverageHandler", () => {
  it("returns sorted safe file coverage and explicit limitations", async () => {
    const prisma = buildPrisma([
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
    ]);
    const audit = buildAudit();
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
    expect(response.evidence_refs).toEqual([
      "coverage:file:src/a.ts",
      "coverage:file:src/z.py",
    ]);
    expect(response.result.tool_outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool_name: "semgrep_ai_usage",
          outcome: "FAILED",
        }),
        expect.objectContaining({
          tool_name: "syft",
          outcome: "SUCCESS",
        }),
      ]),
    );
    expect(response.result.unresolved_dynamic_boundaries).toEqual([
      expect.objectContaining({
        source: "PYTHON_ANALYSIS",
        file_path: "src/runtime.py",
        reason: "dynamic getattr",
      }),
    ]);
    expect(response.result.next_cursor).toBeNull();
    expect(JSON.stringify(response)).not.toContain("raw_source");
    expect(JSON.stringify(response)).not.toContain("secret");
  });

  it("filters selectors, caps the page at 100, and resumes with an opaque cursor", async () => {
    const files = [
      ...Array.from({ length: 101 }, (_, index) => ({
        file_path: `apps/api/src/file-${String(index).padStart(3, "0")}.ts`,
        language: "typescript",
        support_level: "FULL",
        coverage_limitation: false,
      })),
      {
        file_path: "src/ignored.py",
        language: "python",
        support_level: "FULL",
        coverage_limitation: false,
      },
    ];
    const prisma = buildPrisma(files);
    const audit = buildAudit();
    const handler = new GetScanCoverageHandler(prisma, audit);

    const first = await handler.execute(
      new GetScanCoverageQuery(
        "assessment-1",
        "org-1",
        "report-1",
        500,
        "corr-1",
        ["apps/api/"],
        ["TYPESCRIPT"],
        [SCAN_COVERAGE_DISPOSITIONS.analyzed],
      ),
    );

    expect(first.result.files).toHaveLength(100);
    expect(first.result.counts.total).toBe(101);
    expect(first.result.truncated).toBe(true);
    expect(first.result.next_cursor).toEqual(expect.any(String));
    expect(
      first.result.files.every((item) => item.path.startsWith("apps/api/")),
    ).toBe(true);

    const second = await handler.execute(
      new GetScanCoverageQuery(
        "assessment-1",
        "org-1",
        "report-1",
        500,
        "corr-2",
        ["apps/api/"],
        ["TYPESCRIPT"],
        [SCAN_COVERAGE_DISPOSITIONS.analyzed],
        [],
        first.result.next_cursor,
      ),
    );

    expect(second.result.files).toHaveLength(1);
    expect(second.result.files[0]?.path).toBe("apps/api/src/file-100.ts");
    expect(second.result.truncated).toBe(false);
    expect(second.result.next_cursor).toBeNull();
  });
});

function buildPrisma(files: Array<Record<string, unknown>>): PrismaService {
  return {
    technicalEvidenceReport: {
      findFirst: jest.fn().mockImplementation(() =>
        Promise.resolve({
          id: "report-1",
          status: EvidenceAcceptanceStatus.ACCEPTED,
          evidencePayload: {
            scan_coverage: { files },
            tools_version: {
              syft: "syft 1.0.0",
              semgrep_ai_usage: "semgrep 1.99.0",
            },
            tool_failures: [
              {
                tool_name: "semgrep_ai_usage",
                tool_version: "semgrep 1.99.0",
                outcome: "FAILED",
              },
            ],
            python_analysis: {
              unsupported_dynamic_flows: [
                {
                  file_path: "src/runtime.py",
                  function_name: "dynamic_call",
                  reason: "dynamic getattr",
                },
              ],
            },
          },
        }),
      ),
    },
  } as unknown as PrismaService;
}

function buildAudit(): jest.Mocked<AuditWriterService> {
  return {
    write: jest.fn().mockImplementation(() => Promise.resolve()),
  } as unknown as jest.Mocked<AuditWriterService>;
}
