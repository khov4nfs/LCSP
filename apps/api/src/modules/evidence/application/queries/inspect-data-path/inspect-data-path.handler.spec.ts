import { jest } from "@jest/globals";
import { EvidenceAcceptanceStatus } from "@prisma/client";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import {
  DATA_CATEGORIES,
  DATA_PATH_DIRECTIONS,
} from "../../contracts/evidence/data-path.contract.js";
import { InspectDataPathHandler } from "./inspect-data-path.handler.js";
import { InspectDataPathQuery } from "./inspect-data-path.query.js";

describe("InspectDataPathHandler", () => {
  it("returns categories only and explicitly stops at dynamic flows", async () => {
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
                    node_id: "start",
                    node_type: "AI_INPUT",
                    data_role: "INGRESS",
                    data_categories: ["IDENTIFIER"],
                    file_path: "src/input.ts",
                    line_number: 3,
                    raw_value: "alice@example.com",
                  },
                  { node_id: "dynamic", node_type: "UNSUPPORTED_FLOW" },
                ],
                edges: [
                  {
                    edge_id: "edge-1",
                    source_node_id: "start",
                    target_node_id: "dynamic",
                  },
                ],
              },
            },
          }),
        ),
      },
    } as unknown as PrismaService;
    const audit = {
      write: jest.fn<AuditWriterService["write"]>(),
    } as unknown as jest.Mocked<AuditWriterService>;
    const response = await new InspectDataPathHandler(prisma, audit).execute(
      new InspectDataPathQuery(
        "assessment-1",
        "org-1",
        "report-1",
        "start",
        DATA_PATH_DIRECTIONS.forward,
        [DATA_CATEGORIES.identifier],
        5,
        10,
        "corr-1",
      ),
    );
    expect(response.result.segments).toEqual([
      expect.objectContaining({
        categories: [DATA_CATEGORIES.identifier],
        relative_location: "src/input.ts:3",
      }),
    ]);
    expect(response.result.terminal).toMatchObject({
      state: "DYNAMIC_BOUNDARY",
    });
    expect(JSON.stringify(response)).not.toContain("alice@example.com");
  });
});
