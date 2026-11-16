import { describe, it, expect, jest } from "@jest/globals";
import {
  AUTH_ERROR_CODES,
  AUTH_USER_ROLES,
  USER_ACCESS_STATUSES,
} from "@lcsp/contracts/auth";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import { Session } from "../../../domain/entities/session.entity.ts";
import { User } from "../../../domain/entities/user.entity.ts";
import type {
  SessionRepository,
  UserRepository,
} from "../../ports/persistence/index.ts";
import { SessionManagementService } from "./session-management.service.ts";
import { RevokeAllSessionsHandler } from "../../commands/revoke-all-sessions/revoke-all-sessions.handler.ts";
import { RevokeOwnedSessionHandler } from "../../commands/revoke-owned-session/revoke-owned-session.handler.ts";
import type { AuthSupportService } from "./auth-support.service.ts";

const now = 1_800_000_000_000;
const context = {
  userId: "owner",
  sessionId: "caller",
  role: AUTH_USER_ROLES.customer,
  scope: null,
};

function setup(sessionOverrides = {}, userOverrides = {}) {
  const session = Session.rehydrate({
    id: "caller",
    userId: "owner",
    tokenHash: "test-hash",
    expiresAt: now + 60_000,
    mfaGenerationId: "generation",
    passwordReauthenticatedAt: now - 1_000,
    ...sessionOverrides,
  });
  const user = User.rehydrate({
    id: "owner",
    email: "owner@example.com",
    passwordHash: "test-hash",
    emailVerified: true,
    mfaGenerationId: "generation",
    ...userOverrides,
  });
  const sessions = {
    findById: jest
      .fn<SessionRepository["findById"]>()
      .mockResolvedValue(session),
    revokeOwned: jest
      .fn<SessionRepository["revokeOwned"]>()
      .mockResolvedValue(true),
    revokeAllForUser: jest
      .fn<SessionRepository["revokeAllForUser"]>()
      .mockResolvedValue(undefined),
  };
  const users = {
    findById: jest.fn<UserRepository["findById"]>().mockResolvedValue(user),
  };
  const policy = new SessionManagementService(
    sessions as unknown as SessionRepository,
    users as unknown as UserRepository,
  );
  const support = {
    now: () => now,
    createCorrelationId: () => "correlation",
  } as AuthSupportService;
  return { policy, sessions, support };
}

describe("session management authorization and revocation", () => {
  it.each([
    [{ userId: "another-owner" }, {}, AUTH_ERROR_CODES.sessionInvalid],
    [{ revokedAt: now }, {}, AUTH_ERROR_CODES.sessionInvalid],
    [{ expiresAt: now }, {}, AUTH_ERROR_CODES.sessionInvalid],
    [{ accessVersion: 1 }, {}, AUTH_ERROR_CODES.sessionInvalid],
    [
      {},
      { accessStatus: USER_ACCESS_STATUSES.suspended },
      AUTH_ERROR_CODES.sessionInvalid,
    ],
    [{ passwordReauthenticatedAt: null }, {}, AUTH_ERROR_CODES.reauthRequired],
    [
      { passwordReauthenticatedAt: now - 300_001 },
      {},
      AUTH_ERROR_CODES.reauthRequired,
    ],
    [
      { passwordReauthenticatedAt: now + 1 },
      {},
      AUTH_ERROR_CODES.reauthRequired,
    ],
    [{ mfaGenerationId: "old" }, {}, AUTH_ERROR_CODES.reauthRequired],
    [{}, { mfaRequired: true }, AUTH_ERROR_CODES.mfaRequired],
  ])(
    "rejects invalid callers/proof without revoking: %j %j",
    async (session, user, code) => {
      const fixture = setup(session, user);
      const handler = new RevokeAllSessionsHandler(
        fixture.sessions as unknown as SessionRepository,
        fixture.support,
        fixture.policy,
      );
      await expect(
        handler.execute({ context, requestMeta: {} }),
      ).rejects.toMatchObject({ code });
      expect(fixture.sessions.revokeAllForUser).not.toHaveBeenCalled();
    },
  );

  it("accepts recent MFA step-up for OAuth accounts without a password", async () => {
    const { policy } = setup(
      { mfaVerifiedAt: now - 1_000, passwordReauthenticatedAt: null },
      { passwordHash: "", mfaRequired: true, mfaVerifiedAt: now - 10_000 },
    );
    await expect(
      policy.authorize(context, now, "correlation"),
    ).resolves.toBeUndefined();
  });

  it("revokes all sessions using only the authenticated owner", async () => {
    const { sessions, support, policy } = setup();
    const handler = new RevokeAllSessionsHandler(
      sessions as unknown as SessionRepository,
      support,
      policy,
    );
    await expect(
      handler.execute({ context, requestMeta: {} }),
    ).resolves.toEqual({ ok: true, revoked_all: true });
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith("owner", now);
  });

  it("maps foreign or missing targets to not-found without invalidating the caller", async () => {
    const { sessions, support, policy } = setup();
    sessions.revokeOwned.mockResolvedValue(false);
    const handler = new RevokeOwnedSessionHandler(
      sessions as unknown as SessionRepository,
      support,
      policy,
    );
    await expect(
      handler.execute({ context, sessionId: "foreign", requestMeta: {} }),
    ).rejects.toMatchObject({ code: SHARED_ERROR_CODES.notFound });
    expect(sessions.revokeOwned).toHaveBeenCalledWith("foreign", "owner", now);
  });

  it("does not acknowledge all-device logout when persistence fails", async () => {
    const { sessions, support, policy } = setup();
    sessions.revokeAllForUser.mockRejectedValue(new Error("unavailable"));
    const handler = new RevokeAllSessionsHandler(
      sessions as unknown as SessionRepository,
      support,
      policy,
    );
    await expect(handler.execute({ context, requestMeta: {} })).rejects.toThrow(
      "unavailable",
    );
  });
});
