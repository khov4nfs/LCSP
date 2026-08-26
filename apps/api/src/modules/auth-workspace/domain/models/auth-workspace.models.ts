import type { AuditDecision, AuditResourceType } from "@lcsp/contracts/audit";
import type { AuthErrorCode } from "@lcsp/contracts/auth";
import type { LocalRbacReasonCode } from "../../../../platform/rbac/rbac-reason-codes.js";

export { MfaEnrollment } from "../entities/mfa-enrollment.entity.ts";
export { MfaRateLimit } from "../entities/mfa-rate-limit.entity.ts";
export { OAuthIdentity } from "../entities/oauth-identity.entity.ts";
export { OAuthState } from "../entities/oauth-state.entity.ts";
export { RecoveryRequest } from "../entities/recovery-request.entity.ts";
export { Session } from "../entities/session.entity.ts";
export { User } from "../entities/user.entity.ts";

export type AuthorizationDecision = {
  actor_id?: string | null;
  session_id?: string | null;
  resource_type: AuditResourceType;
  resource_id: string;
  decision: AuditDecision;
  reason_code: AuthErrorCode | LocalRbacReasonCode;
  correlationId: string;
};

export type AuditEvent = Record<string, unknown> & {
  resource_type?: AuditResourceType | null;
};
