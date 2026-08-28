import { describe, expect, it, jest } from "@jest/globals";
import {
  AUDIT_DECISIONS,
  AUDIT_ERROR_CODES,
  AUDIT_EVENT_TYPES,
  AUDIT_EXPORT_STATUSES,
} from "@lcsp/contracts/audit";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { AuditRedactorService } from "../../services/audit/audit-redactor.service.js";
import { ExportAuditTrailCommand } from "./export-audit-trail.command.js";
import { ExportAuditTrailHandler } from "./export-audit-trail.handler.js";

function buildHandler(options?: {
  latestVersion?: number | null;
  rows?: Array<{
    id: string;
    eventType: string;
    actorId: string | null;
    decision: string | null;
    payload: Record<string, unknown>;
    createdAt: Date;
  }>;
}) {
  const latestVersion =
    options?.latestVersion === undefined ? 2 : options.latestVersion;
  const rows = options?.rows ?? [
    {
      id: "evt-1",
      eventType: "AUTH_SIGN_IN",
      actorId: "user-1",
      decision: AUDIT_DECISIONS.allow,
      payload: { email: "masked@example.com", password: "secret" },
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
    },
  ];

  const findLatest = jest.fn(() =>
    latestVersion === null ? null : { version: latestVersion },
  );
  const findMany = jest.fn(() => rows);
  const create = jest.fn<
    (input: { data: { status: string; checksumSha256: string } }) => {
      id: string;
    }
  >(() => ({ id: "export-1" }));
  const prisma = {
    auditExportRequest: { findFirst: findLatest, create },
    auditEvent: { findMany },
  } as unknown as PrismaService;

  const write = jest
    .fn<AuditWriterService["write"]>()
    .mockResolvedValue(undefined);
  const auditWriter = { write } as unknown as AuditWriterService;

  const handler = new ExportAuditTrailHandler(
    prisma,
    new AuditRedactorService(),
    auditWriter,
  );

  const command = new ExportAuditTrailCommand(
    "user-1",
    "2026-07-01T00:00:00.000Z",
    "2026-07-31T23:59:59.999Z",
    "corr-1",
  );

  return { handler, command, findLatest, findMany, create, write };
}

describe("ExportAuditTrailHandler", () => {
  it("creates a READY audit export with checksum and audit event", async () => {
    const { handler, command, create, write } = buildHandler();

    const result = await handler.execute(command);

    expect(result.status).toBe(AUDIT_EXPORT_STATUSES.ready);
    expect(result.version).toBe(3);
    expect(create).toHaveBeenCalledTimes(1);

    const created = create.mock.calls[0]?.[0] as
      { data: { status: string; checksumSha256: string } } | undefined;
    expect(created).toBeDefined();
    if (!created) {
      throw new Error("Expected create() to be called");
    }
    expect(created.data.status).toBe(AUDIT_EXPORT_STATUSES.ready);
    expect(created.data.checksumSha256).toMatch(/^[a-f0-9]{64}$/);

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: AUDIT_EVENT_TYPES.exportGenerated,
        decision: AUDIT_DECISIONS.allow,
        correlationId: "corr-1",
      }),
    );
  });

  it("rejects invalid date range over 365 days", async () => {
    const { handler, command } = buildHandler();

    await expect(
      handler.execute(
        new ExportAuditTrailCommand(
          command.requestedById,
          "2025-01-01T00:00:00.000Z",
          "2026-07-31T23:59:59.999Z",
          command.correlationId,
        ),
      ),
    ).rejects.toMatchObject({
      response: {
        ok: false,
        problem: {
          code: AUDIT_ERROR_CODES.dateRangeExceeded,
          correlationId: "corr-1",
        },
      },
    });
  });

  it("rejects invalid date format", async () => {
    const { handler, command } = buildHandler();

    await expect(
      handler.execute(
        new ExportAuditTrailCommand(
          command.requestedById,
          "nope",
          command.toDate,
          command.correlationId,
        ),
      ),
    ).rejects.toMatchObject({
      response: {
        ok: false,
        problem: {
          code: AUDIT_ERROR_CODES.invalidQuery,
          correlationId: "corr-1",
          meta: { field: "from_date" },
        },
      },
    });
  });
});
