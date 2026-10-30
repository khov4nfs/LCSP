import { USER_ACCESS_STATUSES } from "@lcsp/contracts/auth";
import * as assert from "node:assert/strict";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.ts";
import type { AuthAuditService } from "../../application/services/auth/auth-audit.service.ts";
import type { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { AUTH_RECORD_TYPES } from "./auth-record.persistence.ts";
import { PrismaAuthSecurityPersistence } from "./prisma-auth-security.persistence.ts";

function makeHarness(
  options: { consumed?: number; auditFails?: boolean } = {},
) {
  const calls: string[] = [];
  const tx = {
    $queryRaw: () => {
      calls.push("lock");
      return Promise.resolve([]);
    },
    $executeRaw: () => {
      calls.push("invalidate-session-proofs");
      return Promise.resolve(2);
    },
    user: {
      findUnique: () => {
        calls.push("read-user");
        return Promise.resolve({
          accessStatus: USER_ACCESS_STATUSES.active,
          accessVersion: 0,
          mfaEncryptedSecret: "encrypted",
          mfaEnrolledAt: new Date(),
          mfaGenerationId: "test-generation",
          mfaVerifiedAt: new Date(),
        });
      },
      update: () => {
        calls.push("update-user");
        return Promise.resolve();
      },
    },
    authRecord: {
      findFirst: () =>
        Promise.resolve({
          id: "session-1",
          userId: "user-1",
          type: AUTH_RECORD_TYPES.session,
          metadata: {
            accessVersion: 0,
            mfaVerifiedAt: new Date().toISOString(),
            mfaGenerationId: "test-generation",
            sensitiveActionVerifiedAt: new Date().toISOString(),
            passwordReauthenticatedAt: new Date().toISOString(),
          },
        }),
      updateMany: (args: { where: { type: string } }) => {
        calls.push(
          args.where.type === AUTH_RECORD_TYPES.recoveryRequest
            ? "claim-token"
            : "revoke-records",
        );
        return Promise.resolve({ count: options.consumed ?? 1 });
      },
      deleteMany: () => {
        calls.push("delete-otp");
        return Promise.resolve({ count: 0 });
      },
    },
  };
  const prisma = {
    $transaction: async (action: (client: typeof tx) => Promise<unknown>) => {
      calls.push("begin");
      const result = await action(tx);
      calls.push("commit");
      return result;
    },
  };
  const audit = {
    writeInTx: () => {
      calls.push("audit");
      if (options.auditFails)
        return Promise.reject(new Error("audit unavailable"));
      return Promise.resolve();
    },
  };
  const auditWriter = {
    forTransaction: () => ({ write: () => Promise.resolve() }),
  };
  const adapter = new PrismaAuthSecurityPersistence(
    prisma as unknown as PrismaService,
    audit as unknown as AuthAuditService,
    auditWriter as unknown as AuditWriterService,
  );
  return { adapter, calls };
}

describe("PrismaAuthSecurityPersistence transaction contract", () => {
  const recoveryInput = {
    requestId: "recovery-1",
    userId: "user-1",
    passwordHash: "new-password-hash",
    now: Date.now(),
    correlationId: "corr-1",
  };

  it("commits recovery token, credentials, revocations and audit in one transaction", async () => {
    const { adapter, calls } = makeHarness();
    assert.equal(await adapter.completePasswordRecovery(recoveryInput), true);
    assert.deepEqual(calls, [
      "begin",
      "lock",
      "read-user",
      "claim-token",
      "update-user",
      "revoke-records",
      "audit",
      "commit",
    ]);
  });

  it("does not mutate credentials after a recovery token was consumed", async () => {
    const { adapter, calls } = makeHarness({ consumed: 0 });
    assert.equal(await adapter.completePasswordRecovery(recoveryInput), false);
    assert.deepEqual(calls, [
      "begin",
      "lock",
      "read-user",
      "claim-token",
      "commit",
    ]);
  });

  it("propagates audit failure instead of committing a partial recovery", async () => {
    const { adapter, calls } = makeHarness({ auditFails: true });
    await assert.rejects(
      () => adapter.completePasswordRecovery(recoveryInput),
      /audit unavailable/,
    );
    assert.equal(calls.includes("commit"), false);
  });

  it("disables MFA and invalidates proofs for every session in one transaction", async () => {
    const { adapter, calls } = makeHarness();
    const result = await adapter.disableMfa({
      userId: "user-1",
      sessionId: "session-1",
      now: Date.now(),
      correlationId: "corr-disable",
    });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(calls, [
      "begin",
      "lock",
      "read-user",
      "lock",
      "update-user",
      "invalidate-session-proofs",
      "revoke-records",
      "delete-otp",
      "audit",
      "commit",
    ]);
  });
});
