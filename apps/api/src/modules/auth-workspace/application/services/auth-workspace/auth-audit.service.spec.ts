import { jest } from "@jest/globals";
import {
  AUTH_AUDIT_EVENT_TYPES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/auth";
import { PBAC_DECISION, PBAC_REASON_CODE } from "@lcsp/contracts/pbac";
import type { Prisma } from "@prisma/client";

import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
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
  it("T01: write() with clean payload delegates a normalized event to the platform audit writer", async () => {
    const { service, write } = makeService();

    await service.write({
      eventType: AUTH_AUDIT_EVENT_TYPES.authSignInSuccess,
      actorId: "user-1",
      organizationId: "org-1",
      correlationId: "corr-1",
      decision: PBAC_DECISION.allow,
      payload: { email_domain: "example.test" },
    });

    expect(write).toHaveBeenCalledWith({
      eventType: AUTH_AUDIT_EVENT_TYPES.authSignInSuccess,
      actorId: "user-1",
      organizationId: "org-1",
      resourceType: null,
      resourceId: null,
      reasonCode: null,
      correlationId: "corr-1",
      sessionId: null,
      policyId: null,
      policyVersion: null,
      decision: PBAC_DECISION.allow,
      payload: { email_domain: "example.test" },
    });
  });

  it("T02/T03/T04: strips sensitive password/token/secret/key/nonce/code/hash payload fields before writing", async () => {
    const { service, write } = makeService();
    const warnSpy = jest.spyOn(
      Reflect.get(service, "logger") as { warn: (msg: string) => void },
      "warn",
    );

    await service.write({
      eventType: AUTH_AUDIT_EVENT_TYPES.authMfaEnrolled,
      actorId: "user-1",
      organizationId: "org-1",
      correlationId: "corr-1",
      decision: PBAC_DECISION.allow,
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

  it("T05: writer failure is logged and rethrown so required audit is not silently dropped", async () => {
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
        organizationId: "org-1",
        correlationId: "corr-1",
        decision: PBAC_DECISION.deny,
      }),
    ).rejects.toThrow("db unavailable");

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("db unavailable"),
    );
  });

  it("T06: writeInTx() delegates through the platform transaction writer", async () => {
    const { service, write, writeInTx } = makeService();
    const tx = {} as Prisma.TransactionClient;

    await service.writeInTx(
      {
        eventType: AUTH_AUDIT_EVENT_TYPES.authDeveloperRevoked,
        actorId: "manager-1",
        organizationId: "org-1",
        correlationId: "corr-1",
        decision: PBAC_DECISION.allow,
      },
      tx,
    );

    expect(writeInTx).toHaveBeenCalledWith(expect.any(Object), tx);
    expect(write).not.toHaveBeenCalled();
  });

  it("T07: all auth-workspace audit event types are accepted", async () => {
    const { service, write } = makeService();
    const eventTypes = Object.values(AUTH_AUDIT_EVENT_TYPES);

    for (const eventType of eventTypes) {
      await service.write({
        eventType,
        actorId: null,
        organizationId: null,
        correlationId: "corr-1",
        decision: PBAC_DECISION.allow,
      });
    }

    expect(write).toHaveBeenCalledTimes(eventTypes.length);
  });

  it("T08: actorId can be null for unauthenticated events", async () => {
    const { service, write } = makeService();

    await service.write({
      eventType: AUTH_AUDIT_EVENT_TYPES.authSignInFailed,
      actorId: null,
      organizationId: "org-1",
      correlationId: "corr-1",
      decision: PBAC_DECISION.deny,
    });

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: null }),
    );
  });

  it("normalizes legacy auth-workspace snake_case audit events and preserves legacy payload shape", async () => {
    const { service, write } = makeService();
    const warnSpy = jest.spyOn(
      Reflect.get(service, "logger") as { warn: (msg: string) => void },
      "warn",
    );

    await service.write({
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginSucceeded,
      actor_id: "user-1",
      organization_id: "org-1",
      decision: PBAC_DECISION.allow,
      correlationId: "corr-1",
      reason_code: PBAC_REASON_CODE.authorized,
      session_id: "session-1",
      policy_id: "policy-1",
      policy_version: "v1",
      session_token: "must-strip",
      email_domain: "example.test",
    });

    expect(write).toHaveBeenCalledWith({
      eventType: "LOGIN_SUCCESS",
      actorId: "user-1",
      organizationId: "org-1",
      resourceType: null,
      resourceId: null,
      reasonCode: PBAC_REASON_CODE.authorized,
      correlationId: "corr-1",
      sessionId: "session-1",
      policyId: "policy-1",
      policyVersion: "v1",
      decision: PBAC_DECISION.allow,
      payload: {
        event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.loginSucceeded,
        actor_id: "user-1",
        organization_id: "org-1",
        decision: PBAC_DECISION.allow,
        correlationId: "corr-1",
        reason_code: PBAC_REASON_CODE.authorized,
        session_id: "session-1",
        policy_id: "policy-1",
        policy_version: "v1",
        email_domain: "example.test",
      },
    });
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("reason_code"),
    );
  });
});
