import type { AuditEventRepository } from "./audit-event.repository.ts";
import type { AuthorizationDecisionRepository } from "./authorization-decision.repository.ts";
import type {
  MfaEnrollmentRepository,
  MfaOtpUsedRepository,
  MfaRateLimitRepository,
  MfaRecoveryCodeRepository,
} from "./mfa.repository.ts";
import type { OAuthIdentityRepository } from "./oauth-identity.repository.ts";
import type { OAuthStateRepository } from "./oauth-state.repository.ts";
import type { RecoveryRequestRepository } from "./recovery-request.repository.ts";
import type { SessionRepository } from "./session.repository.ts";
import type { UserRepository } from "./user.repository.ts";

export type AuthWorkspaceRepositories = {
  users: UserRepository;
  sessions: SessionRepository;
  auditEvents: AuditEventRepository;
  authorizationDecisions: AuthorizationDecisionRepository;
  mfaEnrollments: MfaEnrollmentRepository;
  mfaRateLimits: MfaRateLimitRepository;
  mfaOtpUsed: MfaOtpUsedRepository;
  mfaRecoveryCodes: MfaRecoveryCodeRepository;
  recoveryRequests: RecoveryRequestRepository;
  oauthStates: OAuthStateRepository;
  oauthIdentities: OAuthIdentityRepository;
};
