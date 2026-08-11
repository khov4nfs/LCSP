import { jest } from "@jest/globals";
import { EvidenceAcceptanceStatus } from "@prisma/client";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import {
  HUMAN_REVIEW_KINDS,
  HUMAN_REVIEW_STATES,
} from "../../contracts/evidence/human-review-path.contract.js";
import { InspectHumanReviewPathHandler } from "./inspect-human-review-path.handler.js";
import { InspectHumanReviewPathQuery } from "./inspect-human-review-path.query.js";

describe("InspectHumanReviewPathHandler", () => {
  it("returns only classified review evidence and keeps generic nodes unknown", async () => {
    const report = {
      id: "report-1",
      status: EvidenceAcceptanceStatus.ACCEPTED,
      evidencePayload: {
        evidence_graph: {
          nodes: [
            { node_id: "start", node_type: "FUNCTION" },
            {
              node_id: "generic",
              node_type: "HUMAN_REVIEW_STEP",
              raw_source: "review(payload)",
            },
          ],
          edges: [
            {
              edge_id: "edge-1",
              source_node_id: "start",
              target_node_id: "generic",
            },
          ],
        },
      },
    };
    const prisma = {
      technicalEvidenceReport: {
        findFirst: jest.fn().mockResolvedValue(report),
      },
    } as unknown as PrismaService;
    const audit = {
      write: jest.fn<AuditWriterService["write"]>(),
    } as unknown as jest.Mocked<AuditWriterService>;
    const response = await new InspectHumanReviewPathHandler(
      prisma,
      audit,
    ).execute(
      new InspectHumanReviewPathQuery(
        "assessment-1",
        "org-1",
        "report-1",
        "start",
        [HUMAN_REVIEW_KINDS.approval],
        5,
        "corr-1",
      ),
    );
    expect(response.result.review_state).toBe(HUMAN_REVIEW_STATES.unknown);
    expect(JSON.stringify(response)).not.toContain("raw_source");
  });

  it("returns present for normalized classified review evidence", async () => {
    const report = {
      id: "report-1",
      status: EvidenceAcceptanceStatus.ACCEPTED,
      evidencePayload: {
        evidence_graph: {
          nodes: [
            { node_id: "start", node_type: "FUNCTION" },
            {
              node_id: "review",
              node_type: "HUMAN_REVIEW_STEP",
              review_kind: "APPROVAL",
              file_path: "src/review.ts",
              line_number: 12,
              evidence_refs: ["finding:review-1"],
            },
          ],
          edges: [
            {
              edge_id: "edge-1",
              source_node_id: "start",
              target_node_id: "review",
            },
          ],
        },
      },
    };
    const prisma = {
      technicalEvidenceReport: {
        findFirst: jest.fn().mockResolvedValue(report),
      },
    } as unknown as PrismaService;
    const audit = {
      write: jest.fn<AuditWriterService["write"]>(),
    } as unknown as jest.Mocked<AuditWriterService>;
    const response = await new InspectHumanReviewPathHandler(
      prisma,
      audit,
    ).execute(
      new InspectHumanReviewPathQuery(
        "assessment-1",
        "org-1",
        "report-1",
        "start",
        [HUMAN_REVIEW_KINDS.approval],
        5,
        "corr-1",
      ),
    );
    expect(response.result.review_state).toBe(HUMAN_REVIEW_STATES.present);
    expect(response.result.segments[0]).toMatchObject({
      relative_location: "src/review.ts:12",
      evidence_refs: ["finding:review-1"],
    });
  });
});
