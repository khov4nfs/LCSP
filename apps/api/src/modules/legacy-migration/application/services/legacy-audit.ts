import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  type AuditEventInput,
  type AuditResourceType,
} from "@lcsp/contracts/audit";
import { LEGACY_MIGRATION_ACTOR_ID } from "@lcsp/contracts/legacy-migration";

export const LEGACY_MIGRATION_ACTOR = {
  id: LEGACY_MIGRATION_ACTOR_ID,
  type: AUDIT_ACTOR_TYPES.service,
} as const;

/** Audit input for a write performed by the migration tooling (service actor, allow, redacted). */
export function legacyAuditEvent(input: {
  eventType: string;
  correlationId: string;
  resourceType: AuditResourceType | null;
  resourceId: string | null;
  assessmentId?: string;
  payload: Record<string, unknown>;
}): AuditEventInput {
  return {
    eventType: input.eventType,
    actorId: LEGACY_MIGRATION_ACTOR.id,
    actor: LEGACY_MIGRATION_ACTOR,
    assessmentId: input.assessmentId ?? null,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    correlationId: input.correlationId,
    causationId: input.correlationId,
    decision: AUDIT_DECISIONS.allow,
    result: input.eventType,
    redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
    payload: input.payload,
  };
}
