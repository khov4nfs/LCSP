import { jest } from "@jest/globals";
import { EvidenceAcceptanceStatus } from "@prisma/client";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { DECISION_ACTION_CATEGORIES } from "../../contracts/evidence/decision-path.contract.js";
import { InspectDecisionPathHandler } from "./inspect-decision-path.handler.js";
import { InspectDecisionPathQuery } from "./inspect-decision-path.query.js";

describe("InspectDecisionPathHandler", () => {
  const query = () =>
    new InspectDecisionPathQuery(
      "assessment-1",
      "org-1",
      "report-1",
      "start",
      [DECISION_ACTION_CATEGORIES.recommend],
      5,
      10,
      "corr-1",
    );
  const handler = (evidencePayload: unknown) =>
    new InspectDecisionPathHandler(
      {
        technicalEvidenceReport: {
          findFirst: jest.fn().mockImplementation(() =>
            Promise.resolve({
              id: "report-1",
              status: EvidenceAcceptanceStatus.ACCEPTED,
              evidencePayload,
            }),
          ),
        },
      } as unknown as PrismaService,
      {
        write: jest.fn<AuditWriterService["write"]>(),
      } as unknown as jest.Mocked<AuditWriterService>,
    );

  it("returns normalized decision evidence without source expressions", async () => {
    const response = await handler({
      evidence_graph: {
        decision_coverage_state: "SUFFICIENT",
        nodes: [
          { node_id: "start", node_type: "FUNCTION" },
          {
            node_id: "decision",
            node_type: "DECISION_RULE",
            action_category: "RECOMMEND",
            confidence: "MEDIUM",
            file_path: "src/recommend.ts",
            line_number: 7,
            evidence_refs: ["finding:1"],
            expression: "score > 0.5",
          },
        ],
        edges: [
          {
            edge_id: "edge-1",
            source_node_id: "start",
            target_node_id: "decision",
          },
        ],
      },
    }).execute(query());
    expect(response.result.segments).toEqual([
      expect.objectContaining({
        action_category: DECISION_ACTION_CATEGORIES.recommend,
        relative_location: "src/recommend.ts:7",
      }),
    ]);
    expect(JSON.stringify(response)).not.toContain("score > 0.5");
  });

  it("keeps a dynamic boundary explicit", async () => {
    const response = await handler({
      evidence_graph: {
        nodes: [
          { node_id: "start", node_type: "FUNCTION" },
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
    }).execute(query());
    expect(response.result.terminal).toMatchObject({
      state: "DYNAMIC_BOUNDARY",
      reason: "UNSUPPORTED_DYNAMIC_FLOW",
    });
    expect(response.limitations).toEqual(["UNSUPPORTED_DYNAMIC_FLOW"]);
  });
});
