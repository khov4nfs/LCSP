import { describe, expect, it, jest } from "@jest/globals";
import {
  ADMIN_ACCOUNT_ERRORS,
  ADMIN_ACCOUNT_OPERATIONS,
  AUTH_ACCOUNT_STATUSES,
  AUTH_USER_ROLES,
} from "@lcsp/contracts/auth";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { AuthAuditService } from "../../../auth/application/services/auth/auth-audit.service.js";
import { SuspendUserCommand } from "./suspend-user/suspend-user.command.js";
import { SuspendUserHandler } from "./suspend-user/suspend-user.handler.js";
import { RestoreUserCommand } from "./restore-user/restore-user.command.js";
import { RestoreUserHandler } from "./restore-user/restore-user.handler.js";
import {
  accountTransaction,
  canonicalRequestHash,
  legacyRequestHash,
  type AdminActor,
} from "../../infrastructure/persistence/admin-account.transaction.js";

describe("Admin CQRS Commands", () => {
  const mockActor: AdminActor = {
    userId: "admin-1",
    sessionId: "sess-1",
    role: AUTH_USER_ROLES.admin,
    scope: "ALL",
    correlationId: "corr-1",
    idempotencyKey: "idem-1",
  };

  const createMockPrisma = (
    initialStatus = "ACTIVE",
    seededReceipt: unknown = null,
  ) => {
    const txMock = {
      user: {
        findUnique: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValueOnce({
            id: "admin-1",
            role: AUTH_USER_ROLES.admin,
            accessStatus: "ACTIVE",
            emailVerified: true,
            accessVersion: 0,
          })
          .mockResolvedValueOnce({
            id: "user-1",
            role: AUTH_USER_ROLES.customer,
            accessStatus: initialStatus,
            accessVersion: 1,
            email: "user@example.com",
            displayName: "Test User",
            createdAt: new Date(),
          })
          .mockResolvedValueOnce({
            id: "user-1",
            role: AUTH_USER_ROLES.customer,
            accessStatus: initialStatus === "ACTIVE" ? "SUSPENDED" : "ACTIVE",
            accessVersion: 2,
            email: "user@example.com",
            displayName: "Test User",
            createdAt: new Date(),
          }),
        count: jest.fn<() => Promise<number>>().mockResolvedValue(1),
        updateMany: jest
          .fn<() => Promise<{ count: number }>>()
          .mockResolvedValue({ count: 1 }),
      },
      authRecord: {
        findFirst: jest.fn<() => Promise<unknown>>().mockResolvedValueOnce({
          id: "sess-1",
          userId: "admin-1",
          type: "SESSION",
          revokedAt: null,
          expiresAt: new Date(Date.now() + 10000),
        }),
        updateMany: jest
          .fn<() => Promise<{ count: number }>>()
          .mockResolvedValue({ count: 1 }),
        aggregate: jest
          .fn<() => Promise<{ _max: { createdAt: Date | null } }>>()
          .mockResolvedValue({
            _max: { createdAt: null },
          }),
      },
      adminAccountCommandReceipt: {
        findUnique: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValue(seededReceipt),
        create: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValue({ id: "rec-1" }),
      },
      assessment: {
        count: jest.fn<() => Promise<number>>().mockResolvedValue(0),
        aggregate: jest
          .fn<() => Promise<{ _max: { createdAt: Date | null } }>>()
          .mockResolvedValue({
            _max: { createdAt: null },
          }),
      },
      $queryRaw: jest.fn<() => Promise<unknown>>().mockResolvedValue([]),
      $executeRaw: jest.fn<() => Promise<unknown>>().mockResolvedValue(1),
    };

    return {
      $transaction: jest.fn().mockImplementation((callback) => {
        return (callback as (tx: unknown) => Promise<unknown>)(txMock);
      }),
    } as unknown as PrismaService;
  };

  const audit = {
    writeInTx: jest.fn<() => Promise<unknown>>().mockResolvedValue(undefined),
  } as unknown as AuthAuditService;

  it("SuspendUserHandler executes suspend mutation", async () => {
    const prisma = createMockPrisma("ACTIVE");
    const handler = new SuspendUserHandler(prisma, audit);
    const command = new SuspendUserCommand(
      "user-1",
      { expectedVersion: 1 },
      mockActor,
    );
    const result = await handler.execute(command);

    expect(result.id).toBe("user-1");
    expect(result.status).toBe(AUTH_ACCOUNT_STATUSES.suspended);
  });

  it("RestoreUserHandler executes restore mutation", async () => {
    const prisma = createMockPrisma("SUSPENDED");
    const handler = new RestoreUserHandler(prisma, audit);
    const command = new RestoreUserCommand(
      "user-1",
      { expectedVersion: 1 },
      mockActor,
    );
    const result = await handler.execute(command);

    expect(result.id).toBe("user-1");
    expect(result.status).toBe(AUTH_ACCOUNT_STATUSES.active);
  });

  it("replays legacy-format SUSPEND receipt successfully with replayed: true", async () => {
    const legacyHash = legacyRequestHash(ADMIN_ACCOUNT_OPERATIONS.suspend, {
      id: "user-1",
      expectedVersion: 1,
      reason: "Legacy moderation reason",
    });

    const seededReceipt = {
      id: "rec-legacy-1",
      actorId: "admin-1",
      idempotencyKey: "idem-1",
      operation: ADMIN_ACCOUNT_OPERATIONS.suspend,
      requestHash: legacyHash,
      resourceId: "user-1",
    };

    const prisma = createMockPrisma("SUSPENDED", seededReceipt);
    const handler = new SuspendUserHandler(prisma, audit);
    const command = new SuspendUserCommand(
      "user-1",
      { expectedVersion: 1, reason: "Legacy moderation reason" },
      mockActor,
    );
    const result = await handler.execute(command);

    expect(result.id).toBe("user-1");
    expect(result.replayed).toBe(true);
  });

  it("replays legacy-format RESTORE receipt successfully with replayed: true", async () => {
    const legacyHash = legacyRequestHash(ADMIN_ACCOUNT_OPERATIONS.restore, {
      id: "user-1",
      expectedVersion: 1,
      reason: "Legacy restore reason",
    });

    const seededReceipt = {
      id: "rec-legacy-2",
      actorId: "admin-1",
      idempotencyKey: "idem-1",
      operation: ADMIN_ACCOUNT_OPERATIONS.restore,
      requestHash: legacyHash,
      resourceId: "user-1",
    };

    const prisma = createMockPrisma("ACTIVE", seededReceipt);
    const handler = new RestoreUserHandler(prisma, audit);
    const command = new RestoreUserCommand(
      "user-1",
      { expectedVersion: 1, reason: "Legacy restore reason" },
      mockActor,
    );
    const result = await handler.execute(command);

    expect(result.id).toBe("user-1");
    expect(result.replayed).toBe(true);
  });

  it("returns idempotency conflict when same key is retried with genuinely different payload", async () => {
    const seededReceipt = {
      id: "rec-1",
      actorId: "admin-1",
      idempotencyKey: "idem-1",
      operation: ADMIN_ACCOUNT_OPERATIONS.suspend,
      requestHash: "original-hash-value",
      resourceId: "user-1",
    };

    const prisma = createMockPrisma("ACTIVE", seededReceipt);
    const handler = new SuspendUserHandler(prisma, audit);
    const command = new SuspendUserCommand(
      "user-1",
      { expectedVersion: 99, reason: "Different payload" },
      mockActor,
    );

    await expect(handler.execute(command)).rejects.toMatchObject({
      status: 409,
    });
  });

  it("canonicalRequestHash produces identical hash regardless of key insertion order", () => {
    const hash1 = canonicalRequestHash(ADMIN_ACCOUNT_OPERATIONS.suspend, {
      id: "user-1",
      expectedVersion: 1,
      reason: "test",
    });

    const hash2 = canonicalRequestHash(ADMIN_ACCOUNT_OPERATIONS.suspend, {
      reason: "test",
      id: "user-1",
      expectedVersion: 1,
    });

    expect(hash1).toBe(hash2);
  });

  it("accountTransaction passes timeout: 15000, maxWait: 5000 options and maps P2028 to 409", async () => {
    let capturedOptions: unknown;
    const mockPrismaService = {
      $transaction: jest.fn().mockImplementation((_cb, options) => {
        capturedOptions = options;
        const err = new Error("Transaction timed out");
        (err as unknown as { code: string }).code = "P2028";
        return Promise.reject(err);
      }),
    } as unknown as PrismaService;

    await expect(
      accountTransaction(mockPrismaService, "corr-1", () =>
        Promise.resolve("ok"),
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: ADMIN_ACCOUNT_ERRORS.concurrentChange,
        }),
      }),
    });

    expect(capturedOptions).toEqual(
      expect.objectContaining({
        timeout: 15000,
        maxWait: 5000,
      }),
    );
  });

  it("fails when expectedVersion is missing or invalid", async () => {
    const prisma = createMockPrisma("ACTIVE");
    const handler = new SuspendUserHandler(prisma, audit);
    const command = new SuspendUserCommand(
      "user-1",
      { expectedVersion: -1 },
      mockActor,
    );
    await expect(handler.execute(command)).rejects.toThrow();
  });
});
