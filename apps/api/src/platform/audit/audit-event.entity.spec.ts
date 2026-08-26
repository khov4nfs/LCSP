import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import { AUTH_AUDIT_EVENT_TYPES } from "@lcsp/contracts/auth";
import { AuditEventEntity } from "./audit-event.entity.js";

describe("AuditEventEntity", () => {
  it("T01: creates an event with all fields", () => {
    const occurredAt = new Date("2026-01-01T00:00:00Z");
    const event = AuditEventEntity.create(
      {
        eventType: AUTH_AUDIT_EVENT_TYPES.authSignInSuccess,
        actorId: "user-1",
        correlationId: "corr-1",
        decision: AUDIT_DECISIONS.allow,
        payload: { ip: "127.0.0.1" },
      },
      occurredAt,
    );

    expect(event.id).toEqual(expect.any(String));
    expect(event.eventType).toBe(AUTH_AUDIT_EVENT_TYPES.authSignInSuccess);
    expect(event.actorId).toBe("user-1");
    expect(event.correlationId).toBe("corr-1");
    expect(event.decision).toBe(AUDIT_DECISIONS.allow);
    expect(event.payload).toEqual({ ip: "127.0.0.1" });
    expect(event.occurredAt).toBe(occurredAt);
  });

  it("T02: creates an event with actorId = null", () => {
    const event = AuditEventEntity.create({
      eventType: AUTH_AUDIT_EVENT_TYPES.authOauthStart,
      actorId: null,
      correlationId: "corr-2",
      decision: null,
    });

    expect(event.actorId).toBeNull();
  });

  it("T03: defaults payload to an empty object when not provided", () => {
    const event = AuditEventEntity.create({
      eventType: AUTH_AUDIT_EVENT_TYPES.authSessionRevoked,
      actorId: "user-1",
      correlationId: "corr-3",
      decision: null,
    });

    expect(event.payload).toEqual({});
  });

  it("defaults occurredAt to now when not provided", () => {
    const before = Date.now();
    const event = AuditEventEntity.create({
      eventType: AUTH_AUDIT_EVENT_TYPES.authMfaEnrolled,
      actorId: "user-1",
      correlationId: "corr-4",
      decision: AUDIT_DECISIONS.allow,
    });
    const after = Date.now();

    expect(event.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(event.occurredAt.getTime()).toBeLessThanOrEqual(after);
  });

  it("rehydrates an event from persisted fields via fromPersistence", () => {
    const fields = {
      id: "audit-5",
      eventType: AUTH_AUDIT_EVENT_TYPES.authSessionRevoked,
      actorId: "user-2",
      correlationId: "corr-5",
      decision: AUDIT_DECISIONS.deny,
      payload: { reason: "expired" },
      occurredAt: new Date("2026-01-02T00:00:00Z"),
    };

    const event = AuditEventEntity.fromPersistence(fields);

    expect(event).toMatchObject(fields);
  });
});
