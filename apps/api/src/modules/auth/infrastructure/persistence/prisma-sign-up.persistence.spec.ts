import { describe, expect, it, jest } from "@jest/globals";

import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.ts";
import type { AuditWriterService } from "../../../../platform/audit/audit-writer.service.ts";
import type { AuthAuditService } from "../../application/services/auth/auth-audit.service.ts";
import { Session, User } from "../../domain/models/auth.models.ts";
import { PrismaSignUpPersistence } from "./prisma-sign-up.persistence.ts";

function makeFixture() {
  const user = new User({
    email: "test-signup-generation@example.test",
    passwordHash: "test-only-password-hash",
    emailVerified: true,
  });
  const transaction = jest.fn();
  const repository = new PrismaSignUpPersistence(
    { $transaction: transaction } as unknown as PrismaService,
    {} as AuthAuditService,
    {} as AuditWriterService,
  );
  return { user, repository, transaction };
}

describe("PrismaSignUpPersistence initial MFA generation invariant", () => {
  it("rejects a session with another generation before starting any transaction", async () => {
    const { user, repository, transaction } = makeFixture();
    const session = new Session({
      userId: user.id,
      mfaGenerationId: "different-generation",
      tokenHash: "test-only-token-hash",
      expiresAt: Date.now() + 60_000,
    });

    await expect(
      repository.createWithSessionAndAudit({
        user,
        session,
        tokenFingerprint: "test-only-fingerprint",
        correlationId: "test-signup-generation-mismatch",
      }),
    ).rejects.toThrow(
      "Sign-up session must match the new user's MFA generation",
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects a session for a different user even if its generation matches", async () => {
    const { user, repository, transaction } = makeFixture();
    const session = new Session({
      userId: "different-user",
      mfaGenerationId: user.mfaGenerationId,
      tokenHash: "test-only-token-hash",
      expiresAt: Date.now() + 60_000,
    });

    await expect(
      repository.createWithSessionAndAudit({
        user,
        session,
        tokenFingerprint: "test-only-fingerprint",
        correlationId: "test-signup-owner-mismatch",
      }),
    ).rejects.toThrow(
      "Sign-up session must match the new user's MFA generation",
    );
    expect(transaction).not.toHaveBeenCalled();
  });
});
