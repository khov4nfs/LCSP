import { jest } from "@jest/globals";
import { ConflictRecordStatus } from "@prisma/client";
import { AGENTIC_TOOL_NAMES } from "@lcsp/contracts/evidence";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import {
  RECONCILIATION_CONTEXT_STATUSES,
  RECONCILIATION_RESOLUTION_PATHS,
} from "../../contracts/reconciliation/reconciliation-context.contract.js";
import { GetReconciliationContextHandler } from "./get-reconciliation-context.handler.js";
import { GetReconciliationContextQuery } from "./get-reconciliation-context.query.js";

describe("GetReconciliationContextHandler", () => {
  it("T01: returns only safe conflict projection and a human resolution path", async () => {
    const prisma = {
      aIUsageFlow: { findFirst: jest.fn().mockResolvedValue({ id: "flow-1" }) },
      conflictRecord: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "conflict-1",
            conflictType: "provider_declaration",
            conflictScore: 0.92,
            status: ConflictRecordStatus.PENDING,
            evidenceRefs: ["evidence:1"],
            resolutionNote: "must never be selected",
          },
        ]),
      },
    } as unknown as PrismaService;
    const audit = {
      write: jest.fn<AuditWriterService["write"]>(),
    } as unknown as jest.Mocked<AuditWriterService>;
    const handler = new GetReconciliationContextHandler(prisma, audit);

    const response = await handler.execute(
      new GetReconciliationContextQuery(
        "assessment-1",
        "org-1",
        "corr-1",
        "flow-1",
        50,
      ),
    );

    expect(response.tool_name).toBe(
      AGENTIC_TOOL_NAMES.getReconciliationContext,
    );
    expect(response.result.conflicts).toEqual([
      expect.objectContaining({
        conflict_ref: "conflict:conflict-1",
        status: RECONCILIATION_CONTEXT_STATUSES.open,
        evidence_refs: ["evidence:1"],
      }),
    ]);
    expect(response.result.permitted_resolution_paths).toEqual([
      expect.objectContaining({
        path_id: RECONCILIATION_RESOLUTION_PATHS.humanReconcile,
      }),
    ]);
    expect(JSON.stringify(response)).not.toContain("resolutionNote");
  });
});
