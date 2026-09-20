import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";
/* eslint-disable @typescript-eslint/unbound-method */
import { jest } from "@jest/globals";

import { HttpException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { OAuthProvider } from "../../../infrastructure/oauth/oauth-provider.interface.ts";
import type { OAuthProviderRegistry } from "../../../infrastructure/oauth/oauth-provider.registry.ts";
import type { OAuthStateRepository } from "../../ports/persistence/index.ts";
import type { AuthSupportService } from "../../services/auth/auth-support.service.ts";
import { OAuthStartCommand } from "./oauth-start.command.ts";
import { OAuthStartHandler } from "./oauth-start.handler.ts";

describe("OAuthStartHandler", () => {
  let handler: OAuthStartHandler;
  let mockSupportService: jest.Mocked<AuthSupportService>;
  let mockOAuthStates: jest.Mocked<OAuthStateRepository>;
  let mockProviderRegistry: jest.Mocked<OAuthProviderRegistry>;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockProvider: jest.Mocked<OAuthProvider>;

  beforeEach(() => {
    mockSupportService = {
      createCorrelationId: jest.fn().mockReturnValue("mock-correlation-id"),
      now: jest.fn().mockReturnValue(1000000),
      recordAudit: jest.fn().mockImplementation(async () => {}),
    } as unknown as jest.Mocked<AuthSupportService>;

    mockOAuthStates = {
      nextId: jest
        .fn<OAuthStateRepository["nextId"]>()
        .mockReturnValue("mock-state-id"),
      save: jest
        .fn<OAuthStateRepository["save"]>()
        .mockImplementation(async () => {}),
      consumeByState: jest.fn<OAuthStateRepository["consumeByState"]>(),
    };

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
      mockOAuthStates,
      mockProviderRegistry,
      mockConfigService,
    );
  });

  it("U01 - missing provider returns VALIDATION_FAILED", async () => {
    const command = new OAuthStartCommand(
      { provider: "", redirect_uri: "http://localhost:3000/callback" },
      {},
    );
    let thrown: unknown;
    try {
      await handler.execute(command);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getResponse()).toMatchObject({
      problem: { code: AUTH_ERROR_CODES.validationFailed },
    });
  });

  it("U02 - missing redirect_uri returns VALIDATION_FAILED", async () => {
    const command = new OAuthStartCommand(
      { provider: "google", redirect_uri: "" },
      {},
    );
    let thrown: unknown;
    try {
      await handler.execute(command);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getResponse()).toMatchObject({
      problem: { code: AUTH_ERROR_CODES.validationFailed },
    });
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
    let thrown: unknown;
    try {
      await handler.execute(command);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getResponse()).toMatchObject({
      problem: { code: AUTH_ERROR_CODES.unsupportedProvider },
    });
    expect(mockSupportService.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthStartFailed,
        decision: AUDIT_DECISIONS.deny,
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
    let thrown: unknown;
    try {
      await handler.execute(command);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getResponse()).toMatchObject({
      problem: { code: AUTH_ERROR_CODES.invalidRedirectUri },
    });
    expect(mockSupportService.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthStartFailed,
        decision: AUDIT_DECISIONS.deny,
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

    expect(mockOAuthStates.save).toHaveBeenCalledTimes(1);
    const savedState = mockOAuthStates.save.mock.calls[0][0];
    expect(savedState.provider).toBe("google");
    expect(savedState.redirectUri).toBe("http://localhost:3000/callback");
    expect(savedState.state).toBeDefined();
    expect(savedState.nonce).toBeDefined();

    expect(mockSupportService.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.oauthStartSucceeded,
        decision: AUDIT_DECISIONS.allow,
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

    const savedState = mockOAuthStates.save.mock.calls[0][0];
    const auditPayload = mockSupportService.recordAudit.mock.calls[0][0];
    const auditStr = JSON.stringify(auditPayload);
    expect(auditStr).not.toContain(savedState.state);
    expect(auditStr).not.toContain(savedState.nonce);
  });
});
