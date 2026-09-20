import type { AuditEvent } from "../../../domain/models/auth.models.ts";

export const AUTH_AUDIT_EVENT_REPOSITORY = Symbol(
  "AUTH_AUDIT_EVENT_REPOSITORY",
);

export interface AuditEventRepository {
  append(event: AuditEvent): Promise<void>;
}
