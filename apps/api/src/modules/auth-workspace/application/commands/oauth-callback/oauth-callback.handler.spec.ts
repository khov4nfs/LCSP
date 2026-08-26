import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";
import { describe, expect, it, jest } from "@jest/globals";

import {
  OAuthIdentity,
  OAuthState,
  User,
} from "../../../domain/models/auth-workspace.models.ts";
import type {
  OAuthCallbackClaims,
  OAuthProvider,
} from "../../../infrastructure/oauth/oauth-provider.interface.ts";
import type { OAuthProviderRegistry } from "../../../infrastructure/oauth/oauth-provider.registry.ts";
import type { AuthWorkspaceRepositories } from "../../ports/persistence/auth-workspace-repositories.ts";
import { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
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

function buildRepositories(input: {
  oauthState: OAuthState | null;
  identity: OAuthIdentity | null;
  user: User | null;
}): AuthWorkspaceRepositories & { auditRecords: Record<string, unknown>[] } {
  const auditRecords: Record<string, unknown>[] = [];
  let consumed = false;

  const repositories: AuthWorkspaceRepositories = {
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
      findByFingerprint: () => Promise.resolve(null),
      revokeAllForUser: () => Promise.resolve(),
    },
    auditEvents: {
      append: (event) => {
        auditRecords.push(event);
        return Promise.resolve();
      },
    },
    authorizationDecisions: {
      append: () => Promise.resolve(),
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
      linkToUser: (provider, providerAccountId, userId) =>
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
  const support = new AuthWorkspaceSupportService({
    write: (event: Record<string, unknown>) => {
      repositories.auditRecords.push(event);
      return Promise.resolve();
    },
  } as never);
  const handler = new OAuthCallbackHandler(
    support,
    repositories,
    buildProviderRegistry(provider),
  );

  return { handler, provider, repositories };
}

describe("OAuthCallbackHandler", () => {
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

    const result = await handler.execute(
      new OAuthCallbackCommand(
        { code: "good-code", state: "state-value", provider: "stub-oidc" },
        { correlationId: "corr-2" },
      ),
    );

    expect("problem" in result && result.problem.code).toBe(
      AUTH_ERROR_CODES.oauthCallbackInvalid,
    );
    expect(repositories.auditRecords[0]).toMatchObject({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLoginFailed,
      decision: AUDIT_DECISIONS.deny,
      reason_code: AUTH_ERROR_CODES.oauthCallbackInvalid,
      correlationId: "corr-2",
    });
  });

  it("rejects missing callback parameters", async () => {
    const { handler } = buildLoginHarness();

    const result = await handler.execute(
      new OAuthCallbackCommand(
        { code: "", state: "state-value", provider: "stub-oidc" },
        { correlationId: "corr-3" },
      ),
    );

    expect("problem" in result && result.problem.code).toBe(
      AUTH_ERROR_CODES.validationFailed,
    );
  });

  it("rejects unknown, expired, replayed, and link-flow states", async () => {
    for (const oauthState of [
      null,
      makeState({ expiresAt: Date.now() - 1_000 }),
      makeState({ userId: "user-1", sessionId: "session-1" }),
    ]) {
      const { handler } = buildLoginHarness({ oauthState });

      const result = await handler.execute(
        new OAuthCallbackCommand(
          { code: "good-code", state: "state-value", provider: "stub-oidc" },
          { correlationId: "corr-state" },
        ),
      );

      expect("problem" in result && result.problem.code).toBe(
        AUTH_ERROR_CODES.oauthStateInvalid,
      );
    }

    const replayHarness = buildLoginHarness();
    await replayHarness.handler.execute(
      new OAuthCallbackCommand({
        code: "good-code",
        state: "state-value",
        provider: "stub-oidc",
      }),
    );
    const replay = await replayHarness.handler.execute(
      new OAuthCallbackCommand({
        code: "good-code",
        state: "state-value",
        provider: "stub-oidc",
      }),
    );
    expect("problem" in replay && replay.problem.code).toBe(
      AUTH_ERROR_CODES.oauthStateInvalid,
    );
  });

  it("rejects missing identity or unverified user email", async () => {
    const missingIdentity = await buildLoginHarness({
      identity: null,
    }).handler.execute(
      new OAuthCallbackCommand({
        code: "good-code",
        state: "state-value",
        provider: "stub-oidc",
      }),
    );
    expect("problem" in missingIdentity && missingIdentity.problem.code).toBe(
      AUTH_ERROR_CODES.accountNotFound,
    );

    const unverifiedUser = await buildLoginHarness({
      user: makeUser({ emailVerified: false }),
    }).handler.execute(
      new OAuthCallbackCommand({
        code: "good-code",
        state: "state-value",
        provider: "stub-oidc",
      }),
    );
    expect("problem" in unverifiedUser && unverifiedUser.problem.code).toBe(
      AUTH_ERROR_CODES.accountNotFound,
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
    const support = new AuthWorkspaceSupportService({
      write: (event: Record<string, unknown>) => {
        repositories.auditRecords.push(event);
        return Promise.resolve();
      },
    } as never);
    const handler = new OAuthLinkCallbackHandler(
      support,
      repositories,
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

    const result = await handler.execute(
      new OAuthLinkCallbackCommand(
        { code: "good-code", state: "state-value", provider: "stub-oidc" },
        "user-1",
        "different-session",
        { correlationId: "corr-link-deny" },
      ),
    );

    expect("problem" in result && result.problem.code).toBe(
      AUTH_ERROR_CODES.oauthStateInvalid,
    );
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

    const result = await handler.execute(
      new OAuthLinkCallbackCommand(
        { code: "good-code", state: "state-value", provider: "stub-oidc" },
        "user-1",
        "session-1",
        { correlationId: "corr-link-conflict" },
      ),
    );

    expect("problem" in result && result.problem.code).toBe(
      AUTH_ERROR_CODES.oauthCallbackInvalid,
    );
  });
});
