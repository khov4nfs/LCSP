import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  createProblemResult,
} from "@lcsp/contracts/auth";
import {
  PBAC_ACTIONS,
  PBAC_DECISION,
  PBAC_REASON_CODE,
} from "@lcsp/contracts/pbac";

import type {
  AuditEvent,
  AuthorizationDecision,
  Invitation,
  Membership,
  MfaEnrollment,
  Organization,
  Policy,
  Session,
  User,
} from "../../../domain/models/auth-workspace.models.ts";
import { Session as SessionEntity } from "../../../domain/models/auth-workspace.models.ts";
import { WorkspaceAuthorizationDomainService } from "../../../domain/services/workspace-authorization.domain-service.ts";
import {
  createCorrelationId,
  fingerprintToken,
  hashSecret,
  issueOpaqueToken,
} from "../../../infrastructure/security/security.utils.ts";
import type {
  AuthProblemResult,
  SafeUserProjection,
} from "../../contracts/auth-workspace/common.contract.ts";
import type { RegisterPayload } from "../../contracts/auth-workspace/register-approved-path.contract.ts";
import type { CredentialPayload } from "../../contracts/auth-workspace/sign-in.contract.ts";
import type { WorkspaceAuthorization } from "../../contracts/auth-workspace/workspace.contract.ts";
import type { AuthWorkspaceRepositories } from "../../ports/persistence/auth-workspace-repositories.ts";
import type { AuthAuditService } from "./auth-audit.service.ts";

const FAILED_LOGIN_LIMIT = 3;
const LOCK_WINDOW_MS = 15 * 60_000;
const SESSION_TTL_MS = 8 * 60 * 60_000;

export class AuthWorkspaceSupportService {
  private readonly workspaceAuthorization: WorkspaceAuthorizationDomainService;

  constructor(private readonly authAudit?: AuthAuditService) {
    this.workspaceAuthorization = new WorkspaceAuthorizationDomainService();
  }

  createCorrelationId(): string {
    return createCorrelationId();
  }

  now(): number {
    return Date.now();
  }

  get failedLoginLimit(): number {
    return FAILED_LOGIN_LIMIT;
  }

  get lockWindowMs(): number {
    return LOCK_WINDOW_MS;
  }

  safeUserProjection(
    user: User,
    organizationId: string,
    membership: Membership,
  ): SafeUserProjection {
    return {
      user_id: user.id,
      email: user.email.toString(),
      organization_id: organizationId,
      membership_status: membership.status,
      // Only the role label is client-safe; other subject attributes are
      // internal PBAC policy-evaluation inputs and must not leak to the client.
      subject_attributes: membership.hasRole()
        ? { role: membership.role() }
        : {},
    };
  }

  isMfaRequired(
    user: User,
    organization: Organization | null,
    mfaEnrollment: MfaEnrollment | null,
  ): boolean {
    if (user.mfaRequired) {
      return true;
    }

    void organization;
    return mfaEnrollment !== null && mfaEnrollment.verifiedAt !== null;
  }

  isMfaEnrolled(mfaEnrollment: MfaEnrollment | null): boolean {
    return mfaEnrollment !== null && mfaEnrollment.verifiedAt !== null;
  }

  recordAudit(repositories: unknown, event: AuditEvent): Promise<void> {
    void repositories;
    if (!this.authAudit) {
      return Promise.resolve();
    }
    return this.authAudit.write(event);
  }

  recordDecision(
    repositories: AuthWorkspaceRepositories,
    decision: AuthorizationDecision,
  ): Promise<void> {
    return repositories.authorizationDecisions.append(decision);
  }

  findMembership(
    repositories: AuthWorkspaceRepositories,
    userId: string,
    organizationId: string,
  ): Promise<Membership | null> {
    return repositories.memberships.findByUserAndOrganization(
      userId,
      organizationId,
    );
  }

  resolveUserById(
    repositories: AuthWorkspaceRepositories,
    userId: string,
  ): Promise<User | null> {
    return repositories.users.findById(userId);
  }

  resolveOrganizationById(
    repositories: AuthWorkspaceRepositories,
    organizationId: string,
  ): Promise<Organization | null> {
    return repositories.organizations.findById(organizationId);
  }

  findPolicy(
    repositories: AuthWorkspaceRepositories,
    membership: Membership,
  ): Promise<Policy | null> {
    return repositories.policies.findByIdAndVersion(
      membership.policyId,
      membership.policyVersion,
    );
  }

  normalizeInvitationEmail(invitation: Invitation): string {
    return invitation.email.toString();
  }

  validateCredentialPayload(
    payload: CredentialPayload,
    correlationId: string,
  ): AuthProblemResult | null {
    if (
      !this.requireString(payload?.email) ||
      !this.requireString(payload?.password)
    ) {
      return createProblemResult(
        AUTH_ERROR_CODES.validationFailed,
        correlationId,
      );
    }

    return null;
  }

  validateRegisterPayload(
    payload: RegisterPayload,
    correlationId: string,
  ): AuthProblemResult | null {
    if (
      !this.requireString(payload?.invite_id) ||
      !this.requireString(payload?.password)
    ) {
      return createProblemResult(
        AUTH_ERROR_CODES.validationFailed,
        correlationId,
      );
    }

    return null;
  }

  async createSession(
    repositories: AuthWorkspaceRepositories,
    user: User,
    organizationId: string,
    correlationId: string,
  ): Promise<{ token: string; session: Session }> {
    const token = issueOpaqueToken();
    const fingerprint = fingerprintToken(token);
    const session = new SessionEntity({
      userId: user.id,
      organizationId,
      tokenHash: hashSecret(token),
      expiresAt: this.now() + SESSION_TTL_MS,
      revokedAt: null,
    });
    await repositories.sessions.save(session, fingerprint);
    await this.recordAudit(repositories, {
      event_type: AUTH_LEGACY_AUDIT_EVENT_TYPES.sessionCreated,
      actor_id: user.id,
      organization_id: organizationId,
      decision: AUDIT_DECISIONS.allow,
      correlationId: correlationId,
      session_id: session.id,
      policy_id: null,
      policy_version: null,
    });
    return { token, session };
  }

  async findValidSession(
    repositories: AuthWorkspaceRepositories,
    token: string,
  ): Promise<Session | null> {
    const session = await repositories.sessions.findByFingerprint(
      fingerprintToken(token),
    );

    if (!session) {
      return null;
    }

    if (!session.isActive(this.now())) {
      return null;
    }

    return session;
  }

  findMfaEnrollment(
    repositories: AuthWorkspaceRepositories,
    userId: string,
  ): Promise<MfaEnrollment | null> {
    return repositories.mfaEnrollments.findByUserId(userId);
  }

  async authorizeWorkspace(
    repositories: AuthWorkspaceRepositories,
    membership: Membership | null | undefined,
    correlationId: string,
    organizationId: string,
    resourceId = "workspace-home",
  ): Promise<WorkspaceAuthorization> {
    const policy = membership
      ? await this.findPolicy(repositories, membership)
      : undefined;
    const domainDecision = this.workspaceAuthorization.authorize(
      membership ?? undefined,
      policy ?? undefined,
      organizationId,
    );
    const subjectRole = membership?.role();

    if (!domainDecision.allowed || !membership || !policy || !subjectRole) {
      const denialCode = domainDecision.allowed
        ? AUTH_ERROR_CODES.authzEvaluatorFailure
        : domainDecision.code;
      const denied = createProblemResult(denialCode, correlationId);
      await this.recordDecision(repositories, {
        actor_id: membership?.userId ?? null,
        session_id: null,
        organization_id: membership?.organizationId ?? null,
        resource_type: AUDIT_RESOURCE_TYPES.workspace,
        resource_id: resourceId,
        action: PBAC_ACTIONS.workspaceRead,
        decision: PBAC_DECISION.deny,
        reason_code: denialCode,
        policy_id: membership?.policyId ?? null,
        policy_version: membership?.policyVersion ?? null,
        correlationId: correlationId,
      });
      return denied;
    }

    const allowed: AuthorizationDecision = {
      actor_id: membership.userId,
      session_id: null,
      organization_id: organizationId,
      resource_type: AUDIT_RESOURCE_TYPES.workspace,
      resource_id: resourceId,
      action: PBAC_ACTIONS.workspaceRead,
      decision: PBAC_DECISION.allow,
      reason_code: PBAC_REASON_CODE.authorized,
      policy_id: membership?.policyId ?? null,
      policy_version: membership?.policyVersion ?? null,
      correlationId: correlationId,
    };
    await this.recordDecision(repositories, allowed);
    return {
      ok: true,
      decision: allowed,
      membership_status: membership.status,
      subject_role: subjectRole,
      granted_actions: [...policy.actions],
    };
  }

  private requireString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
  }
}
