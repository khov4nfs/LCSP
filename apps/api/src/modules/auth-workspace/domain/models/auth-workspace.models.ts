import type { AuditResourceType } from "@lcsp/contracts/audit";
import type { AuthErrorCode } from "@lcsp/contracts/auth";
import type { PbacDecisionValue, PbacReasonCode } from "@lcsp/contracts/pbac";

export { Invitation } from "../entities/invitation.entity.ts";
export type { InvitationState } from "../entities/invitation.entity.ts";
export { Membership } from "../entities/membership.entity.ts";
export type { MembershipStatus } from "../entities/membership.entity.ts";
export { MfaEnrollment } from "../entities/mfa-enrollment.entity.ts";
export { MfaRateLimit } from "../entities/mfa-rate-limit.entity.ts";
export { OAuthIdentity } from "../entities/oauth-identity.entity.ts";
export { OAuthState } from "../entities/oauth-state.entity.ts";
export { Organization } from "../entities/organization.entity.ts";
export { Policy } from "../entities/policy.entity.ts";
export { RecoveryRequest } from "../entities/recovery-request.entity.ts";
export { Session } from "../entities/session.entity.ts";
export { User } from "../entities/user.entity.ts";
export type { SubjectAttributesRecord as SubjectAttributes } from "../value-objects/subject-attributes.value-object.ts";

export type AuthorizationDecision = {
  actor_id?: string | null;
  session_id?: string | null;
  organization_id: string | null;
  resource_type: AuditResourceType;
  resource_id: string;
  action: string;
  decision: PbacDecisionValue;
  reason_code: AuthErrorCode | PbacReasonCode;
  policy_id: string | null;
  policy_version: string | null;
  correlationId: string;
};

export type AuditEvent = Record<string, unknown> & {
  resource_type?: AuditResourceType | null;
};
