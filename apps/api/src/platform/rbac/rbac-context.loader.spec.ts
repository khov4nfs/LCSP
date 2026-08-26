import { jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import type { MfaEnrollmentRepository } from "../../modules/auth-workspace/application/ports/persistence/mfa.repository.js";
import type { SessionRepository } from "../../modules/auth-workspace/application/ports/persistence/session.repository.js";
import type { UserRepository } from "../../modules/auth-workspace/application/ports/persistence/user.repository.js";
import { MfaEnrollment } from "../../modules/auth-workspace/domain/entities/mfa-enrollment.entity.js";
import { Session } from "../../modules/auth-workspace/domain/entities/session.entity.js";
import { User } from "../../modules/auth-workspace/domain/entities/user.entity.js";
import { hashSecret } from "../../modules/auth-workspace/infrastructure/security/security.utils.js";
import { RbacContextLoader } from "./rbac-context.loader.js";
import { LOCAL_RBAC_REASON_CODES } from "./rbac-reason-codes.js";

const NOW = 1_700_000_000_000;

function makeSession(
  overrides: Partial<ConstructorParameters<typeof Session>[0]> = {},
): Session {
  return Session.rehydrate({
    id: "session-1",
    userId: "user-1",
    tokenHash: hashSecret("raw-token"),
    expiresAt: NOW + 60_000,
    revokedAt: null,
    mfaVerifiedAt: null,
    ...overrides,
  });
}

function makeUser(
  overrides: Partial<Parameters<typeof User.rehydrate>[0]> = {},
): User {
  return User.rehydrate({
    id: "user-1",
    email: "user@example.com",
    passwordHash: "hash",
    emailVerified: true,
    failedLoginCount: 0,
    role: AUTH_USER_ROLES.customer,
    ...overrides,
  });
}

function makeLoader(
  overrides: {
    sessions?: Partial<SessionRepository>;
    users?: Partial<UserRepository>;
    mfaEnrollments?: Partial<MfaEnrollmentRepository>;
  } = {},
) {
  const sessions: SessionRepository = {
    nextId: overrides.sessions?.nextId ?? (() => "session-1"),
    save: overrides.sessions?.save ?? (() => Promise.resolve()),
    findByFingerprint:
      overrides.sessions?.findByFingerprint ??
      jest
        .fn<SessionRepository["findByFingerprint"]>()
        .mockResolvedValue(makeSession()),
    revokeAllForUser:
      overrides.sessions?.revokeAllForUser ?? (() => Promise.resolve()),
  };
  const users: UserRepository = {
    nextId: overrides.users?.nextId ?? (() => "user-1"),
    save: overrides.users?.save ?? (() => Promise.resolve()),
    findById:
      overrides.users?.findById ??
      jest.fn<UserRepository["findById"]>().mockResolvedValue(makeUser()),
    findByEmail: overrides.users?.findByEmail ?? (() => Promise.resolve(null)),
    findByRecoveryEmail:
      overrides.users?.findByRecoveryEmail ?? (() => Promise.resolve(null)),
    findByPrimaryEmail:
      overrides.users?.findByPrimaryEmail ?? (() => Promise.resolve(null)),
  };
  const mfaEnrollments: MfaEnrollmentRepository = {
    findByUserId:
      overrides.mfaEnrollments?.findByUserId ??
      jest
        .fn<MfaEnrollmentRepository["findByUserId"]>()
        .mockResolvedValue(null),
    save: overrides.mfaEnrollments?.save ?? (() => Promise.resolve()),
    deleteByUserId:
      overrides.mfaEnrollments?.deleteByUserId ?? (() => Promise.resolve()),
  };

  return new RbacContextLoader(sessions, users, mfaEnrollments);
}

describe("RbacContextLoader", () => {
  it("resolves the active session and user role on the happy path", async () => {
    const loader = makeLoader();

    const result = await loader.load("raw-token", NOW, {
      allowPendingMfa: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.id).toBe("session-1");
      expect(result.user.id).toBe("user-1");
      expect(result.user.role).toBe(AUTH_USER_ROLES.customer);
    }
  });

  it("returns SESSION_INVALID when no session matches the token fingerprint", async () => {
    const loader = makeLoader({
      sessions: {
        findByFingerprint: jest
          .fn<SessionRepository["findByFingerprint"]>()
          .mockResolvedValue(null),
      },
    });

    await expect(loader.load("raw-token", NOW)).resolves.toEqual({
      ok: false,
      reason: LOCAL_RBAC_REASON_CODES.sessionInvalid,
    });
  });

  it("returns SESSION_INVALID when the session is expired, revoked, or token hash mismatches", async () => {
    for (const session of [
      makeSession({ expiresAt: NOW - 1000 }),
      makeSession({ revokedAt: NOW - 1000 }),
      makeSession({ tokenHash: hashSecret("different-token") }),
    ]) {
      const loader = makeLoader({
        sessions: {
          findByFingerprint: jest
            .fn<SessionRepository["findByFingerprint"]>()
            .mockResolvedValue(session),
        },
      });

      await expect(loader.load("raw-token", NOW)).resolves.toEqual({
        ok: false,
        reason: LOCAL_RBAC_REASON_CODES.sessionInvalid,
      });
    }
  });

  it("does not require verification while MFA setup is still pending", async () => {
    const loader = makeLoader({
      mfaEnrollments: {
        findByUserId: jest
          .fn<MfaEnrollmentRepository["findByUserId"]>()
          .mockResolvedValue(
            new MfaEnrollment({
              userId: "user-1",
              encryptedSecret: "enc",
              enrolledAt: NOW,
            }),
          ),
      },
    });

    const result = await loader.load("raw-token", NOW);

    expect(result.ok).toBe(true);
  });

  it("returns MFA_REQUIRED when verified MFA has not been satisfied by the session", async () => {
    const loader = makeLoader({
      mfaEnrollments: {
        findByUserId: jest
          .fn<MfaEnrollmentRepository["findByUserId"]>()
          .mockResolvedValue(
            new MfaEnrollment({
              userId: "user-1",
              encryptedSecret: "enc",
              enrolledAt: NOW,
              verifiedAt: NOW - 1000,
            }),
          ),
      },
    });

    await expect(loader.load("raw-token", NOW)).resolves.toEqual({
      ok: false,
      reason: LOCAL_RBAC_REASON_CODES.mfaRequired,
      mfaEnrolled: true,
    });
  });

  it("allows when MFA is verified by the session", async () => {
    const loader = makeLoader({
      sessions: {
        findByFingerprint: jest
          .fn<SessionRepository["findByFingerprint"]>()
          .mockResolvedValue(makeSession({ mfaVerifiedAt: NOW - 1000 })),
      },
      mfaEnrollments: {
        findByUserId: jest
          .fn<MfaEnrollmentRepository["findByUserId"]>()
          .mockResolvedValue(
            new MfaEnrollment({
              userId: "user-1",
              encryptedSecret: "enc",
              enrolledAt: NOW,
              verifiedAt: NOW - 1000,
            }),
          ),
      },
    });

    const result = await loader.load("raw-token", NOW);

    expect(result.ok).toBe(true);
  });

  it("returns LOAD_ERROR when the user cannot be loaded", async () => {
    const loader = makeLoader({
      users: {
        findById: jest.fn<UserRepository["findById"]>().mockResolvedValue(null),
      },
    });

    await expect(loader.load("raw-token", NOW)).resolves.toEqual({
      ok: false,
      reason: LOCAL_RBAC_REASON_CODES.loadError,
    });
  });

  it("returns LOAD_ERROR when a repository throws", async () => {
    const loader = makeLoader({
      sessions: {
        findByFingerprint: jest
          .fn<SessionRepository["findByFingerprint"]>()
          .mockRejectedValue(new Error("db unavailable")),
      },
    });

    await expect(loader.load("raw-token", NOW)).resolves.toEqual({
      ok: false,
      reason: LOCAL_RBAC_REASON_CODES.loadError,
    });
  });
});
