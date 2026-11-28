import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";
import { describe, expect, it, jest } from "@jest/globals";

import { AuthApplicationError } from "../../errors/auth-application.error.ts";
import { RecoveryRequest } from "../../../domain/entities/recovery-request.entity.ts";
import {
  hashSecretSync,
  issueOpaqueToken,
} from "../../../../../platform/security/crypto.utils.js";
import { ConfirmPasswordRecoveryCommand } from "./confirm-password-recovery.command.ts";
import { ConfirmPasswordRecoveryHandler } from "./confirm-password-recovery.handler.ts";

const mockFn = <T = void>(val?: T) =>
  jest.fn((...args: unknown[]) => {
    void args;
    return Promise.resolve(val);
  });

describe("ConfirmPasswordRecoveryHandler", () => {
  const now = 1_700_000_000_000;
  const correlationId = "test-corr-id";

  const createMockSupport = () => ({
    createCorrelationId: () => correlationId,
    now: () => now,
    recordAudit: mockFn(),
  });

  it("rejects when recovery request does not exist or is expired", async () => {
    const support = createMockSupport();
    const recoveryRequests = {
      findByFingerprint: mockFn(null),
    };
    const security = {
      completePasswordRecovery: mockFn(true),
    };

    const handler = new ConfirmPasswordRecoveryHandler(
      support as never,
      recoveryRequests as never,
      security as never,
    );

    const command = new ConfirmPasswordRecoveryCommand(
      {
        token: "non-existent-token",
        new_password: "NewPassword123!",
      },
      { correlationId },
    );

    await expect(handler.execute(command)).rejects.toThrow(
      AuthApplicationError,
    );
    expect(support.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.recoveryConfirmFailed,
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.recoveryInvalid,
      }),
    );
  });

  it("rejects when token secret does not match salted tokenHash", async () => {
    const support = createMockSupport();
    const rawToken = issueOpaqueToken();
    const otherToken = issueOpaqueToken();

    const request = RecoveryRequest.rehydrate({
      id: "req-1",
      userId: "user-1",
      tokenHash: hashSecretSync(otherToken),
      expiresAt: now + 60_000,
    });

    const recoveryRequests = {
      findByFingerprint: mockFn(request),
    };
    const security = {
      completePasswordRecovery: mockFn(true),
    };

    const handler = new ConfirmPasswordRecoveryHandler(
      support as never,
      recoveryRequests as never,
      security as never,
    );

    const command = new ConfirmPasswordRecoveryCommand(
      {
        token: rawToken,
        new_password: "NewPassword123!",
      },
      { correlationId },
    );

    await expect(handler.execute(command)).rejects.toThrow(
      AuthApplicationError,
    );
    expect(support.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.recoveryConfirmFailed,
        actor_id: "user-1",
        decision: AUDIT_DECISIONS.deny,
        reason_code: AUTH_ERROR_CODES.recoveryInvalid,
      }),
    );
    expect(security.completePasswordRecovery).not.toHaveBeenCalled();
  });

  it("rejects when completePasswordRecovery persistence fails", async () => {
    const support = createMockSupport();
    const rawToken = issueOpaqueToken();

    const request = RecoveryRequest.rehydrate({
      id: "req-1",
      userId: "user-1",
      tokenHash: hashSecretSync(rawToken),
      expiresAt: now + 60_000,
    });

    const recoveryRequests = {
      findByFingerprint: mockFn(request),
    };
    const security = {
      completePasswordRecovery: mockFn(false),
    };

    const handler = new ConfirmPasswordRecoveryHandler(
      support as never,
      recoveryRequests as never,
      security as never,
    );

    const command = new ConfirmPasswordRecoveryCommand(
      {
        token: rawToken,
        new_password: "NewPassword123!",
      },
      { correlationId },
    );

    await expect(handler.execute(command)).rejects.toThrow(
      AuthApplicationError,
    );
    expect(security.completePasswordRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-1",
        userId: "user-1",
      }),
    );
  });

  it("successfully confirms password recovery with valid token", async () => {
    const support = createMockSupport();
    const rawToken = issueOpaqueToken();

    const request = RecoveryRequest.rehydrate({
      id: "req-1",
      userId: "user-1",
      tokenHash: hashSecretSync(rawToken),
      expiresAt: now + 60_000,
    });

    const recoveryRequests = {
      findByFingerprint: mockFn(request),
    };
    const security = {
      completePasswordRecovery: mockFn(true),
    };

    const handler = new ConfirmPasswordRecoveryHandler(
      support as never,
      recoveryRequests as never,
      security as never,
    );

    const command = new ConfirmPasswordRecoveryCommand(
      {
        token: rawToken,
        new_password: "NewValidPassword123!",
      },
      { correlationId },
    );

    const result = await handler.execute(command);
    expect(result).toEqual({ ok: true, correlationId });
    expect(security.completePasswordRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-1",
        userId: "user-1",
        now,
      }),
    );
  });
});
