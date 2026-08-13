import type { AuditDecision } from "@lcsp/contracts/audit";

export type AuditEventDecision = AuditDecision | null;

export interface AuditEventSummary {
  event_id: string;
  event_type: string;
  actor_id: string | null;
  organization_id: string;
  decision: AuditEventDecision;
  payload: Record<string, unknown> | null;
  occurred_at: string;
}

export interface AuditEventListDto {
  events: AuditEventSummary[];
  total: number;
  page: number;
  page_size: number;
  correlationId: string;
}
