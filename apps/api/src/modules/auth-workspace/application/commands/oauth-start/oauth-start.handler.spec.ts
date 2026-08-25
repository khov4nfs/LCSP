import { AUTH_LEGACY_AUDIT_EVENT_TYPES } from "@lcsp/contracts/auth";
import { PBAC_DECISION } from "@lcsp/contracts/pbac";
/* eslint-disable @typescript-eslint/unbound-method */
import { jest } from "@jest/globals";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";

import type { ConfigService } from "@nestjs/config";
import type { OAuthProvider } from "../../../infrastructure/oauth/oauth-provider.interface.ts";
import type { OAuthProviderRegistry } from "../../../infrastructure/oauth/oauth-provider.registry.ts";
import type { AuthProblemResult } from "../../contracts/auth-workspace/common.contract.ts";
import type { AuthWorkspaceRepositories } from "../../ports/persistence/auth-workspace-repositories.ts";
import type { AuthWorkspaceSupportService } from "../../services/auth-workspace/auth-workspace-support.service.ts";
import { OAuthStartCommand } from "./oauth-start.command.ts";
import { OAuthStartHandler } from "./oauth-start.handler.ts";

describe("OAuthStartHandler", () => {
  let handler: OAuthStartHandler;
  let mockSupportService: jest.Mocked<AuthWorkspaceSupportService>;
  let mockRepositories: jest.Mocked<AuthWorkspaceRepositories>;
  let mockProviderRegistry: jest.Mocked<OAuthProviderRegistry>;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockProvider: jest.Mocked<OAuthProvider>;

  beforeEach(() => {
    mockSupportService = {
      createCorrelationId: jest.fn().mockReturnValue("mock-correlation-id"),
      now: jest.fn().mockReturnValue(1000000),
      recordAudit: jest.fn().mockImplementation(async () => {}),
    } as unknown as jest.Mocked<AuthWorkspaceSupportService>;

    mockRepositories = {
      oauthStates: {
        nextId: jest
          .fn<AuthWorkspaceRepositories["oauthStates"]["nextId"]>()
          .mockReturnValue("mock-state-id"),
        save: jest
          .fn<AuthWorkspaceRepositories["oauthStates"]["save"]>()
          .mockImplementation(async () => {}),
      },
      auditEvents: {
        append: jest.fn<AuthWorkspaceRepositories["auditEvents"]["append"]>(),
      },
    } as unknown as jest.Mocked<AuthWorkspaceRepositories>;

    mockProvider = {
      buildAuthorizationUrl: jest
        .fn<OAuthProvider["buildAuthorizationUrl"]>()
        .mockReturnValue("https://mock-provider.com/auth?state=abc"),
    } as unknown as jest.Mocked<OAuthProvider>;

    mockProviderRegistry = {
      resolve: jest.fn().mockReturnValue(mockProvider),
    } as unknown as jest.Mocked<OAuthProviderRegistry>;

    mockConfigService = {
      get: jest
        .fn<ConfigService["get"]>()
        .mockImplementation((key: string, defaultValue?: any) => {
          if (key === "oauth.allowedRedirectOrigins") {
            return ["http://localhost:3000"];
          }
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return defaultValue;
        }),
    } as unknown as jest.Mocked<ConfigService>;

    handler = new OAuthStartHandler(
      mockSupportService,
      mockRepositories,
      mockProviderRegistry,
      mockConfigService,
    );
  });

  it("U01 - missing provider returns VALIDATION_FAILED", async () => {
    const command = new OAuthStartCommand(
      { provider: "", redirect_uri: "http://localhost:3000/callback" },
      {},
    );
    const result = (await handler.execute(command)) as AuthProblemResult;

    expect(result.ok).toBe(false);
    expect(result.problem.code).toBe(AUTH_ERROR_CODES.validationFailed);
  });

  it("U02 - missing redirect_uri returns VALIDATION_FAILED", async () => {
    const command = new OAuthStartCommand(
      { provider: "google", redirect_uri: "" },
      {},
    );
    const result = (await handler.execute(command)) as AuthProblemResult;

    expect(result.ok).toBe(false);
    expect(result.problem.code).toBe(AUTH_ERROR_CODES.validationFailed);
  });

  it("U03 - unsupported provider returns UNSUPPORTED_PROVIDER and records audit failure", async () => {
    mockProviderRegistry.resolve.mockReturnValue(null);

    const command = new OAuthStartCommand(
      {
        provider: "invalid-provider",
        redirect_uri: "http://localhost:3000/callback",
      },
      { correlationId: "corr-1" },
    );
    const result = (await handler.execute(command)) as AuthProblemResult;

    expect(result.ok).toBe(false);
    expect(result.problem.code).toBe(AUTH_ERROR_CODES.unsupportedProvider);

    expect(mockSupportService.recordAudit).toHaveBeenCalledWith(
      mockRepositories,
      expect.objectContaining({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthStartFailed,
        decision: PBAC_DECISION.deny,
        reason_code: AUTH_ERROR_CODES.unsupportedProvider,
        correlationId: "corr-1",
      }),
    );
  });

  it("U04 - redirect_uri not in allowlist returns INVALID_REDIRECT_URI and records audit failure", async () => {
    const command = new OAuthStartCommand(
      { provider: "google", redirect_uri: "http://hacker.com/callback" },
      { correlationId: "corr-1" },
    );
    const result = (await handler.execute(command)) as AuthProblemResult;

    expect(result.ok).toBe(false);
    expect(result.problem.code).toBe(AUTH_ERROR_CODES.invalidRedirectUri);

    expect(mockSupportService.recordAudit).toHaveBeenCalledWith(
      mockRepositories,
      expect.objectContaining({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthStartFailed,
        decision: PBAC_DECISION.deny,
        reason_code: AUTH_ERROR_CODES.invalidRedirectUri,
      }),
    );
  });

  it("U05 - happy path saves state, nonce and returns authorization_url", async () => {
    const command = new OAuthStartCommand(
      { provider: "google", redirect_uri: "http://localhost:3000/callback" },
      { correlationId: "corr-1" },
    );
    const result = await handler.execute(command);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.authorization_url).toBe(
        "https://mock-provider.com/auth?state=abc",
      );
      expect(result.correlationId).toBe("corr-1");
    }

    expect(mockRepositories.oauthStates.save).toHaveBeenCalledTimes(1);
    const savedState = mockRepositories.oauthStates.save.mock.calls[0][0];
    expect(savedState.provider).toBe("google");
    expect(savedState.redirectUri).toBe("http://localhost:3000/callback");
    expect(savedState.state).toBeDefined();
    expect(savedState.nonce).toBeDefined();

    expect(mockSupportService.recordAudit).toHaveBeenCalledWith(
      mockRepositories,
      expect.objectContaining({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthStartSucceeded,
        decision: PBAC_DECISION.allow,
        provider: "google",
        correlationId: "corr-1",
      }),
    );
  });

  it("U06 - audit payload does not contain state or nonce", async () => {
    const command = new OAuthStartCommand(
      { provider: "google", redirect_uri: "http://localhost:3000/callback" },
      {},
    );
    await handler.execute(command);

    const savedState = mockRepositories.oauthStates.save.mock.calls[0][0];
    const auditPayload = mockSupportService.recordAudit.mock.calls[0][1];

    const auditStr = JSON.stringify(auditPayload);
    expect(auditStr).not.toContain(savedState.state);
    expect(auditStr).not.toContain(savedState.nonce);
  });
});
