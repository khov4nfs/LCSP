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
