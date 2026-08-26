import { describe, expect, it, jest } from "@jest/globals";
import {
  AUDIT_ERROR_CODES,
  AUDIT_EXPORT_STATUSES,
} from "@lcsp/contracts/audit";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditExportStorageService } from "../../../infrastructure/storage/audit-export-storage.service.js";
import { GetAuditExportHandler } from "./get-audit-export.handler.js";
import { GetAuditExportQuery } from "./get-audit-export.query.js";

function buildHandler(
  record?: Partial<{
    id: string;
    fromDate: Date;
    toDate: Date;
    status: string;
    version: number;
    checksumSha256: string;
    correlationId: string;
    createdAt: Date;
    completedAt: Date | null;
  }> | null,
) {
  const findFirst = jest.fn(() =>
    record === null
      ? null
      : {
          id: "export-1",
          fromDate: new Date("2026-07-01T00:00:00.000Z"),
          toDate: new Date("2026-07-31T23:59:59.999Z"),
          status: AUDIT_EXPORT_STATUSES.ready,
          version: 1,
          checksumSha256: "a".repeat(64),
          correlationId: "corr-1",
          createdAt: new Date("2026-07-28T10:00:00.000Z"),
          completedAt: new Date("2026-07-28T10:00:01.000Z"),
          ...record,
        },
  );

  const prisma = {
    auditExportRequest: { findFirst },
  } as unknown as PrismaService;

  const handler = new GetAuditExportHandler(
    prisma,
    new AuditExportStorageService(),
  );
  const query = new GetAuditExportQuery("export-1", "corr-1");

  return { handler, query };
}

describe("GetAuditExportHandler", () => {
  it("returns signed download url when export is READY", async () => {
    const { handler, query } = buildHandler();

    const result = await handler.execute(query);

    expect(result.status).toBe(AUDIT_EXPORT_STATUSES.ready);
    expect(result.download_url).toContain(
      "/audit-events/export/export-1/download?token=",
    );
    expect(result.download_url_expires_at).toBeTruthy();
  });

  it("returns null download url when export is not ready", async () => {
    const { handler, query } = buildHandler({
      status: AUDIT_EXPORT_STATUSES.generating,
      completedAt: null,
    });

    const result = await handler.execute(query);

    expect(result.download_url).toBeNull();
    expect(result.download_url_expires_at).toBeNull();
  });

  it("throws AUDIT_EXPORT_NOT_FOUND when request does not exist", async () => {
    const { handler, query } = buildHandler(null);

    await expect(handler.execute(query)).rejects.toMatchObject({
      response: {
        ok: false,
        problem: {
          code: AUDIT_ERROR_CODES.exportNotFound,
          correlationId: "corr-1",
        },
      },
    });
  });
});
