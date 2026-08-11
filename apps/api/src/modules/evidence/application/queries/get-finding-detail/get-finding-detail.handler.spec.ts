import { jest } from "@jest/globals";
import { EvidenceAcceptanceStatus } from "@prisma/client";
import {
  AGENTIC_TOOL_NAMES,
  AGENTIC_TOOL_COVERAGE_STATES,
} from "@lcsp/contracts/evidence";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { FINDING_DETAIL_INCLUDES } from "../../contracts/evidence/finding-detail.contract.js";
import { GetFindingDetailHandler } from "./get-finding-detail.handler.js";
import { GetFindingDetailQuery } from "./get-finding-detail.query.js";

describe("GetFindingDetailHandler", () => {
  function createHandler(finding: Record<string, unknown>) {
    const prisma = {
      technicalEvidenceReport: {
        findFirst: jest.fn().mockResolvedValue({
          id: "report-1",
          status: EvidenceAcceptanceStatus.ACCEPTED,
          evidencePayload: { technical_findings: [finding] },
        }),
      },
    } as unknown as PrismaService;
    const auditWriter = {
      write: jest.fn<AuditWriterService["write"]>(),
    } as unknown as jest.Mocked<AuditWriterService>;
    return new GetFindingDetailHandler(prisma, auditWriter);
  }

  it("T01: projects selected metadata without the scanner finding body", async () => {
    const handler = createHandler({
      finding_id: "finding-00000001",
      finding_type: "AI_PROVIDER_USAGE",
      file_path: "apps/api/src/ai/client.ts",
      line_number: 42,
      source_tools: ["run_semgrep_rules"],
      analysis_level: "L1",
      confidence: 0.9,
      library_group: "openai",
      kwarg_names: ["messages"],
      has_dynamic_call: false,
      coverage_note: null,
    });

    const response = await handler.execute(
      new GetFindingDetailQuery(
        "assessment-1",
        "org-1",
        "report-1",
        "finding-00000001",
        [
          FINDING_DETAIL_INCLUDES.location,
          FINDING_DETAIL_INCLUDES.categories,
          FINDING_DETAIL_INCLUDES.confidence,
          FINDING_DETAIL_INCLUDES.provenance,
        ],
        "corr-1",
      ),
    );

    expect(response.tool_name).toBe(AGENTIC_TOOL_NAMES.getFindingDetail);
    expect(response.coverage_state).toBe(
      AGENTIC_TOOL_COVERAGE_STATES.sufficient,
    );
    expect(response.result.finding).toEqual({
      finding_ref: "finding:finding-00000001",
      kind: "AI_PROVIDER_USAGE",
      relative_location: "apps/api/src/ai/client.ts:42",
      categories: ["AI_PROVIDER_USAGE", "openai"],
      confidence: "HIGH",
      provenance: { tools: ["run_semgrep_rules"], analysis_level: "L1" },
    });
  });

  it("T05: rejects a finding containing raw source before a payload reaches the tool response", async () => {
    const handler = createHandler({
      finding_id: "finding-00000002",
      finding_type: "AI_PROVIDER_USAGE",
      raw_source: "client.chat.completions.create(...)",
    });

    const response = await handler.execute(
      new GetFindingDetailQuery(
        "assessment-1",
        "org-1",
        "report-1",
        "finding-00000002",
        [FINDING_DETAIL_INCLUDES.location],
        "corr-2",
      ),
    );

    expect(response.result.finding).toBeNull();
    expect(JSON.stringify(response)).not.toContain("raw_source");
  });
});
