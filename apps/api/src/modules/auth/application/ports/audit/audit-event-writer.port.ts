import type { AuditEventInput } from "@lcsp/contracts/audit";

/** Database-neutral sink for normalized audit events. Transactional sinks
 * are bound to their DB transaction exclusively by infrastructure adapters. */
export interface AuthAuditEventWriter {
  write(event: AuditEventInput): Promise<void>;
}

export const AUTH_AUDIT_EVENT_WRITER = Symbol("AUTH_AUDIT_EVENT_WRITER");
