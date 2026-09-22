import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  USER_ACCESS_STATUSES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  oauthCallbackSchema,
} from "@lcsp/contracts/auth";
import { describe, expect, it, jest } from "@jest/globals";
import { HttpException } from "@nestjs/common";
import { ZodValidationPipe } from "../../../../../common/pipes/zod-validation.pipe.ts";

import {
  OAuthIdentity,
  OAuthState,
  User,
} from "../../../domain/models/auth.models.ts";
import type {
  OAuthCallbackClaims,
  OAuthProvider,
} from "../../../infrastructure/oauth/oauth-provider.interface.ts";
import type {
  AuditEventRepository,
  MfaEnrollmentRepository,
  OAuthIdentityRepository,
  OAuthStateRepository,
  SessionRepository,
  UserRepository,
} from "../../ports/persistence/index.ts";
import type { OAuthProviderRegistry } from "../../../infrastructure/oauth/oauth-provider.registry.ts";
import { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { OAuthLinkCallbackCommand } from "../oauth-link-callback/oauth-link-callback.command.ts";
import { OAuthLinkCallbackHandler } from "../oauth-link-callback/oauth-link-callback.handler.ts";
import { OAuthCallbackCommand } from "./oauth-callback.command.ts";
import { OAuthCallbackHandler } from "./oauth-callback.handler.ts";

const EXPECTED_ISSUER = "https://issuer.example";
const EXPECTED_AUDIENCE = "expected-audience";
const CORRECT_NONCE = "correct-nonce";

class StubOidcProvider implements OAuthProvider {
  readonly name = "stub-oidc";
  expectedIssuer: string | null = EXPECTED_ISSUER;
  expectedAudience: string | null = EXPECTED_AUDIENCE;
  claims: OAuthCallbackClaims = {
    providerAccountId: "acct-1",
    nonce: CORRECT_NONCE,
    issuer: EXPECTED_ISSUER,
    audience: EXPECTED_AUDIENCE,
    expiresAt: Date.now() + 60_000,
  };

  buildAuthorizationUrl(): string {
    return "https://issuer.example/authorize";
  }

  handleCallback(): Promise<OAuthCallbackClaims> {
    return Promise.resolve(this.claims);
  }
}

function makeUser(
  overrides: Partial<Parameters<typeof User.rehydrate>[0]> = {},
) {
  return User.rehydrate({
    id: "user-1",
    email: "oidc-user@acme.test",
    passwordHash: "unused",
    emailVerified: true,
    failedLoginCount: 0,
    ...overrides,
  });
}

function makeState(
  overrides: Partial<Parameters<typeof OAuthState.rehydrate>[0]> = {},
) {
  return OAuthState.rehydrate({
    id: "state-1",
    state: "state-value",
    nonce: CORRECT_NONCE,
    provider: "stub-oidc",
    redirectUri: "https://app.example/callback",
    expiresAt: Date.now() + 60_000,
    ...overrides,
  });
}

function makeIdentity(
  overrides: Partial<Parameters<typeof OAuthIdentity.rehydrate>[0]> = {},
) {
  return OAuthIdentity.rehydrate({
    id: "identity-1",
    userId: "user-1",
    provider: "stub-oidc",
    providerAccountId: "acct-1",
    createdAt: Date.now(),
    ...overrides,
  });
}

type MockRepositories = {
  users: UserRepository;
  sessions: SessionRepository;
  auditEvents: AuditEventRepository;
  mfaEnrollments: MfaEnrollmentRepository;
  oauthStates: OAuthStateRepository;
  oauthIdentities: OAuthIdentityRepository;
  auditRecords: Record<string, unknown>[];
};

function buildRepositories(input: {
  oauthState: OAuthState | null;
  identity: OAuthIdentity | null;
  user: User | null;
}): MockRepositories {
  const auditRecords: Record<string, unknown>[] = [];
  let consumed = false;

  const repositories = {
    users: {
      nextId: () => "unused",
      save: () => Promise.resolve(),
      findById: (id: string) =>
        Promise.resolve(input.user && input.user.id === id ? input.user : null),
      findByEmail: () => Promise.resolve(null),
      findByRecoveryEmail: () => Promise.resolve(null),
      findByPrimaryEmail: () => Promise.resolve(null),
    },
    sessions: {
      nextId: () => "session-1",
      save: () => Promise.resolve(),
      findById: () => Promise.resolve(null),
      findByFingerprint: () => Promise.resolve(null),
      revokeAllForUser: () => Promise.resolve(),
    },

    auditEvents: {
      append: (event: Record<string, unknown>): Promise<void> => {
        auditRecords.push(event);
        return Promise.resolve();
      },
    },
    mfaEnrollments: {
      findByUserId: () => Promise.resolve(null),
      save: () => Promise.resolve(),
      deleteByUserId: () => Promise.resolve(),
    },
    mfaRateLimits: {
      findByUserId: () => Promise.resolve(null),
      save: () => Promise.resolve(),
      resetByUserId: () => Promise.resolve(),
      recordFailedAttempt: () => {
        throw new Error("not used in this test");
      },
    },
    mfaOtpUsed: {
      isUsed: () => Promise.resolve(false),
      tryMarkUsed: () => Promise.resolve(true),
      deleteByUserId: () => Promise.resolve(),
      pruneOlderThan: () => Promise.resolve(),
    },
    mfaRecoveryCodes: {
      nextId: () => "unused",
      nextBatchId: () => "unused",
      hasActiveForUser: () => Promise.resolve(false),
      replaceForUser: () => Promise.resolve(),
      revokeActiveForUser: () => Promise.resolve(),
      tryConsume: () => Promise.resolve(false),
    },
    recoveryRequests: {
      nextId: () => "unused",
      save: () => Promise.resolve(),
      findByFingerprint: () => Promise.resolve(null),
    },
    oauthStates: {
      nextId: () => "unused",
      save: () => Promise.resolve(),
      consumeByState: () => {
        if (consumed || !input.oauthState) return Promise.resolve(null);
        consumed = true;
        return Promise.resolve(input.oauthState);
      },
    },
    oauthIdentities: {
      findByProviderAccount: () => Promise.resolve(input.identity),
      linkToUser: (
        provider: string,
        providerAccountId: string,
        userId: string,
      ): Promise<OAuthIdentity> =>
        Promise.resolve(
          OAuthIdentity.rehydrate({
            id: "linked-identity-1",
            provider,
            providerAccountId,
            userId,
            createdAt: Date.now(),
          }),
        ),
    },
  };

  return Object.assign(repositories, { auditRecords });
}

function buildProviderRegistry(
  provider: StubOidcProvider,
): OAuthProviderRegistry {
  return {
    resolve: (name: string) => (name === provider.name ? provider : null),
  } as unknown as OAuthProviderRegistry;
}

function buildLoginHarness(
  input: {
    oauthState?: OAuthState | null;
    identity?: OAuthIdentity | null;
    user?: User | null;
    provider?: StubOidcProvider;
  } = {},
) {
  const provider = input.provider ?? new StubOidcProvider();
  const repositories = buildRepositories({
    oauthState: input.oauthState === undefined ? makeState() : input.oauthState,
    identity: input.identity === undefined ? makeIdentity() : input.identity,
    user: input.user === undefined ? makeUser() : input.user,
  });
  const support = new AuthSupportService({
    write: (event: Record<string, unknown>) => {
      repositories.auditRecords.push(event);
      return Promise.resolve();
    },
  } as never);
  const handler = new OAuthCallbackHandler(
    support,
    repositories.oauthStates,
    repositories.oauthIdentities,
    repositories.users,
    repositories.sessions,
    repositories.mfaEnrollments,
    buildProviderRegistry(provider),
  );

  return { handler, provider, repositories };
}

describe("OAuthCallbackHandler", () => {
  it("denies a suspended account even with a valid OAuth identity and provider claims", async () => {
    const { handler, repositories } = buildLoginHarness({
      user: makeUser({ accessStatus: USER_ACCESS_STATUSES.suspended }),
    });
    const save = jest.spyOn(repositories.sessions, "save");
    let thrown: unknown;
    try {
      await handler.execute(
        new OAuthCallbackCommand(
          { code: "good-code", state: "state-value", provider: "stub-oidc" },
          { correlationId: "suspended-oauth" },
        ),
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getResponse()).toMatchObject({
      problem: { code: AUTH_ERROR_CODES.accountSuspended },
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("succeeds when nonce, issuer, audience, expiry, identity, and user are valid", async () => {
    const { handler, repositories } = buildLoginHarness();

    const result = await handler.execute(
      new OAuthCallbackCommand(
        { code: "good-code", state: "state-value", provider: "stub-oidc" },
        { correlationId: "corr-1" },
      ),
    );

    expect("ok" in result && result.ok).toBe(true);
    expect(repositories.auditRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLoginSucceeded,
          actor_id: "user-1",
          decision: AUDIT_DECISIONS.allow,
          correlationId: "corr-1",
        }),
      ]),
    );
    expect(JSON.stringify(repositories.auditRecords)).not.toMatch(
      /access_token|refresh_token/i,
    );
  });

  it("rejects invalid claims without leaking provider detail", async () => {
    const provider = new StubOidcProvider();
    provider.claims = {
      ...provider.claims,
      nonce: "wrong-nonce",
    };
    const { handler, repositories } = buildLoginHarness({ provider });

    let thrown: unknown;
    try {
      await handler.execute(
        new OAuthCallbackCommand(
          { code: "good-code", state: "state-value", provider: "stub-oidc" },
          { correlationId: "corr-2" },
        ),
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getResponse()).toMatchObject({
      problem: { code: AUTH_ERROR_CODES.oauthCallbackInvalid },
    });

    expect(repositories.auditRecords[0]).toMatchObject({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLoginFailed,
      decision: AUDIT_DECISIONS.deny,
      reason_code: AUTH_ERROR_CODES.oauthCallbackInvalid,
      correlationId: "corr-2",
    });
  });

  it("rejects missing callback parameters", () => {
    const pipe = new ZodValidationPipe(oauthCallbackSchema);
    expect(() =>
      pipe.transform({
        code: "",
        state: "state-value",
        provider: "stub-oidc",
      }),
    ).toThrow(HttpException);

    try {
      pipe.transform({
        code: "",
        state: "state-value",
        provider: "stub-oidc",
      });
    } catch (err) {
      expect((err as HttpException).getResponse()).toMatchObject({
        problem: { code: AUTH_ERROR_CODES.validationFailed },
      });
    }
  });

  it("rejects unknown, expired, replayed, and link-flow states", async () => {
    for (const oauthState of [
      null,
      makeState({ expiresAt: Date.now() - 1_000 }),
      makeState({ userId: "user-1", sessionId: "session-1" }),
    ]) {
      const { handler } = buildLoginHarness({ oauthState });

      let thrown: unknown;
      try {
        await handler.execute(
          new OAuthCallbackCommand(
            { code: "good-code", state: "state-value", provider: "stub-oidc" },
            { correlationId: "corr-state" },
          ),
        );
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(HttpException);
      expect((thrown as HttpException).getResponse()).toMatchObject({
        problem: { code: AUTH_ERROR_CODES.oauthStateInvalid },
      });
    }

    const replayHarness = buildLoginHarness();
    await replayHarness.handler.execute(
      new OAuthCallbackCommand({
        code: "good-code",
        state: "state-value",
        provider: "stub-oidc",
      }),
    );
    let replayThrown: unknown;
    try {
      await replayHarness.handler.execute(
        new OAuthCallbackCommand({
          code: "good-code",
          state: "state-value",
          provider: "stub-oidc",
        }),
      );
    } catch (err) {
      replayThrown = err;
    }
    expect(replayThrown).toBeInstanceOf(HttpException);
    expect((replayThrown as HttpException).getResponse()).toMatchObject({
      problem: { code: AUTH_ERROR_CODES.oauthStateInvalid },
    });
  });

  it("rejects missing identity or unverified user email", async () => {
    let missingIdentityThrown: unknown;
    try {
      await buildLoginHarness({
        identity: null,
      }).handler.execute(
        new OAuthCallbackCommand({
          code: "good-code",
          state: "state-value",
          provider: "stub-oidc",
        }),
      );
    } catch (err) {
      missingIdentityThrown = err;
    }
    expect(missingIdentityThrown).toBeInstanceOf(HttpException);
    expect(
      (missingIdentityThrown as HttpException).getResponse(),
    ).toMatchObject({
      problem: { code: AUTH_ERROR_CODES.accountNotFound },
    });

    let unverifiedUserThrown: unknown;
    try {
      await buildLoginHarness({
        user: makeUser({ emailVerified: false }),
      }).handler.execute(
        new OAuthCallbackCommand({
          code: "good-code",
          state: "state-value",
          provider: "stub-oidc",
        }),
      );
    } catch (err) {
      unverifiedUserThrown = err;
    }
    expect(unverifiedUserThrown).toBeInstanceOf(HttpException);
    expect((unverifiedUserThrown as HttpException).getResponse()).toMatchObject(
      {
        problem: { code: AUTH_ERROR_CODES.accountNotFound },
      },
    );
  });
});

describe("OAuthLinkCallbackHandler", () => {
  function buildLinkHarness(
    input: {
      oauthState?: OAuthState | null;
      identity?: OAuthIdentity | null;
      provider?: StubOidcProvider;
    } = {},
  ) {
    const provider = input.provider ?? new StubOidcProvider();
    const repositories = buildRepositories({
      oauthState:
        input.oauthState === undefined
          ? makeState({
              redirectUri:
                "https://app.example/api/auth/oauth/link/callback/stub-oidc",
              userId: "user-1",
              sessionId: "session-1",
            })
          : input.oauthState,
      identity: input.identity === undefined ? null : input.identity,
      user: makeUser(),
    });
    const support = new AuthSupportService({
      write: (event: Record<string, unknown>) => {
        repositories.auditRecords.push(event);
        return Promise.resolve();
      },
    } as never);
    const handler = new OAuthLinkCallbackHandler(
      support,
      repositories.oauthStates,
      repositories.oauthIdentities,
      buildProviderRegistry(provider),
    );
    return { handler, repositories };
  }

  it("links a verified provider account for the authenticated user", async () => {
    const { handler, repositories } = buildLinkHarness();
    const linkToUser = jest.spyOn(repositories.oauthIdentities, "linkToUser");

    const result = await handler.execute(
      new OAuthLinkCallbackCommand(
        { code: "good-code", state: "state-value", provider: "stub-oidc" },
        "user-1",
        "session-1",
        { correlationId: "corr-link" },
      ),
    );

    expect("ok" in result && result.ok).toBe(true);
    expect(linkToUser).toHaveBeenCalledWith("stub-oidc", "acct-1", "user-1");
    expect(repositories.auditRecords[0]).toMatchObject({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLinkSucceeded,
      actor_id: "user-1",
      decision: AUDIT_DECISIONS.allow,
      correlationId: "corr-link",
      linked: true,
    });
  });

  it("rejects a link state bound to another session", async () => {
    const { handler, repositories } = buildLinkHarness();

    let thrown: unknown;
    try {
      await handler.execute(
        new OAuthLinkCallbackCommand(
          { code: "good-code", state: "state-value", provider: "stub-oidc" },
          "user-1",
          "different-session",
          { correlationId: "corr-link-deny" },
        ),
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getResponse()).toMatchObject({
      problem: { code: AUTH_ERROR_CODES.oauthStateInvalid },
    });
    expect(repositories.auditRecords[0]).toMatchObject({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLinkFailed,
      decision: AUDIT_DECISIONS.deny,
      correlationId: "corr-link-deny",
    });
  });

  it("rejects a provider account already linked to another user", async () => {
    const { handler } = buildLinkHarness({
      identity: makeIdentity({ userId: "other-user" }),
    });

    let thrown: unknown;
    try {
      await handler.execute(
        new OAuthLinkCallbackCommand(
          { code: "good-code", state: "state-value", provider: "stub-oidc" },
          "user-1",
          "session-1",
          { correlationId: "corr-link-conflict" },
        ),
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getResponse()).toMatchObject({
      problem: { code: AUTH_ERROR_CODES.oauthCallbackInvalid },
    });
  });
});
