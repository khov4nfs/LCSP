import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_AUDIT_EVENT_TYPES,
  SIGN_UP_ERROR_CODES,
} from "@lcsp/contracts/auth";
import { describe, expect, it, jest } from "@jest/globals";

import { AuthApplicationError } from "../../errors/auth-application.error.ts";
import { SignUpCommand } from "./sign-up.command.ts";
import { SignUpHandler } from "./sign-up.handler.ts";

const mockFn = <T = void>(val?: T) =>
  jest.fn((...args: unknown[]) => {
    void args;
    return Promise.resolve(val);
  });

describe("SignUpHandler", () => {
  const correlationId = "test-corr-id";

  const createMockAuthAudit = () => ({
    write: mockFn(),
  });

  it("rejects when email already exists", async () => {
    const authAudit = createMockAuthAudit();
    const signUps = {
      emailExists: mockFn(true),
      createWithSessionAndAudit: mockFn(),
    };

    const handler = new SignUpHandler(signUps as never, authAudit as never);

    const command = new SignUpCommand({
      email: "existing@example.com",
      displayName: "Existing User",
      password: "Password123!",
      correlationId,
    });

    await expect(handler.execute(command)).rejects.toThrow(
      AuthApplicationError,
    );
    expect(signUps.createWithSessionAndAudit).not.toHaveBeenCalled();
    expect(authAudit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: AUTH_AUDIT_EVENT_TYPES.authSignUpFailed,
        decision: AUDIT_DECISIONS.deny,
        reasonCode: SIGN_UP_ERROR_CODES.emailAlreadyExists,
      }),
    );
  });

  it("catches database unique constraint violation and rejects with EMAIL_ALREADY_EXISTS", async () => {
    const authAudit = createMockAuthAudit();
    const prismaP2002Error = Object.assign(new Error("Unique constraint"), {
      code: "P2002",
    });
    const signUps = {
      emailExists: mockFn(false),
      createWithSessionAndAudit: jest.fn((...args: unknown[]) => {
        void args;
        return Promise.reject(prismaP2002Error);
      }),
    };

    const handler = new SignUpHandler(signUps as never, authAudit as never);

    const command = new SignUpCommand({
      email: "race-condition@example.com",
      displayName: "Race User",
      password: "Password123!",
      correlationId,
    });

    await expect(handler.execute(command)).rejects.toThrow(
      AuthApplicationError,
    );
    expect(authAudit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: AUTH_AUDIT_EVENT_TYPES.authSignUpFailed,
        decision: AUDIT_DECISIONS.deny,
        reasonCode: SIGN_UP_ERROR_CODES.emailAlreadyExists,
      }),
    );
  });

  it("successfully registers new customer and issues initial session", async () => {
    const authAudit = createMockAuthAudit();
    const signUps = {
      emailExists: mockFn(false),
      createWithSessionAndAudit: mockFn(),
    };

    const handler = new SignUpHandler(signUps as never, authAudit as never);

    const command = new SignUpCommand({
      email: "newuser@example.com",
      displayName: "New User",
      password: "SecurePassword123!",
      correlationId,
    });

    const result = await handler.execute(command);
    expect(result.user_id).toBeDefined();
    expect(result.session_token).toBeDefined();
    expect(result.expires_at).toBeDefined();
    expect(result.correlationId).toBe(correlationId);
    expect(signUps.createWithSessionAndAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId,
        user: expect.objectContaining({
          displayName: "New User",
        }),
        session: expect.objectContaining({
          userId: expect.any(String),
        }),
      }),
    );
  });
});
