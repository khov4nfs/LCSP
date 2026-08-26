import {
  AUDIT_DECISIONS,
  AUDIT_EVENT_SCHEMA_VERSION,
  AUDIT_REDACTION_STATUSES,
  buildAuditEventInput,
  AUDIT_RESOURCE_TYPES,
  AUDIT_ACTOR_TYPES,
} from "@lcsp/contracts/audit";
import { ASSESSMENT_EVENT_TYPES } from "@lcsp/contracts/assessment";
import { AUTH_AUDIT_EVENT_TYPES } from "@lcsp/contracts/auth";
import {
  OUTBOX_MESSAGE_SCHEMA_VERSION,
  buildOutboxMessageInput,
  isCanonicalOutboxEventName,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";

describe("Foundational audit/outbox event contract", () => {
  it("T01: builds audit payloads with schema, actor, result, correlation, causation, assessment and redaction metadata", () => {
    const event = buildAuditEventInput({
      eventType: AUTH_AUDIT_EVENT_TYPES.authSessionRevoked,
      actorId: "manager-1",
      assessmentId: "assessment-1",
      resourceType: AUDIT_RESOURCE_TYPES.authSession,
      resourceId: "session-1",
      correlationId: "corr-1",
      causationId: "command-1",
      decision: AUDIT_DECISIONS.allow,
      result: "SESSION_REVOKED",
      redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
      payload: {
        safeRef: "session-1",
        sessionToken: "must-not-persist",
      },
    });

    expect(event.payload).toEqual({
      schemaVersion: AUDIT_EVENT_SCHEMA_VERSION,
      actor: { id: "manager-1", type: AUDIT_ACTOR_TYPES.user },
      assessmentId: "assessment-1",
      causationId: "command-1",
      redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
      result: "SESSION_REVOKED",
      safeRef: "session-1",
    });
  });

  it("T02: enforces canonical command/event names and strips unsafe outbox payload fields", () => {
    expect(
      isCanonicalOutboxEventName(ASSESSMENT_EVENT_TYPES.createdOutbox),
    ).toBe(true);
    expect(isCanonicalOutboxEventName("assessment.created")).toBe(false);

    const message = buildOutboxMessageInput({
      aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
      aggregateId: "assessment-1",
      eventType: ASSESSMENT_EVENT_TYPES.createdOutbox,
      assessmentId: "assessment-1",
      correlationId: "corr-1",
      causationId: "command-1",
      actor: { id: "manager-1", type: AUDIT_ACTOR_TYPES.user },
      result: ASSESSMENT_EVENT_TYPES.created,
      redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
      idempotencyKey: `assessment-1:${ASSESSMENT_EVENT_TYPES.createdOutbox}`,
      payload: {
        assessmentId: "assessment-1",
        repositoryToken: "must-not-persist",
      },
    });

    expect(message.schemaVersion).toBe(OUTBOX_MESSAGE_SCHEMA_VERSION);
    expect(message.payload).toEqual({
      schemaVersion: OUTBOX_MESSAGE_SCHEMA_VERSION,
      assessmentId: "assessment-1",
      correlationId: "corr-1",
      causationId: "command-1",
      actor: { id: "manager-1", type: AUDIT_ACTOR_TYPES.user },
      result: ASSESSMENT_EVENT_TYPES.created,
      redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
      idempotencyKey: `assessment-1:${ASSESSMENT_EVENT_TYPES.createdOutbox}`,
    });
  });
});
