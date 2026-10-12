import type { AuditDecision, AuditResourceType } from "@lcsp/contracts/audit";
import type { AuthErrorCode } from "@lcsp/contracts/auth";
import type { RbacReasonCode } from "@lcsp/contracts/rbac";

export const AUTHORIZATION_DECISION_REPOSITORY = Symbol(
  "AUTHORIZATION_DECISION_REPOSITORY",
);

export type AuthorizationDecision = {
  actor_id?: string | null;
  session_id?: string | null;
  resource_type: AuditResourceType;
  resource_id: string;
  decision: AuditDecision;
  reason_code: AuthErrorCode | RbacReasonCode;
  correlationId: string;
};

export interface AuthorizationDecisionRepository {
  append(decision: AuthorizationDecision): Promise<void>;
}
