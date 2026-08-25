import { PBAC_DECISION, SUBJECT_ROLES } from "@lcsp/contracts/pbac";
import {
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  AUTH_MEMBERSHIP_STATUSES,
} from "@lcsp/contracts/auth";
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";

import {
  Membership,
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
import { OAuthCallbackCommand } from "./oauth-callback.command.ts";
import { OAuthCallbackHandler } from "./oauth-callback.handler.ts";
import { OAuthLinkCallbackCommand } from "../oauth-link-callback/oauth-link-callback.command.ts";
import { OAuthLinkCallbackHandler } from "../oauth-link-callback/oauth-link-callback.handler.ts";

const EXPECTED_ISSUER = "https://issuer.example";
const EXPECTED_AUDIENCE = "expected-audience";
const CORRECT_NONCE = "correct-nonce";

// A stub OIDC provider exercises the shared nonce/issuer/audience/expiry
// validation branches through the production callback handler.
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

function buildRepositories(input: {
  oauthState: OAuthState | null;
  identity: OAuthIdentity | null;
  user: User | null;
  activeMemberships: Membership[];
}): AuthWorkspaceRepositories {
  const auditEvents: Record<string, unknown>[] = [];
  let consumed = false;

  const repositories: AuthWorkspaceRepositories = {
    organizations: {
      findById: () => Promise.resolve(null),
      save: () => Promise.resolve(),
    },
    users: {
      nextId: () => "unused",
      save: () => Promise.resolve(),
      findById: (id: string) =>
        Promise.resolve(input.user && input.user.id === id ? input.user : null),
      findByEmail: () => Promise.resolve(null),
      findByRecoveryEmail: () => Promise.resolve(null),
      findByPrimaryEmail: () => Promise.resolve(null),
    },
    memberships: {
      nextId: () => "unused",
      save: () => Promise.resolve(),
      findByUserAndOrganization: () => Promise.resolve(null),
      findActiveByUserId: () => Promise.resolve(input.activeMemberships),
    },
    invitations: {
      nextId: () => "unused",
      save: () => Promise.resolve(),
      findById: () => Promise.resolve(null),
      tryConsume: () => Promise.resolve(false),
    },
    sessions: {
      nextId: () => "session-1",
      save: () => Promise.resolve(),
      findByFingerprint: () => Promise.resolve(null),
      revokeAllForUser: () => Promise.resolve(),
    },
    policies: {
      findByIdAndVersion: () => Promise.resolve(null),
      findLatestByOrganizationAndRole: () => Promise.resolve(null),
    },
    auditEvents: {
      append: (event) => {
        auditEvents.push(event);
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
        if (consumed || !input.oauthState) {
          return Promise.resolve(null);
        }
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

  return repositories;
}

describe("OAuthCallbackHandler generic OIDC claim validation", () => {
  let support: AuthWorkspaceSupportService;
  let registry: OAuthProviderRegistry;
  let provider: StubOidcProvider;
  let oauthState: OAuthState;
  let user: User;
  let membership: Membership;
  let identity: OAuthIdentity;

  beforeEach(() => {
    support = new AuthWorkspaceSupportService();
    provider = new StubOidcProvider();
    registry = {
      resolve: (name: string) => (name === provider.name ? provider : null),
    } as unknown as OAuthProviderRegistry;

    oauthState = OAuthState.rehydrate({
      id: "state-1",
      state: "state-value",
      nonce: CORRECT_NONCE,
      provider: provider.name,
      redirectUri: "https://app.example/callback",
      expiresAt: Date.now() + 60_000,
    });

    user = User.rehydrate({
      id: "user-1",
      email: "oidc-user@acme.test",
      passwordHash: "unused",
      emailVerified: true,
    });

    membership = Membership.rehydrate({
      id: "membership-1",
      userId: user.id,
      organizationId: "org-1",
      status: AUTH_MEMBERSHIP_STATUSES.active,
      subjectAttributes: { role: SUBJECT_ROLES.manager },
      policyId: "policy-1",
      policyVersion: "v1",
    });

    identity = OAuthIdentity.rehydrate({
      id: "identity-1",
      userId: user.id,
      provider: provider.name,
      providerAccountId: "acct-1",
      createdAt: Date.now(),
    });
  });

  function execute() {
    const repositories = buildRepositories({
      oauthState,
      identity,
      user,
      activeMemberships: [membership],
    });
    const handler = new OAuthCallbackHandler(support, repositories, registry);
    return handler.execute(
      new OAuthCallbackCommand({
        code: "good-code",
        state: oauthState.state,
        provider: provider.name,
      }),
    );
  }

  it("succeeds when nonce, issuer, audience and expiry all match", async () => {
    const result = await execute();
    expect("ok" in result && result.ok).toBe(true);
  });

  it("rejects a nonce that does not match the one issued at start", async () => {
    provider.claims = { ...provider.claims, nonce: "wrong-nonce" };
    const result = await execute();
    expect("problem" in result && result.problem.code).toBe(
      AUTH_ERROR_CODES.oauthCallbackInvalid,
    );
  });

  it("rejects an issuer that does not match the provider's expected issuer", async () => {
    provider.claims = {
      ...provider.claims,
      issuer: "https://attacker.example",
    };
    const result = await execute();
    expect("problem" in result && result.problem.code).toBe(
      AUTH_ERROR_CODES.oauthCallbackInvalid,
    );
  });

  it("rejects an audience that does not match the provider's expected audience", async () => {
    provider.claims = { ...provider.claims, audience: "wrong-audience" };
    const result = await execute();
    expect("problem" in result && result.problem.code).toBe(
      AUTH_ERROR_CODES.oauthCallbackInvalid,
    );
  });

  it("rejects an expired ID token claim", async () => {
    provider.claims = { ...provider.claims, expiresAt: Date.now() - 1000 };
    const result = await execute();
    expect("problem" in result && result.problem.code).toBe(
      AUTH_ERROR_CODES.oauthCallbackInvalid,
    );
  });

  it("skips the nonce/issuer/audience/expiry checks when a provider reports them as null (e.g. GitHub)", async () => {
    provider.claims = {
      providerAccountId: "acct-1",
      nonce: null,
      issuer: null,
      audience: null,
      expiresAt: null,
    };
    provider.expectedIssuer = null;
    provider.expectedAudience = null;

    const result = await execute();
    expect("ok" in result && result.ok).toBe(true);
  });
});

describe("OAuthCallbackHandler — missing params, state, identity and membership", () => {
  let support: AuthWorkspaceSupportService;
  let registry: OAuthProviderRegistry;
  let provider: StubOidcProvider;
  let oauthState: OAuthState;
  let user: User;
  let membership: Membership;
  let identity: OAuthIdentity;
  let recordAuditSpy: jest.SpiedFunction<typeof support.recordAudit>;

  beforeEach(() => {
    support = new AuthWorkspaceSupportService();
    recordAuditSpy = jest
      .spyOn(support, "recordAudit")
      .mockImplementation(async () => {});

    provider = new StubOidcProvider();
    registry = {
      resolve: (name: string) => (name === provider.name ? provider : null),
    } as unknown as OAuthProviderRegistry;

    oauthState = OAuthState.rehydrate({
      id: "state-1",
      state: "state-value",
      nonce: CORRECT_NONCE,
      provider: provider.name,
      redirectUri: "https://app.example/callback",
      expiresAt: Date.now() + 60_000,
    });

    user = User.rehydrate({
      id: "user-1",
      email: "oidc-user@acme.test",
      passwordHash: "unused",
      emailVerified: true,
    });

    membership = Membership.rehydrate({
      id: "membership-1",
      userId: user.id,
      organizationId: "org-1",
      status: AUTH_MEMBERSHIP_STATUSES.active,
      subjectAttributes: { role: SUBJECT_ROLES.manager },
      policyId: "policy-1",
      policyVersion: "v1",
    });

    identity = OAuthIdentity.rehydrate({
      id: "identity-1",
      userId: user.id,
      provider: provider.name,
      providerAccountId: "acct-1",
      createdAt: Date.now(),
    });
  });

  function execute(
    commandArgs: Partial<
      ConstructorParameters<typeof OAuthCallbackCommand>[0]
    > = {},
  ) {
    const repositories = buildRepositories({
      oauthState,
      identity,
      user,
      activeMemberships: [membership],
    });
    const handler = new OAuthCallbackHandler(support, repositories, registry);
    return handler.execute(
      new OAuthCallbackCommand({
        code: "good-code",
        state: oauthState ? oauthState.state : "some-state",
        provider: provider.name,
        ...commandArgs,
      }),
    );
  }

  it("U01 - missing code returns VALIDATION_FAILED", async () => {
    const result = await execute({ code: "" });
    expect("problem" in result && result.problem.code).toBe(
      AUTH_ERROR_CODES.validationFailed,
    );
  });

  it("U02 - missing state returns VALIDATION_FAILED", async () => {
    const result = await execute({ state: "" });
    expect("problem" in result && result.problem.code).toBe(
      AUTH_ERROR_CODES.validationFailed,
    );
  });

  it("U03 - missing provider returns VALIDATION_FAILED", async () => {
    const result = await execute({ provider: "" });
    expect("problem" in result && result.problem.code).toBe(
      AUTH_ERROR_CODES.validationFailed,
    );
  });

  it("U04 - unknown state returns OAUTH_STATE_INVALID and records audit failure", async () => {
    oauthState = null as unknown as OAuthState;
    const result = await execute();
    expect("problem" in result && result.problem.code).toBe(
      AUTH_ERROR_CODES.oauthStateInvalid,
    );
    expect(recordAuditSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        decision: PBAC_DECISION.deny,
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLoginFailed,
      }),
    );
  });

  it("U05 - expired state returns OAUTH_STATE_INVALID and records audit failure", async () => {
    oauthState = OAuthState.rehydrate({
      ...oauthState,
      expiresAt: Date.now() - 1000,
    });
    const result = await execute();
    expect("problem" in result && result.problem.code).toBe(
      AUTH_ERROR_CODES.oauthStateInvalid,
    );
    expect(recordAuditSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        decision: PBAC_DECISION.deny,
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLoginFailed,
      }),
    );
  });

  it("U06 - replayed state returns OAUTH_STATE_INVALID", async () => {
    const repositories = buildRepositories({
      oauthState,
      identity,
      user,
      activeMemberships: [membership],
    });
    const handler = new OAuthCallbackHandler(support, repositories, registry);

    // First call consumes state successfully
    await handler.execute(
      new OAuthCallbackCommand({
        code: "good",
        state: oauthState.state,
        provider: provider.name,
      }),
    );

    // Second call fails
    const result = await handler.execute(
      new OAuthCallbackCommand({
        code: "good",
        state: oauthState.state,
        provider: provider.name,
      }),
    );
    expect("problem" in result && result.problem.code).toBe(
      AUTH_ERROR_CODES.oauthStateInvalid,
    );
  });

  it("U07 - handleCallback failure maps to OAUTH_CALLBACK_INVALID without leaking provider detail", async () => {
    jest
      .spyOn(provider, "handleCallback")
      .mockRejectedValue(new Error("Network Error at Provider API"));
    const result = await execute();
    expect("problem" in result && result.problem.code).toBe(
      AUTH_ERROR_CODES.oauthCallbackInvalid,
    );

    expect(recordAuditSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        decision: PBAC_DECISION.deny,
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLoginFailed,
      }),
    );
    const auditPayload = recordAuditSpy.mock.calls[0][1];
    expect(JSON.stringify(auditPayload)).not.toContain(
      "Network Error at Provider API",
    );
  });

  it("U08 - unknown provider identity returns ACCOUNT_NOT_FOUND", async () => {
    identity = null as unknown as OAuthIdentity;
    const result = await execute();
    expect("problem" in result && result.problem.code).toBe(
      AUTH_ERROR_CODES.accountNotFound,
    );
    expect(recordAuditSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        decision: PBAC_DECISION.deny,
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLoginFailed,
      }),
    );
  });

  it("rejects a link-flow state on the public login callback", async () => {
    oauthState = OAuthState.rehydrate({
      ...oauthState,
      userId: user.id,
      sessionId: "session-1",
    });

    const result = await execute();

    expect("problem" in result && result.problem.code).toBe(
      AUTH_ERROR_CODES.oauthStateInvalid,
    );
  });

  it("does not link a verified provider email during login callback", async () => {
    identity = null as unknown as OAuthIdentity;
    provider.claims = {
      ...provider.claims,
      email: String(user.email),
      emailVerified: true,
    };
    const repositories = buildRepositories({
      oauthState,
      identity,
      user,
      activeMemberships: [membership],
    });
    const linkedIdentity = OAuthIdentity.rehydrate({
      id: "linked-identity-1",
      userId: user.id,
      provider: provider.name,
      providerAccountId: provider.claims.providerAccountId,
      createdAt: Date.now(),
    });
    repositories.users.findByEmail = () => Promise.resolve(user);
    const linkToUser = jest
      .spyOn(repositories.oauthIdentities, "linkToUser")
      .mockResolvedValue(linkedIdentity);
    const handler = new OAuthCallbackHandler(support, repositories, registry);

    const result = await handler.execute(
      new OAuthCallbackCommand({
        code: "good-code",
        state: oauthState.state,
        provider: provider.name,
      }),
    );

    expect("problem" in result && result.problem.code).toBe(
      AUTH_ERROR_CODES.accountNotFound,
    );
    expect(linkToUser).not.toHaveBeenCalled();
  });

  it("U09 - unverified email returns ACCOUNT_NOT_FOUND", async () => {
    user = User.rehydrate({
      id: "user-1",
      email: "oidc-user@acme.test",
      passwordHash: "unused",
      emailVerified: false,
    });
    const result = await execute();
    expect("problem" in result && result.problem.code).toBe(
      AUTH_ERROR_CODES.accountNotFound,
    );
    expect(recordAuditSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        decision: PBAC_DECISION.deny,
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLoginFailed,
      }),
    );
  });

  it("U10 - no active membership returns MEMBERSHIP_MISSING", async () => {
    const repositories = buildRepositories({
      oauthState,
      identity,
      user,
      activeMemberships: [], // Empty memberships
    });
    const handler = new OAuthCallbackHandler(support, repositories, registry);
    const result = await handler.execute(
      new OAuthCallbackCommand({
        code: "good-code",
        state: oauthState.state,
        provider: provider.name,
      }),
    );

    expect("problem" in result && result.problem.code).toBe(
      AUTH_ERROR_CODES.membershipMissing,
    );
    expect(recordAuditSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        decision: PBAC_DECISION.deny,
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLoginFailed,
      }),
    );
  });

  it("U11 - success audit payload does not contain provider access token", async () => {
    Object.assign(provider.claims, { access_token: "LEAKED_TOKEN_MARKER" });
    await execute();
    expect(recordAuditSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        decision: PBAC_DECISION.allow,
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLoginSucceeded,
      }),
    );
    const auditPayload = recordAuditSpy.mock.calls[0][1];
    expect(JSON.stringify(auditPayload)).not.toContain("LEAKED_TOKEN_MARKER");
  });
});

describe("OAuthLinkCallbackHandler", () => {
  let support: AuthWorkspaceSupportService;
  let registry: OAuthProviderRegistry;
  let provider: StubOidcProvider;
  let oauthState: OAuthState;
  let user: User;
  let membership: Membership;
  let identity: OAuthIdentity | null;
  let recordAuditSpy: jest.SpiedFunction<typeof support.recordAudit>;

  beforeEach(() => {
    support = new AuthWorkspaceSupportService();
    recordAuditSpy = jest
      .spyOn(support, "recordAudit")
      .mockImplementation(async () => {});

    provider = new StubOidcProvider();
    registry = {
      resolve: (name: string) => (name === provider.name ? provider : null),
    } as unknown as OAuthProviderRegistry;

    user = User.rehydrate({
      id: "user-1",
      email: "oidc-user@acme.test",
      passwordHash: "unused",
      emailVerified: true,
    });

    membership = Membership.rehydrate({
      id: "membership-1",
      userId: user.id,
      organizationId: "org-1",
      status: AUTH_MEMBERSHIP_STATUSES.active,
      subjectAttributes: { role: SUBJECT_ROLES.manager },
      policyId: "policy-1",
      policyVersion: "v1",
    });

    oauthState = OAuthState.rehydrate({
      id: "state-1",
      state: "state-value",
      nonce: CORRECT_NONCE,
      provider: provider.name,
      redirectUri: "https://app.example/api/auth/oauth/link/callback/stub-oidc",
      expiresAt: Date.now() + 60_000,
      userId: user.id,
      sessionId: "session-1",
    });

    identity = null;
  });

  function buildLinkHandler() {
    const repositories = buildRepositories({
      oauthState,
      identity,
      user,
      activeMemberships: [membership],
    });
    return {
      repositories,
      handler: new OAuthLinkCallbackHandler(support, repositories, registry),
    };
  }

  function execute() {
    const { handler } = buildLinkHandler();
    return handler.execute(
      new OAuthLinkCallbackCommand(
        {
          code: "good-code",
          state: oauthState.state,
          provider: provider.name,
        },
        user.id,
        "session-1",
        membership.organizationId,
      ),
    );
  }

  it("links a verified provider account for the authenticated user", async () => {
    const { handler, repositories } = buildLinkHandler();
    const linkToUser = jest.spyOn(repositories.oauthIdentities, "linkToUser");

    const result = await handler.execute(
      new OAuthLinkCallbackCommand(
        {
          code: "good-code",
          state: oauthState.state,
          provider: provider.name,
        },
        user.id,
        "session-1",
        membership.organizationId,
      ),
    );

    expect("ok" in result && result.ok).toBe(true);
    expect(linkToUser).toHaveBeenCalledWith(provider.name, "acct-1", user.id);
    expect(recordAuditSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        decision: PBAC_DECISION.allow,
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLinkSucceeded,
        actor_id: user.id,
      }),
    );
  });

  it("rejects a link state bound to another session", async () => {
    const result = await new OAuthLinkCallbackHandler(
      support,
      buildRepositories({
        oauthState,
        identity,
        user,
        activeMemberships: [membership],
      }),
      registry,
    ).execute(
      new OAuthLinkCallbackCommand(
        {
          code: "good-code",
          state: oauthState.state,
          provider: provider.name,
        },
        user.id,
        "different-session",
        membership.organizationId,
      ),
    );

    expect("problem" in result && result.problem.code).toBe(
      AUTH_ERROR_CODES.oauthStateInvalid,
    );
    expect(recordAuditSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        decision: PBAC_DECISION.deny,
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthLinkFailed,
      }),
    );
  });

  it("rejects a provider account already linked to another user", async () => {
    identity = OAuthIdentity.rehydrate({
      id: "identity-1",
      userId: "other-user",
      provider: provider.name,
      providerAccountId: "acct-1",
      createdAt: Date.now(),
    });

    const result = await execute();

    expect("problem" in result && result.problem.code).toBe(
      AUTH_ERROR_CODES.oauthCallbackInvalid,
    );
  });
});
