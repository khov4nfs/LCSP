import { jest, describe, expect, it } from "@jest/globals";
import { AUTH_ERROR_CODES, USER_ACCESS_STATUSES } from "@lcsp/contracts/auth";

import {
  APPLICATION_ERROR_REASONS,
  ApplicationError,
} from "../../../../common/errors/application.error.ts";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { Session } from "../../domain/models/auth.models.ts";
import { PrismaSessionRepository } from "./prisma-session.repository.ts";

const makeSession = () =>
  Session.rehydrate({
    id: "session-1",
    userId: "user-1",
    tokenHash: "hash",
    expiresAt: Date.now() + 60_000,
  });

function makeRepository(input: {
  user: unknown;
  currentSession?: unknown;
  conditionalUpdateCount?: number;
}) {
  const conditionalUpdate = jest
    .fn<(args: unknown) => Promise<{ count: number }>>()
    .mockResolvedValue({ count: input.conditionalUpdateCount ?? 1 });
  const tx = {
    $queryRaw: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
    user: {
      findUnique: jest
        .fn<() => Promise<unknown>>()
        .mockResolvedValue(input.user),
    },
    authRecord: {
      findUnique: jest
        .fn<() => Promise<unknown>>()
        .mockResolvedValue(input.currentSession ?? { id: "session-1" }),
      updateMany: conditionalUpdate,
      create: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
    },
  };
  const prisma = {
    $transaction: (callback: (transaction: typeof tx) => Promise<unknown>) =>
      callback(tx),
  } as unknown as PrismaService;
  return { repository: new PrismaSessionRepository(prisma), tx };
}

function expectSessionFailure(error: unknown) {
  expect(error).toBeInstanceOf(ApplicationError);
  const applicationError = error as ApplicationError;
  expect(applicationError.code).toBe(AUTH_ERROR_CODES.sessionInvalid);
  expect(applicationError.reason).toBe(
    APPLICATION_ERROR_REASONS.authenticationRequired,
  );
  expect(applicationError.correlationId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i,
  );
}

describe("PrismaSessionRepository transport-neutral failures", () => {
  it("rejects a suspended owner before persisting the session", async () => {
    const { repository, tx } = makeRepository({
      user: {
        accessStatus: USER_ACCESS_STATUSES.suspended,
        accessVersion: 0,
        mfaEncryptedSecret: null,
        mfaVerifiedAt: null,
      },
    });
    try {
      await repository.save(makeSession(), "token-fingerprint");
      throw new Error("Expected rejected session save");
    } catch (error) {
      expectSessionFailure(error);
    }
    expect(tx.authRecord.updateMany).not.toHaveBeenCalled();
    expect(tx.authRecord.create).not.toHaveBeenCalled();
  });

  it("rejects a previously verified session that attempts to restore MFA proof after generation rotation", async () => {
    const { repository, tx } = makeRepository({
      user: {
        accessStatus: USER_ACCESS_STATUSES.active,
        accessVersion: 0,
        mfaGenerationId: "current-generation",
        mfaEncryptedSecret: "new-totp-ciphertext",
        mfaVerifiedAt: new Date(),
      },
    });
    const staleSession = Session.rehydrate({
      id: "session-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: Date.now() + 60_000,
      mfaGenerationId: "previous-generation",
      mfaVerifiedAt: Date.now() - 10_000,
      sensitiveActionVerifiedAt: Date.now() - 10_000,
    });
    await expect(
      repository.save(staleSession, "token-fingerprint"),
    ).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.sessionInvalid,
      reason: APPLICATION_ERROR_REASONS.authenticationRequired,
    });
    expect(tx.authRecord.updateMany).not.toHaveBeenCalled();
  });

  it("rejects stale sensitive-action reauthentication even when MFA timestamp is null", async () => {
    const { repository, tx } = makeRepository({
      user: {
        accessStatus: USER_ACCESS_STATUSES.active,
        accessVersion: 0,
        mfaGenerationId: "new-generation",
        mfaEncryptedSecret: null,
        mfaVerifiedAt: null,
      },
    });
    const staleSession = Session.rehydrate({
      id: "session-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: Date.now() + 60_000,
      mfaGenerationId: "disabled-generation",
      sensitiveActionVerifiedAt: Date.now(),
    });
    await expect(
      repository.save(staleSession, "token-fingerprint"),
    ).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.sessionInvalid,
    });
    expect(tx.authRecord.updateMany).not.toHaveBeenCalled();
  });

  it("allows revocation after rotation without rewriting newer security proof metadata", async () => {
    const { repository, tx } = makeRepository({
      user: {
        accessStatus: USER_ACCESS_STATUSES.active,
        accessVersion: 0,
        mfaGenerationId: "new-generation",
        mfaEncryptedSecret: null,
        mfaVerifiedAt: null,
      },
    });
    const now = Date.now();
    const staleSession = Session.rehydrate({
      id: "session-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: now + 60_000,
      revokedAt: now,
      mfaGenerationId: "old-generation",
      mfaVerifiedAt: now - 10_000,
      sensitiveActionVerifiedAt: now - 10_000,
    });
    await expect(
      repository.save(staleSession, "token-fingerprint"),
    ).resolves.toBeUndefined();
    expect(tx.authRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { revokedAt: new Date(now) },
      }),
    );
  });

  it("rejects a session revoked by a concurrent writer without reviving it", async () => {
    const { repository, tx } = makeRepository({
      user: {
        accessStatus: USER_ACCESS_STATUSES.active,
        accessVersion: 0,
        mfaEncryptedSecret: null,
        mfaVerifiedAt: null,
      },
      conditionalUpdateCount: 0,
    });
    try {
      await repository.save(makeSession(), "token-fingerprint");
      throw new Error("Expected rejected stale-session save");
    } catch (error) {
      expectSessionFailure(error);
    }
    expect(tx.authRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "session-1",
          userId: "user-1",
          revokedAt: null,
        }),
      }),
    );
  });
});
