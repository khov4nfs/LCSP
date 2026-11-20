import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_BACKUP_EMAIL_POLICIES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  USER_ACCESS_STATUSES,
} from "@lcsp/contracts/auth";
import { describe, expect, it, jest } from "@jest/globals";

import { User } from "../../../domain/entities/user.entity.ts";
import { RequestPasswordRecoveryCommand } from "./request-password-recovery.command.ts";
import { RequestPasswordRecoveryHandler } from "./request-password-recovery.handler.ts";

const mockFn = <T = void>(val?: T) =>
  jest.fn((...args: unknown[]) => {
    void args;
    return Promise.resolve(val);
  });

describe("RequestPasswordRecoveryHandler", () => {
  const now = 1_700_000_000_000;
  const correlationId = "test-corr-id";

  const createMockSupport = () => ({
    createCorrelationId: () => correlationId,
    now: () => now,
    recordAudit: mockFn(),
  });

  it("returns generic success and runs decoy hashing when user does not exist", async () => {
    const support = createMockSupport();
    const users = {
      findByPrimaryEmail: mockFn(null),
    };
    const recoveryRequests = {
      save: mockFn(),
    };
    const notifier = {
      notify: mockFn(),
    };

    const handler = new RequestPasswordRecoveryHandler(
      support as never,
      users as never,
      recoveryRequests as never,
      notifier,
    );

    const command = new RequestPasswordRecoveryCommand(
      { email: "nonexistent@example.com" },
      { correlationId },
    );

    const result = await handler.execute(command);
    expect(result).toEqual({ ok: true, correlationId });
    expect(recoveryRequests.save).not.toHaveBeenCalled();
    expect(notifier.notify).not.toHaveBeenCalled();
    expect(support.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.recoveryRequested,
        actor_id: null,
        decision: AUDIT_DECISIONS.allow,
      }),
    );
  });

  it("returns generic success and runs decoy hashing when user is suspended", async () => {
    const support = createMockSupport();
    const suspendedUser = User.rehydrate({
      id: "suspended-user",
      email: "suspended@example.com",
      passwordHash: "hash",
      emailVerified: true,
      accessStatus: USER_ACCESS_STATUSES.suspended,
    });

    const users = {
      findByPrimaryEmail: mockFn(suspendedUser),
    };
    const recoveryRequests = {
      save: mockFn(),
    };
    const notifier = {
      notify: mockFn(),
    };

    const handler = new RequestPasswordRecoveryHandler(
      support as never,
      users as never,
      recoveryRequests as never,
      notifier,
    );

    const command = new RequestPasswordRecoveryCommand(
      { email: "suspended@example.com" },
      { correlationId },
    );

    const result = await handler.execute(command);
    expect(result).toEqual({ ok: true, correlationId });
    expect(recoveryRequests.save).not.toHaveBeenCalled();
    expect(notifier.notify).not.toHaveBeenCalled();
    expect(support.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.recoveryRequested,
        actor_id: "suspended-user",
        decision: AUDIT_DECISIONS.allow,
      }),
    );
  });

  it("creates recovery request and sends notification for active user", async () => {
    const support = createMockSupport();
    const activeUser = User.rehydrate({
      id: "active-user",
      email: "active@example.com",
      passwordHash: "hash",
      emailVerified: true,
      accessStatus: USER_ACCESS_STATUSES.active,
      backupEmailPolicy: AUTH_BACKUP_EMAIL_POLICIES.recoveryEmail,
      recoveryEmail: "backup@example.com",
    });

    const users = {
      findByPrimaryEmail: mockFn(activeUser),
    };
    const recoveryRequests = {
      save: mockFn(),
    };
    const notifier = {
      notify: mockFn(),
    };

    const handler = new RequestPasswordRecoveryHandler(
      support as never,
      users as never,
      recoveryRequests as never,
      notifier,
    );

    const command = new RequestPasswordRecoveryCommand(
      { email: "active@example.com" },
      { correlationId, app_origin: "https://lcsp.local" },
    );

    const result = await handler.execute(command);
    expect(result).toEqual({ ok: true, correlationId });
    expect(recoveryRequests.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "active-user",
        expiresAt: now + 30 * 60_000,
      }),
      expect.any(String),
    );
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "active-user",
        email: "backup@example.com",
        correlationId,
        appOrigin: "https://lcsp.local",
      }),
    );
    expect(support.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.recoveryRequested,
        actor_id: "active-user",
        decision: AUDIT_DECISIONS.allow,
      }),
    );
  });
});
