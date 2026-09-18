import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  MFA_RECOVERY_CODE_ACCESS_ACTIONS,
} from "@lcsp/contracts/auth";
import { describe, expect, it, jest } from "@jest/globals";

import { Session } from "../../../domain/models/auth-workspace.models.ts";
import { RecordMfaRecoveryCodeAccessCommand } from "./record-mfa-recovery-code-access.command.ts";
import { RecordMfaRecoveryCodeAccessHandler } from "./record-mfa-recovery-code-access.handler.ts";

describe("RecordMfaRecoveryCodeAccessHandler", () => {
  it("rejects when userId or sessionId is missing", async () => {
    const support = {
      createCorrelationId: () => "corr-123",
      now: () => Date.now(),
      recordAudit: jest.fn(() => Promise.resolve()),
    };
    const repositories = {
      sessions: {
        findById: jest.fn(() => Promise.resolve(null)),
      },
    };

    const handler = new RecordMfaRecoveryCodeAccessHandler(
      support as never,
      repositories as never,
    );

    const result = await handler.execute(
      new RecordMfaRecoveryCodeAccessCommand(
        "user-1",
        MFA_RECOVERY_CODE_ACCESS_ACTIONS.view,
        "",
        { correlationId: "corr-123" },
      ),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem.code).toBe(AUTH_ERROR_CODES.sessionInvalid);
    }
  });

  it("rejects when the session is not found or inactive", async () => {
    const support = {
      createCorrelationId: () => "corr-123",
      now: () => Date.now(),
      recordAudit: jest.fn(() => Promise.resolve()),
    };
    const repositories = {
      sessions: {
        findById: jest.fn(() => Promise.resolve(null)),
      },
    };

    const handler = new RecordMfaRecoveryCodeAccessHandler(
      support as never,
      repositories as never,
    );

    const result = await handler.execute(
      new RecordMfaRecoveryCodeAccessCommand(
        "user-1",
        MFA_RECOVERY_CODE_ACCESS_ACTIONS.view,
        "missing-session",
        { correlationId: "corr-123" },
      ),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem.code).toBe(AUTH_ERROR_CODES.sessionInvalid);
    }
  });

  it("rejects when the session belongs to a different user", async () => {
    const session = Session.rehydrate({
      id: "session-1",
      userId: "user-2",
      tokenHash: "hash",
      expiresAt: Date.now() + 3600_000,
      mfaVerifiedAt: Date.now(),
    });

    const support = {
      createCorrelationId: () => "corr-123",
      now: () => Date.now(),
      recordAudit: jest.fn(() => Promise.resolve()),
    };
    const repositories = {
      sessions: {
        findById: jest.fn(() => Promise.resolve(session)),
      },
    };

    const handler = new RecordMfaRecoveryCodeAccessHandler(
      support as never,
      repositories as never,
    );

    const result = await handler.execute(
      new RecordMfaRecoveryCodeAccessCommand(
        "user-1",
        MFA_RECOVERY_CODE_ACCESS_ACTIONS.view,
        "session-1",
        { correlationId: "corr-123" },
      ),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem.code).toBe(AUTH_ERROR_CODES.sessionInvalid);
    }
  });

  it("rejects when the session is not MFA verified", async () => {
    const session = Session.rehydrate({
      id: "session-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: Date.now() + 3600_000,
      mfaVerifiedAt: null,
    });

    const support = {
      createCorrelationId: () => "corr-123",
      now: () => Date.now(),
      recordAudit: jest.fn(() => Promise.resolve()),
    };
    const repositories = {
      sessions: {
        findById: jest.fn(() => Promise.resolve(session)),
      },
    };

    const handler = new RecordMfaRecoveryCodeAccessHandler(
      support as never,
      repositories as never,
    );

    const result = await handler.execute(
      new RecordMfaRecoveryCodeAccessCommand(
        "user-1",
        MFA_RECOVERY_CODE_ACCESS_ACTIONS.view,
        "session-1",
        { correlationId: "corr-123" },
      ),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem.code).toBe(AUTH_ERROR_CODES.mfaRequired);
    }
  });

  it("records audit and succeeds when valid active MFA-verified session is provided", async () => {
    const session = Session.rehydrate({
      id: "session-1",
      userId: "user-1",
      tokenHash: "hash",
      expiresAt: Date.now() + 3600_000,
      mfaVerifiedAt: Date.now(),
    });

    const recordAuditMock = jest.fn();
    const support = {
      createCorrelationId: () => "corr-123",
      now: () => Date.now(),
      recordAudit: recordAuditMock,
    };
    const repositories = {
      sessions: {
        findById: jest.fn(() => Promise.resolve(session)),
      },
    };

    const handler = new RecordMfaRecoveryCodeAccessHandler(
      support as never,
      repositories as never,
    );

    const result = await handler.execute(
      new RecordMfaRecoveryCodeAccessCommand(
        "user-1",
        MFA_RECOVERY_CODE_ACCESS_ACTIONS.copy,
        "session-1",
        { correlationId: "corr-123" },
      ),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.correlationId).toBe("corr-123");
    }
    expect(recordAuditMock).toHaveBeenCalledWith(
      repositories,
      expect.objectContaining({
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRecoveryCodeCopied,
        actor_id: "user-1",
        resource_type: AUDIT_RESOURCE_TYPES.authMfaRecoveryCode,
        resource_id: "user-1",
        decision: AUDIT_DECISIONS.allow,
        correlationId: "corr-123",
        session_id: "session-1",
        action: MFA_RECOVERY_CODE_ACCESS_ACTIONS.copy,
      }),
    );
  });
});
