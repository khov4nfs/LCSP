import { jest } from "@jest/globals";
import type { Request, Response } from "express";
import {
  DevUnsafeHttpTraceMiddleware,
  isSensitiveHttpTraceRoute,
} from "./dev-unsafe-http-trace.middleware.js";
import {
  emitDevUnsafeTrace,
  unsafeDevTraceEnabled,
  unsafeDevUnfilteredEnabled,
} from "./dev-unsafe-trace.js";

interface TraceRecord {
  event?: string;
  api_key?: string;
  authorization?: string;
  body_size?: number;
  body_itemCount?: number;
  node_count?: number;
  method?: string;
  statusCode?: number;
  body?: string;
}

describe("dev-unsafe-trace", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("identifies when unsafe dev trace is enabled", () => {
    process.env.LCSP_DEV_UNSAFE_TRACE = "true";
    process.env.NODE_ENV = "development";
    expect(unsafeDevTraceEnabled()).toBe(true);

    process.env.LCSP_DEV_UNSAFE_TRACE = "false";
    expect(unsafeDevTraceEnabled()).toBe(false);
  });

  it("identifies when unfiltered logging is enabled", () => {
    process.env.LCSP_DEV_UNSAFE_UNFILTERED = "true";
    process.env.NODE_ENV = "development";
    expect(unsafeDevUnfilteredEnabled()).toBe(true);

    process.env.LCSP_DEV_UNSAFE_UNFILTERED = "false";
    expect(unsafeDevUnfilteredEnabled()).toBe(false);
  });

  it("preserves credentials and summarizes payloads by default", () => {
    process.env.LCSP_DEV_UNSAFE_TRACE = "true";
    process.env.LCSP_DEV_UNSAFE_UNFILTERED = "false";
    process.env.NODE_ENV = "development";

    const writeSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    emitDevUnsafeTrace("TEST_EVENT_RAW", {
      api_key: "secret-key-123",
      authorization: "Bearer some-token",
      body: "a".repeat(100),
      nodes: [1, 2, 3],
      method: "POST",
      statusCode: 200,
    });

    expect(writeSpy).toHaveBeenCalled();
    const logCall = writeSpy.mock.calls[0][0] as string;
    const record = JSON.parse(logCall.trim()) as TraceRecord;

    expect(record.event).toBe("TEST_EVENT");
    expect(record.api_key).toBe("secret-key-123");
    expect(record.authorization).toBe("Bearer some-token");
    expect(record.body_size).toBe(100);
    expect(record.body_itemCount).toBeUndefined();
    expect(record.node_count).toBe(3);
    expect(record.method).toBe("POST");
    expect(record.statusCode).toBe(200);

    writeSpy.mockRestore();
  });

  it("does not redact or summarize when unfiltered is enabled", () => {
    process.env.LCSP_DEV_UNSAFE_TRACE = "true";
    process.env.LCSP_DEV_UNSAFE_UNFILTERED = "true";
    process.env.NODE_ENV = "development";

    const writeSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    emitDevUnsafeTrace("TEST_EVENT_RAW", {
      api_key: "secret-key-123",
      body: "hello",
    });

    expect(writeSpy).toHaveBeenCalled();
    const logCall = writeSpy.mock.calls[0][0] as string;
    const record = JSON.parse(logCall.trim()) as TraceRecord;

    expect(record.event).toBe("TEST_EVENT_RAW");
    expect(record.api_key).toBe("secret-key-123");
    expect(record.body).toBe("hello");

    writeSpy.mockRestore();
  });

  // Sensitive authentication, credential, and billing routes must bypass raw tracing.
  it.each([
    "/provider-credentials",
    "/provider-credentials/cred-123",
    "/auth/sign-in",
    "/auth/sign-up",
    "/auth/re-auth/password",
    "/auth/mfa/enroll",
    "/auth/mfa/verify-otp",
    "/auth/mfa/recovery-codes",
    "/auth/mfa/recovery-codes/access",
    "/auth/mfa/recovery-code/verify",
    "/auth/recovery/request",
    "/auth/recovery/confirm",
    "/auth/oauth/start",
    "/auth/oauth/callback",
    "/auth/oauth/link/start",
    "/auth/oauth/link/callback",
    "/auth/sessions",
    "/auth/sessions/sess-123",
    "/auth/revoke-session",
    "/auth/sensitive-route/check",
    "/billing/sepay/webhook",
    "/billing/sepay/transaction",
  ])("excludes %s even when unfiltered HTTP tracing is enabled", (path) => {
    process.env.LCSP_DEV_UNSAFE_TRACE = "true";
    process.env.LCSP_DEV_UNSAFE_UNFILTERED = "true";
    const write = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const next = jest.fn();
    try {
      const request = {
        path,
        originalUrl: path,
        method: "POST",
        body: { credential: "synthetic-sensitive-input" },
      } as Request;
      const response = { json: jest.fn(), send: jest.fn(), on: jest.fn() };
      new DevUnsafeHttpTraceMiddleware().use(
        request,
        response as unknown as Response,
        next,
      );
      expect(next).toHaveBeenCalledTimes(1);
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });

  it("identifies sensitive vs non-sensitive route paths via isSensitiveHttpTraceRoute", () => {
    expect(isSensitiveHttpTraceRoute("/auth/sign-in")).toBe(true);
    expect(
      isSensitiveHttpTraceRoute("/auth/oauth/link/callback?code=xyz"),
    ).toBe(true);
    expect(isSensitiveHttpTraceRoute("/provider-credentials/github")).toBe(
      true,
    );
    expect(isSensitiveHttpTraceRoute("/billing/sepay/webhook")).toBe(true);

    expect(isSensitiveHttpTraceRoute("/assessments")).toBe(false);
    expect(isSensitiveHttpTraceRoute("/projects/123/overview")).toBe(false);
    expect(isSensitiveHttpTraceRoute("/users/profile")).toBe(false);
  });

  it("redacts sensitive headers, cookies, and tokens when non-sensitive route is traced", () => {
    process.env.LCSP_DEV_UNSAFE_TRACE = "true";
    process.env.LCSP_DEV_UNSAFE_UNFILTERED = "true";
    const write = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const next = jest.fn();
    try {
      const fakeToken = ["Bearer ghp", "_token1234567890abcdef"].join("");
      const request = {
        path: "/assessments",
        originalUrl: "/assessments",
        method: "GET",
        headers: {
          authorization: fakeToken,
          cookie: "session_token=secret-session-cookie",
          "x-api-key": "synthetic-secret-key",
          "content-type": "application/json",
        },
        rawHeaders: [
          "Authorization",
          fakeToken,
          "Cookie",
          "session_token=secret-session-cookie",
          "Content-Type",
          "application/json",
        ],
        cookies: {
          session_token: "secret-cookie-val",
        },
        signedCookies: {
          signed_token: "secret-signed-val",
        },
      } as unknown as Request;
      const response = {
        json: jest.fn(),
        send: jest.fn(),
        on: jest.fn(),
        statusCode: 200,
        getHeaders: () => ({
          "set-cookie": ["session_token=secret-new-cookie; Path=/"],
          "content-type": "application/json",
        }),
      };
      new DevUnsafeHttpTraceMiddleware().use(
        request,
        response as unknown as Response,
        next,
      );
      expect(next).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalled();
      const output = write.mock.calls[0][0] as string;
      expect(output).not.toContain("ghp_token1234567890abcdef");
      expect(output).not.toContain("secret-session-cookie");
      expect(output).not.toContain("synthetic-secret-key");
      expect(output).toContain("[REDACTED]");
    } finally {
      write.mockRestore();
    }
  });

  it("logs actual body size from content-length header and dynamic limit for technical profile callback", () => {
    process.env.LCSP_DEV_UNSAFE_TRACE = "true";
    process.env.LCSP_DEV_UNSAFE_UNFILTERED = "false";
    process.env.NODE_ENV = "development";

    const writeSpy = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    emitDevUnsafeTrace("DEV_API_HTTP_REQUEST_RAW", {
      originalUrl: "/internal/evidence/technical-profile-callback",
      headers: {
        "content-length": "3333740",
      },
      body: { some: "payload" },
    });

    expect(writeSpy).toHaveBeenCalled();
    const logCall = writeSpy.mock.calls[0][0] as string;
    const record = JSON.parse(logCall.trim()) as TraceRecord & {
      body_limit?: number;
      body_truncated?: boolean;
    };

    expect(record.body_size).toBe(3333740);
    expect(record.body_limit).toBe(1048576);
    expect(record.body_truncated).toBe(true);

    writeSpy.mockRestore();
  });

  describe("environment whitelist enforcement", () => {
    it("allows development and test environments when enabled", () => {
      process.env.LCSP_DEV_UNSAFE_TRACE = "true";
      process.env.LCSP_DEV_UNSAFE_UNFILTERED = "true";

      process.env.NODE_ENV = "development";
      expect(unsafeDevTraceEnabled()).toBe(true);
      expect(unsafeDevUnfilteredEnabled()).toBe(true);

      process.env.NODE_ENV = "test";
      expect(unsafeDevTraceEnabled()).toBe(true);
      expect(unsafeDevUnfilteredEnabled()).toBe(true);
    });

    it("throws an error for non-whitelisted environments (production, staging, preview, uat, empty)", () => {
      process.env.LCSP_DEV_UNSAFE_TRACE = "true";
      process.env.LCSP_DEV_UNSAFE_UNFILTERED = "true";

      const disallowed = [
        "production",
        "staging",
        "preview",
        "uat",
        "",
        "ci",
        "custom",
      ];
      for (const env of disallowed) {
        process.env.NODE_ENV = env;
        expect(() => unsafeDevTraceEnabled()).toThrow(
          /LCSP_DEV_UNSAFE_TRACE must only be enabled in allowed environments/,
        );
        expect(() => unsafeDevUnfilteredEnabled()).toThrow(
          /LCSP_DEV_UNSAFE_UNFILTERED must only be enabled in allowed environments/,
        );
      }
    });

    it("does not throw if tracing is disabled regardless of environment", () => {
      process.env.LCSP_DEV_UNSAFE_TRACE = "false";
      process.env.LCSP_DEV_UNSAFE_UNFILTERED = "false";
      process.env.NODE_ENV = "production";

      expect(unsafeDevTraceEnabled()).toBe(false);
      expect(unsafeDevUnfilteredEnabled()).toBe(false);
    });
  });
});
