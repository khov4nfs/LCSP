import { describe, expect, it, jest } from "@jest/globals";
import { firstValueFrom } from "rxjs";

import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { WorkspaceRuntimeEventsController } from "./workspace-runtime-events.controller.js";

describe("WorkspaceRuntimeEventsController", () => {
  it("publishes only organization-scoped runtime metadata", async () => {
    const scanFindMany = jest
      .fn<(args: unknown) => Promise<unknown[]>>()
      .mockResolvedValue([
        {
          id: "scan-job-1",
          assessmentId: "assessment-1",
          snapshotId: "snapshot-1",
          status: "RUNNING",
          attemptCount: 2,
          blockedReason: null,
          updatedAt: new Date("2026-08-09T14:00:00.000Z"),
        },
      ]);
    const reportFindMany = jest
      .fn<(args: unknown) => Promise<unknown[]>>()
      .mockResolvedValue([]);
    const controller = new WorkspaceRuntimeEventsController({
      repositoryScanJob: { findMany: scanFindMany },
      technicalEvidenceReport: { findMany: reportFindMany },
    } as unknown as PrismaService);

    const event = await firstValueFrom(
      controller.stream({ pbacContext: { organizationId: "org-1" } } as never),
    );

    expect(scanFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-1" } }),
    );
    expect(reportFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org-1" } }),
    );
    expect(event.type).toBe("workspace.runtime");
    expect(event.data).toMatchObject({
      scan_jobs: [
        {
          id: "scan-job-1",
          assessment_id: "assessment-1",
          snapshot_id: "snapshot-1",
          status: "RUNNING",
          attempt_count: 2,
          blocked_reason: null,
          updated_at: "2026-08-09T14:00:00.000Z",
        },
      ],
      evidence_reports: [],
    });
  });
});
