import { jest } from "@jest/globals";
import { EvidenceAcceptanceStatus } from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { SEARCH_EVIDENCE_CONFIDENCE } from "../../contracts/evidence/search-evidence.contract.js";
import { SearchEvidenceHandler } from "./search-evidence.handler.js";
import { SearchEvidenceQuery } from "./search-evidence.query.js";

describe("SearchEvidenceHandler", () => {
  it("T01: filters, sorts, and caps safe technical finding summaries", async () => {
    const prisma = {
      technicalEvidenceReport: {
        findFirst: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: "report-1",
            status: EvidenceAcceptanceStatus.ACCEPTED,
            evidencePayload: {
              technical_findings: [
                {
                  finding_id: "b",
                  finding_type: "AI_PROVIDER_INVOCATION",
                  file_path: "z/a.ts",
                  line_number: 2,
                  library_group: "openai",
                  confidence: 0.9,
                  coverage_note: null,
                },
                {
                  finding_id: "a",
                  finding_type: "AI_PROVIDER_INVOCATION",
                  file_path: "a/a.ts",
                  line_number: 1,
                  library_group: "openai",
                  confidence: 0.8,
                  coverage_note: null,
                },
                {
                  finding_id: "raw",
                  finding_type: "AI_PROVIDER_INVOCATION",
                  raw_source: "forbidden",
                  confidence: 1,
                },
              ],
            },
          }),
        ),
      },
    } as unknown as PrismaService;
    const audit = {
      write: jest.fn().mockImplementation(() => Promise.resolve()),
    } as unknown as jest.Mocked<AuditWriterService>;
    const handler = new SearchEvidenceHandler(prisma, audit);

    const response = await handler.execute(
      new SearchEvidenceQuery(
        "assessment-1",
        "org-1",
        "report-1",
        1,
        "corr-1",
        [],
        ["OPENAI"],
        [],
        SEARCH_EVIDENCE_CONFIDENCE.high,
      ),
    );

    expect(response.result.findings).toHaveLength(1);
    expect(response.result.findings[0]?.finding_ref).toBe("finding:a");
    expect(response.result.truncated).toBe(true);
    expect(JSON.stringify(response)).not.toContain("raw_source");
  });
});
