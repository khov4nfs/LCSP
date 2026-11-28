import type { AuditResourceType } from "@lcsp/contracts/audit";

export { MfaEnrollment } from "../entities/mfa-enrollment.entity.ts";
export { MfaRateLimit } from "../entities/mfa-rate-limit.entity.ts";
export { OAuthIdentity } from "../entities/oauth-identity.entity.ts";
export { OAuthState } from "../entities/oauth-state.entity.ts";
export { RecoveryRequest } from "../entities/recovery-request.entity.ts";
export { Session } from "../entities/session.entity.ts";
export { User } from "../entities/user.entity.ts";

export type AuditEvent = Record<string, unknown> & {
  resource_type?: AuditResourceType | null;
};
