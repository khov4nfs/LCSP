import { jest } from "@jest/globals";
import { EvidenceAcceptanceStatus } from "@prisma/client";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { EVIDENCE_SUBGRAPH_DIRECTIONS } from "../../contracts/evidence/evidence-subgraph.contract.js";
import { GetEvidenceSubgraphHandler } from "./get-evidence-subgraph.handler.js";
import { GetEvidenceSubgraphQuery } from "./get-evidence-subgraph.query.js";

describe("GetEvidenceSubgraphHandler", () => {
  it("performs a bounded cycle-safe traversal", async () => {
    const prisma = {
      technicalEvidenceReport: {
        findFirst: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: "report-1",
            status: EvidenceAcceptanceStatus.ACCEPTED,
            evidencePayload: {
              evidence_graph: {
                graph_id: "graph-1",
                nodes: [
                  {
                    node_id: "a",
                    node_type: "FILE",
                    label: "a",
                    file_path: "src/a.py",
                    line_number: 1,
                    evidence_refs: [],
                  },
                  {
                    node_id: "b",
                    node_type: "FUNCTION",
                    label: "b",
                    file_path: "src/a.py",
                    line_number: 2,
                    evidence_refs: ["finding:1"],
                  },
                ],
                edges: [
                  {
                    edge_id: "ab",
                    edge_type: "CONTAINS",
                    source_node_id: "a",
                    target_node_id: "b",
                    evidence_refs: [],
                  },
                  {
                    edge_id: "ba",
                    edge_type: "CALLS",
                    source_node_id: "b",
                    target_node_id: "a",
                    evidence_refs: [],
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
    const response = await new GetEvidenceSubgraphHandler(
      prisma,
      audit,
    ).execute(
      new GetEvidenceSubgraphQuery(
        "assessment-1",
        "org-1",
        "report-1",
        "a",
        EVIDENCE_SUBGRAPH_DIRECTIONS.outbound,
        2,
        10,
        10,
        "corr-1",
      ),
    );
    expect(response.result.nodes.map((node) => node.node_ref)).toEqual([
      "node:a",
      "node:b",
    ]);
    expect(response.result.truncated).toBe(false);
  });
});
