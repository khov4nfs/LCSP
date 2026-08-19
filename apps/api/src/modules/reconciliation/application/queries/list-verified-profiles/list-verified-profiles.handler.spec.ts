import { describe, expect, it, jest } from "@jest/globals";
import {
  SCAN_EVENT_TYPES,
  VERIFIED_PROFILE_STATUSES,
} from "@lcsp/contracts/scan";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { ListVerifiedProfilesHandler } from "./list-verified-profiles.handler.js";
import { ListVerifiedProfilesQuery } from "./list-verified-profiles.query.js";

function buildHandler(rows: object[] = [], totalCount: number = 0) {
  const findMany = jest
    .fn<(args: unknown) => Promise<object[]>>()
    .mockResolvedValue(rows);
  const count = jest
    .fn<(args: unknown) => Promise<number>>()
    .mockResolvedValue(totalCount);
  const write = jest
    .fn<(event: unknown) => Promise<void>>()
    .mockResolvedValue(undefined);
  const prisma = {
    verifiedProfile: { findMany, count },
  } as unknown as PrismaService;
  const auditWriter = { write } as unknown as AuditWriterService;
  const handler = new ListVerifiedProfilesHandler(prisma, auditWriter);
  const query = new ListVerifiedProfilesQuery(
    "assessment-1",
    "org-1",
    "corr-1",
  );
  return { handler, query, findMany, count, write };
}

describe("ListVerifiedProfilesHandler", () => {
  it("returns all versions ordered by version asc", async () => {
    const now = new Date("2026-08-18T00:00:00.000Z");
    const { handler, query, findMany } = buildHandler([
      {
        id: "vp-1",
        version: 1,
        aiUsageFlowId: "flow-old",
        wizardProfileId: "wizard-1",
        technicalEvidenceReportId: "report-1",
        reconciliationDecisionRefs: ["reconciliation:conflict-1"],
        status: "STALE",
        approvedAt: null,
        approvedById: null,
        createdAt: now,
        gatesPassedAt: { reconciliation_complete: now.toISOString() },
      },
      {
        id: "vp-2",
        version: 2,
        aiUsageFlowId: "flow-new",
        wizardProfileId: "wizard-1",
        technicalEvidenceReportId: "report-2",
        reconciliationDecisionRefs: ["reconciliation:conflict-2"],
        status: "PENDING_APPROVAL",
        approvedAt: null,
        approvedById: null,
        createdAt: now,
        gatesPassedAt: { reconciliation_complete: now.toISOString() },
      },
    ]);

    const result = await handler.execute(query);

    expect(result.profiles).toHaveLength(2);
    expect(result.profiles[0].id).toBe("vp-1");
    expect(result.profiles[0].status).toBe(VERIFIED_PROFILE_STATUSES.stale);
    expect(result.profiles[1].id).toBe("vp-2");
    expect(result.profiles[1].status).toBe(
      VERIFIED_PROFILE_STATUSES.pendingApproval,
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assessmentId: "assessment-1", organizationId: "org-1" },
        orderBy: { version: "asc" },
      }),
    );
  });

  it("returns an empty list when no profiles exist", async () => {
    const { handler, query } = buildHandler([]);

    const result = await handler.execute(query);

    expect(result.profiles).toHaveLength(0);
  });

  it("writes an audit event with returnedCount", async () => {
    const { handler, query, write } = buildHandler([], 0);

    await handler.execute(query);

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: SCAN_EVENT_TYPES.verifiedProfileHistoryReadAudit,
        assessmentId: "assessment-1",
        organizationId: "org-1",
        payload: expect.objectContaining({ returnedCount: 0 }),
      }),
    );
  });
});
