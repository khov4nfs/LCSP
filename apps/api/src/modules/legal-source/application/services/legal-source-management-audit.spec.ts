import { describe, expect, it, jest } from "@jest/globals";
import { Prisma } from "@prisma/client";

import { LegalSourceManagementService } from "./legal-source-management.service.js";

describe("Legal Source Admin audit authority", () => {
  it("does not persist a new source when its creation audit fails", async () => {
    // Why: A failed audit must not leave an Admin-created source that a retry cannot explain.
    // How: Model a transaction's pending row separately from the committed row.
    // Invariant: Source and audit are one durable decision.
    let committed: object | null = null;
    let pending: object | null = null;
    const createRoot = jest
      .fn<() => Promise<{ id: string }>>()
      .mockImplementation(() => {
        committed = { id: "source-1" };
        return Promise.resolve({ id: "source-1" });
      });
    const createInTx = jest
      .fn<() => Promise<{ id: string }>>()
      .mockImplementation(() => {
        pending = { id: "source-1" };
        return Promise.resolve({ id: "source-1" });
      });
    const tx = { legalSource: { create: createInTx } };
    const prisma = {
      legalSource: { create: createRoot },
      $transaction: async (work: (client: typeof tx) => Promise<unknown>) => {
        const value = await work(tx);
        committed = pending;
        return value;
      },
    };
    const audit = {
      write: jest
        .fn<() => Promise<void>>()
        .mockRejectedValue(new Error("audit unavailable")),
      writeInTx: jest
        .fn<() => Promise<void>>()
        .mockRejectedValue(new Error("audit unavailable")),
    };
    const service = new LegalSourceManagementService(
      prisma as never,
      audit as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.createSource({
        actorId: "admin-1",
        correlationId: "red-test",
        request: { name: "Audit fenced source" },
      }),
    ).rejects.toThrow("audit unavailable");
    expect(
      createRoot.mock.calls.length + createInTx.mock.calls.length,
    ).toBeGreaterThan(0);
    expect(
      audit.write.mock.calls.length + audit.writeInTx.mock.calls.length,
    ).toBeGreaterThan(0);
    expect(committed).toBeNull();
  });

  it("records an Admin metadata update in the audit log", async () => {
    // Why: A name or description change alters what customers see as the Legal Source identity.
    // How: Exercise the application service with a valid source and observe the audit boundary.
    // Invariant: An Admin mutation must be attributable to its actor and correlation ID.
    const findUnique = jest
      .fn<() => Promise<{ id: string }>>()
      .mockResolvedValue({ id: "source-1" });
    const update = jest
      .fn<() => Promise<{ id: string }>>()
      .mockResolvedValue({ id: "source-1" });
    const tx = { legalSource: { findUnique, update } };
    const prisma = {
      legalSource: { findUnique, update },
      $transaction: async (work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
    };
    const audit = {
      write: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      writeInTx: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };
    const service = new LegalSourceManagementService(
      prisma as never,
      audit as never,
      {} as never,
      {} as never,
    );
    jest
      .spyOn(service, "getSource")
      .mockResolvedValue({ id: "source-1" } as never);

    await service.updateSource({
      sourceId: "source-1",
      actorId: "admin-1",
      correlationId: "red-test",
      request: { name: "Corrected source name" },
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(
      audit.write.mock.calls.length + audit.writeInTx.mock.calls.length,
    ).toBeGreaterThan(0);
  });

  it("does not treat an audit uniqueness error as a slug collision", async () => {
    // Why: A broad P2002 catch can retry source creation after the audit insert fails.
    // How: Raise an AuditEvent uniqueness error inside the transaction.
    // Invariant: Only LegalSource.slug conflicts may choose another generated slug.
    const auditError = new Prisma.PrismaClientKnownRequestError(
      "Audit unique conflict",
      {
        code: "P2002",
        clientVersion: "7.10.1",
        meta: { modelName: "AuditEvent", target: ["id"] },
      },
    );
    const create = jest
      .fn<() => Promise<{ id: string }>>()
      .mockResolvedValue({ id: "source-1" });
    const tx = { legalSource: { create } };
    const prisma = {
      legalSource: { create },
      $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx),
    };
    const audit = {
      write: jest.fn<() => Promise<void>>().mockRejectedValue(auditError),
      writeInTx: jest.fn<() => Promise<void>>().mockRejectedValue(auditError),
    };
    const service = new LegalSourceManagementService(
      prisma as never,
      audit as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.createSource({
        actorId: "admin-1",
        correlationId: "red-test",
        request: { name: "Audit collision source" },
      }),
    ).rejects.toBe(auditError);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
