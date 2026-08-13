import { jest } from "@jest/globals";
import { EvidenceAcceptanceStatus } from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import {
  STATIC_FLOW_DIRECTIONS,
  STATIC_FLOW_TERMINALS,
} from "../../contracts/evidence/static-flow.contract.js";
import { TraceStaticFlowHandler } from "./trace-static-flow.handler.js";
import { TraceStaticFlowQuery } from "./trace-static-flow.query.js";

describe("TraceStaticFlowHandler", () => {
  it("stops at the first unsupported dynamic flow without exposing source", async () => {
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
                    node_id: "function-1",
                    node_type: "FUNCTION",
                    file_path: "src/worker.py",
                    line_number: 8,
                    raw_source: "client.invoke(secret_prompt)",
                  },
                  {
                    node_id: "dynamic-1",
                    node_type: "UNSUPPORTED_FLOW",
                    raw_source: "getattr(client, name)(prompt)",
                  },
                ],
                edges: [
                  {
                    edge_id: "flow-1",
                    edge_type: "FLOWS_TO",
                    source_node_id: "function-1",
                    target_node_id: "dynamic-1",
                    evidence_refs: ["finding:1"],
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

    const response = await new TraceStaticFlowHandler(prisma, audit).execute(
      new TraceStaticFlowQuery(
        "assessment-1",
        "org-1",
        "report-1",
        "function-1",
        STATIC_FLOW_DIRECTIONS.forward,
        5,
        "corr-1",
      ),
    );

    expect(response.result.terminal).toEqual({
      state: STATIC_FLOW_TERMINALS.dynamicBoundary,
      reason: "UNSUPPORTED_DYNAMIC_FLOW",
      ref: "node:dynamic-1",
    });
    expect(response.result.segments).toEqual([
      expect.objectContaining({
        segment_ref: "flow:flow-1",
        relative_location: "src/worker.py:8",
        evidence_refs: ["finding:1"],
      }),
    ]);
    expect(JSON.stringify(response)).not.toContain("secret_prompt");
    expect(JSON.stringify(response)).not.toContain("raw_source");
  });
});
