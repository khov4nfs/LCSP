import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import { jest } from "@jest/globals";
import {
  AUTH_AUDIT_EVENT_TYPES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";
import type { Prisma } from "@prisma/client";

import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { RBAC_REASON_CODES } from "@lcsp/contracts/rbac";
import { AuthAuditService } from "./auth-audit.service.ts";

function makeService(
  overrides: {
    write?: AuditWriterService["write"];
    writeInTx?: AuditWriterService["writeInTx"];
  } = {},
) {
  const write = jest
    .fn<AuditWriterService["write"]>()
    .mockImplementation(overrides.write ?? (() => Promise.resolve()));
  const writeInTx = jest
    .fn<AuditWriterService["writeInTx"]>()
    .mockImplementation(overrides.writeInTx ?? (() => Promise.resolve()));
  const auditWriter = { write, writeInTx } as unknown as AuditWriterService;
  const service = new AuthAuditService(auditWriter);

  return { service, write, writeInTx };
}

describe("AuthAuditService", () => {
  it("delegates a normalized event to the platform audit writer", async () => {
    const { service, write } = makeService();

    await service.write({
      eventType: AUTH_AUDIT_EVENT_TYPES.authSignInSuccess,
      actorId: "user-1",
      correlationId: "corr-1",
      decision: AUDIT_DECISIONS.allow,
      payload: { email_domain: "example.test" },
    });

    expect(write).toHaveBeenCalledWith({
      eventType: AUTH_AUDIT_EVENT_TYPES.authSignInSuccess,
      actorId: "user-1",
      resourceType: null,
      resourceId: null,
      reasonCode: null,
      correlationId: "corr-1",
      sessionId: null,
      decision: AUDIT_DECISIONS.allow,
      payload: { email_domain: "example.test" },
    });
  });

  it("strips sensitive payload fields before writing", async () => {
    const { service, write } = makeService();
    const warnSpy = jest.spyOn(
      Reflect.get(service, "logger") as { warn: (msg: string) => void },
      "warn",
    );

    await service.write({
      eventType: AUTH_AUDIT_EVENT_TYPES.authMfaEnrolled,
      actorId: "user-1",
      correlationId: "corr-1",
      decision: AUDIT_DECISIONS.allow,
      payload: {
        password: "p",
        sessionToken: "t",
        mfaSecret: "s",
        providerKey: "k",
        nonce: "n",
        code: "c",
        tokenHash: "h",
        retained: "ok",
      },
    });

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { retained: "ok" } }),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("password"));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("sessionToken"),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("mfaSecret"));
  });

  it("rethrows writer failures", async () => {
    const { service } = makeService({
      write: () => Promise.reject(new Error("db unavailable")),
    });
    const errorSpy = jest.spyOn(
      Reflect.get(service, "logger") as { error: (msg: string) => void },
      "error",
    );

    await expect(
      service.write({
        eventType: AUTH_AUDIT_EVENT_TYPES.authSignInFailed,
        actorId: null,
        correlationId: "corr-1",
        decision: AUDIT_DECISIONS.deny,
      }),
    ).rejects.toThrow("db unavailable");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("db unavailable"),
    );
  });

  it("delegates transactional writes through the platform writer", async () => {
    const { service, write, writeInTx } = makeService();
    const tx = {} as Prisma.TransactionClient;

    await service.writeInTx(
      {
        eventType: AUTH_AUDIT_EVENT_TYPES.authSessionRevoked,
        actorId: "manager-1",
        correlationId: "corr-1",
        decision: AUDIT_DECISIONS.allow,
      },
      tx,
    );

    expect(writeInTx).toHaveBeenCalledWith(expect.any(Object), tx);
    expect(write).not.toHaveBeenCalled();
  });

  it("accepts all auth-workspace audit event types", async () => {
    const { service, write } = makeService();
    const eventTypes = Object.values(AUTH_AUDIT_EVENT_TYPES);

    for (const eventType of eventTypes) {
      await service.write({
        eventType,
        actorId: null,
        correlationId: "corr-1",
        decision: AUDIT_DECISIONS.allow,
      });
    }

    expect(write).toHaveBeenCalledTimes(eventTypes.length);
  });

  it("accepts null actors for unauthenticated events", async () => {
    const { service, write } = makeService();

    await service.write({
      eventType: AUTH_AUDIT_EVENT_TYPES.authSignInFailed,
      actorId: null,
      correlationId: "corr-1",
      decision: AUDIT_DECISIONS.deny,
    });

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: null }),
    );
  });

  it("normalizes legacy snake_case audit events and preserves nonsensitive payload", async () => {
    const { service, write } = makeService();
    const warnSpy = jest.spyOn(
      Reflect.get(service, "logger") as { warn: (msg: string) => void },
      "warn",
    );

    await service.write({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginSucceeded,
      actor_id: "user-1",
      decision: AUDIT_DECISIONS.allow,
      correlationId: "corr-1",
      reason_code: RBAC_REASON_CODES.authorized,
      session_id: "session-1",
      session_token: "must-strip",
      email_domain: "example.test",
    });

    expect(write).toHaveBeenCalledWith({
      eventType: "LOGIN_SUCCESS",
      actorId: "user-1",
      resourceType: null,
      resourceId: null,
      reasonCode: RBAC_REASON_CODES.authorized,
      correlationId: "corr-1",
      sessionId: "session-1",
      decision: AUDIT_DECISIONS.allow,
      payload: {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginSucceeded,
        actor_id: "user-1",
        decision: AUDIT_DECISIONS.allow,
        correlationId: "corr-1",
        reason_code: RBAC_REASON_CODES.authorized,
        session_id: "session-1",
        email_domain: "example.test",
      },
    });
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("reason_code"),
    );
  });
});
