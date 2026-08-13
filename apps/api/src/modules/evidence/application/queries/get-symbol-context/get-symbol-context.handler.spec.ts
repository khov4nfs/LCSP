import { jest } from "@jest/globals";
import { EvidenceAcceptanceStatus } from "@prisma/client";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { SYMBOL_CONTEXT_INCLUDES } from "../../contracts/evidence/symbol-context.contract.js";
import { GetSymbolContextHandler } from "./get-symbol-context.handler.js";
import { GetSymbolContextQuery } from "./get-symbol-context.query.js";

describe("GetSymbolContextHandler", () => {
  it("returns capped, sorted symbol adjacency without graph attributes", async () => {
    const prisma = {
      technicalEvidenceReport: {
        findFirst: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: "report-1",
            status: EvidenceAcceptanceStatus.ACCEPTED,
            evidencePayload: {
              evidence_graph: {
                nodes: [
                  {
                    node_id: "fn",
                    node_type: "FUNCTION",
                    label: "handle",
                    file_path: "src/a.py",
                    line_number: 2,
                    evidence_refs: ["finding:1"],
                    attributes: { prompt: "blocked" },
                  },
                ],
                edges: [
                  {
                    edge_id: "b",
                    edge_type: "CALLS",
                    source_node_id: "fn",
                    target_node_id: "callee-b",
                  },
                  {
                    edge_id: "a",
                    edge_type: "CALLS",
                    source_node_id: "caller-a",
                    target_node_id: "fn",
                  },
                ],
              },
            },
          }),
        ),
      },
    } as unknown as PrismaService;
    const audit = {
      write: jest.fn().mockImplementation(() => Promise.resolve()),
    } as unknown as jest.Mocked<AuditWriterService>;
    const response = await new GetSymbolContextHandler(prisma, audit).execute(
      new GetSymbolContextQuery(
        "assessment-1",
        "org-1",
        "report-1",
        "fn",
        [
          SYMBOL_CONTEXT_INCLUDES.categories,
          SYMBOL_CONTEXT_INCLUDES.callers,
          SYMBOL_CONTEXT_INCLUDES.callees,
          SYMBOL_CONTEXT_INCLUDES.evidenceRefs,
        ],
        1,
        "corr-1",
      ),
    );
    expect(response.result.truncated).toBe(true);
    expect(JSON.stringify(response)).not.toContain("attributes");
    expect(JSON.stringify(response)).not.toContain("prompt");
  });
});
