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
  preflightBytes?: number;
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

  let persistedVersion = latestVersion;
  const findLatest = jest.fn(() =>
    persistedVersion === null ? null : { version: persistedVersion },
  );
  let pageIndex = 0;
  const findMany = jest.fn<(input: { take: number }) => typeof rows>(
    (input) => {
      const page = rows.slice(pageIndex, pageIndex + input.take);
      pageIndex += page.length;
      return page;
    },
  );
  const payloadBytes =
    options?.preflightBytes ??
    rows.reduce(
      (total, row) =>
        total + Buffer.byteLength(JSON.stringify(row.payload), "utf8"),
      0,
    );
  const preflight = jest
    .fn<
      (
        strings: TemplateStringsArray,
      ) => Promise<Array<{ eventCount?: bigint; payloadBytes?: bigint }>>
    >()
    .mockImplementation((strings) =>
      Promise.resolve(
        strings.join("").includes('"eventCount"')
          ? [{ eventCount: BigInt(rows.length) }]
          : [{ payloadBytes: BigInt(payloadBytes) }],
      ),
    );
  const create = jest.fn<
    (input: {
      data: { status: string; checksumSha256: string; version: number };
    }) => {
      id: string;
    }
  >((input) => {
    persistedVersion = input.data.version;
    return { id: "export-1" };
  });
  let transactionTail = Promise.resolve();
  const prisma = {
    auditExportRequest: { findFirst: findLatest, create },
    auditEvent: { findMany },
    $queryRaw: preflight,
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      // The fake lock serializes transactions so concurrent version assertions model PostgreSQL.
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await callback({
          $executeRaw: () => Promise.resolve(1),
          auditExportRequest: { findFirst: findLatest, create },
        });
      } finally {
        release();
      }
    },
  } as unknown as PrismaService;

  const write = jest
    .fn<AuditWriterService["writeInTx"]>()
    .mockResolvedValue(undefined);
  const auditWriter = { writeInTx: write } as unknown as AuditWriterService;

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

  return { handler, command, findLatest, findMany, preflight, create, write };
}

describe("ExportAuditTrailHandler", () => {
  it("rejects an oversized database payload before fetching event JSON", async () => {
    const { handler, command, findMany, preflight } = buildHandler({
      preflightBytes: 6 * 1024 * 1024,
    });
    await expect(handler.execute(command)).rejects.toMatchObject({
      response: { problem: { code: AUDIT_ERROR_CODES.invalidQuery } },
    });
    expect(preflight).toHaveBeenCalledTimes(2);
    expect(findMany).not.toHaveBeenCalled();
  });
  it("bounds the audit query before constructing a persisted artifact", async () => {
    const { handler, command, findMany } = buildHandler();
    await handler.execute(command);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 100 }),
    );
  });

  it("reads a 101-event export in stable pages of at most 100", async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({
      id: `evt-${String(index).padStart(3, "0")}`,
      eventType: "AUTH_SIGN_IN",
      actorId: "user-1",
      decision: AUDIT_DECISIONS.allow,
      payload: { ordinal: index },
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
    }));
    const { handler, command, findMany, create } = buildHandler({ rows });
    await handler.execute(command);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ take: 100 });
    expect(findMany.mock.calls[1]?.[0]).toMatchObject({
      take: 100,
      where: { OR: expect.any(Array) },
    });
    expect(
      (
        create.mock.calls[0]?.[0].data as {
          contentJson?: { total_events: number };
        }
      ).contentJson?.total_events,
    ).toBe(101);
  });

  it("rejects a result larger than the event and byte limits before persistence", async () => {
    const row = {
      id: "evt-1",
      eventType: "AUTH_SIGN_IN",
      actorId: "user-1",
      decision: AUDIT_DECISIONS.allow,
      payload: {},
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
    };
    const tooMany = buildHandler({
      rows: Array.from({ length: 10_001 }, () => row),
    });
    await expect(
      tooMany.handler.execute(tooMany.command),
    ).rejects.toMatchObject({
      response: { problem: { code: AUDIT_ERROR_CODES.invalidQuery } },
    });
    expect(tooMany.create).not.toHaveBeenCalled();

    const largePayload = Object.fromEntries(
      Array.from({ length: 1_500 }, (_, index) => [
        `note${index}`,
        "x".repeat(4_000),
      ]),
    );
    const oversized = buildHandler({
      rows: [{ ...row, payload: largePayload }],
    });
    await expect(
      oversized.handler.execute(oversized.command),
    ).rejects.toMatchObject({
      response: { problem: { code: AUDIT_ERROR_CODES.invalidQuery } },
    });
    expect(oversized.create).not.toHaveBeenCalled();
  });

  it("propagates audit persistence failure from the transaction", async () => {
    const { handler, command, write } = buildHandler();
    write.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(handler.execute(command)).rejects.toThrow("audit unavailable");
  });

  it("commits the export and its audit event in the same transaction", async () => {
    const { handler, command, create, write } = buildHandler();
    await handler.execute(command);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.any(Object) }),
    );
    expect(write).toHaveBeenCalledWith(expect.any(Object), expect.any(Object));
  });

  it("does not assign the same version to concurrent exports", async () => {
    const { handler, command, create } = buildHandler();
    await Promise.all([handler.execute(command), handler.execute(command)]);
    const versions = create.mock.calls.map(([input]) => input.data.version);
    expect(new Set(versions).size).toBe(2);
  });
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
      expect.any(Object),
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
