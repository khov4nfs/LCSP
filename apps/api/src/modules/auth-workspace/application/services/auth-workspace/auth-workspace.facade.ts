import type { PbacRequestContext } from "../../../../../platform/pbac/interfaces/pbac-request.interface.ts";
import { AcceptInvitationCommand } from "../../commands/accept-invitation/accept-invitation.command.ts";
import { AcceptInvitationHandler } from "../../commands/accept-invitation/accept-invitation.handler.ts";
import { ConfirmPasswordRecoveryCommand } from "../../commands/confirm-password-recovery/confirm-password-recovery.command.ts";
import { ConfirmPasswordRecoveryHandler } from "../../commands/confirm-password-recovery/confirm-password-recovery.handler.ts";
import { DisableMfaCommand } from "../../commands/disable-mfa/disable-mfa.command.ts";
import { DisableMfaHandler } from "../../commands/disable-mfa/disable-mfa.handler.ts";
import { EnrollMfaCommand } from "../../commands/enroll-mfa/enroll-mfa.command.ts";
import { EnrollMfaHandler } from "../../commands/enroll-mfa/enroll-mfa.handler.ts";
import { GenerateMfaRecoveryCodesCommand } from "../../commands/generate-mfa-recovery-codes/generate-mfa-recovery-codes.command.ts";
import { GenerateMfaRecoveryCodesHandler } from "../../commands/generate-mfa-recovery-codes/generate-mfa-recovery-codes.handler.ts";
import { InviteDeveloperCommand } from "../../commands/invite-developer/invite-developer.command.ts";
import { InviteDeveloperHandler } from "../../commands/invite-developer/invite-developer.handler.ts";
import { OAuthCallbackCommand } from "../../commands/oauth-callback/oauth-callback.command.ts";
import { OAuthCallbackHandler } from "../../commands/oauth-callback/oauth-callback.handler.ts";
import { OAuthLinkCallbackCommand } from "../../commands/oauth-link-callback/oauth-link-callback.command.ts";
import { OAuthLinkCallbackHandler } from "../../commands/oauth-link-callback/oauth-link-callback.handler.ts";
import { OAuthLinkStartCommand } from "../../commands/oauth-link-start/oauth-link-start.command.ts";
import { OAuthLinkStartHandler } from "../../commands/oauth-link-start/oauth-link-start.handler.ts";
import { OAuthStartCommand } from "../../commands/oauth-start/oauth-start.command.ts";
import { OAuthStartHandler } from "../../commands/oauth-start/oauth-start.handler.ts";
import { ReauthenticatePasswordCommand } from "../../commands/reauthenticate-password/reauthenticate-password.command.ts";
import { ReauthenticatePasswordHandler } from "../../commands/reauthenticate-password/reauthenticate-password.handler.ts";
import { RecordMfaRecoveryCodeAccessCommand } from "../../commands/record-mfa-recovery-code-access/record-mfa-recovery-code-access.command.ts";
import { RecordMfaRecoveryCodeAccessHandler } from "../../commands/record-mfa-recovery-code-access/record-mfa-recovery-code-access.handler.ts";
import { RegisterApprovedPathCommand } from "../../commands/register-approved-path/register-approved-path.command.ts";
import { RegisterApprovedPathHandler } from "../../commands/register-approved-path/register-approved-path.handler.ts";
import { RequestPasswordRecoveryCommand } from "../../commands/request-password-recovery/request-password-recovery.command.ts";
import { RequestPasswordRecoveryHandler } from "../../commands/request-password-recovery/request-password-recovery.handler.ts";
import { RevokeMembershipCommand } from "../../commands/revoke-membership/revoke-membership.command.ts";
import { RevokeMembershipHandler } from "../../commands/revoke-membership/revoke-membership.handler.ts";
import { RevokeOwnedSessionCommand } from "../../commands/revoke-owned-session/revoke-owned-session.command.ts";
import { RevokeOwnedSessionHandler } from "../../commands/revoke-owned-session/revoke-owned-session.handler.ts";
import { RevokeSessionCommand } from "../../commands/revoke-session/revoke-session.command.ts";
import { RevokeSessionHandler } from "../../commands/revoke-session/revoke-session.handler.ts";
import { SignInCommand } from "../../commands/sign-in/sign-in.command.ts";
import { SignInHandler } from "../../commands/sign-in/sign-in.handler.ts";
import { SignUpCommand } from "../../commands/sign-up/sign-up.command.ts";
import { SignUpHandler } from "../../commands/sign-up/sign-up.handler.ts";
import type { UpdateProfilePayload } from "../../commands/update-profile/update-profile.command.ts";
import { UpdateProfileCommand } from "../../commands/update-profile/update-profile.command.ts";
import { UpdateProfileHandler } from "../../commands/update-profile/update-profile.handler.ts";
import { VerifyMfaOtpCommand } from "../../commands/verify-mfa-otp/verify-mfa-otp.command.ts";
import { VerifyMfaOtpHandler } from "../../commands/verify-mfa-otp/verify-mfa-otp.handler.ts";
import { VerifyMfaRecoveryCodeCommand } from "../../commands/verify-mfa-recovery-code/verify-mfa-recovery-code.command.ts";
import { VerifyMfaRecoveryCodeHandler } from "../../commands/verify-mfa-recovery-code/verify-mfa-recovery-code.handler.ts";
import type {
  AcceptInvitationRequest,
  AcceptInvitationResponse,
} from "../../contracts/auth-workspace/accept-invitation.contract.ts";
import type { RequestMeta } from "../../contracts/auth-workspace/common.contract.ts";
import type { DeveloperTaskContextResponse } from "../../contracts/auth-workspace/developer-task-context.contract.ts";
import type {
  InvitationPreviewRequest,
  InvitationPreviewResponse,
} from "../../contracts/auth-workspace/invitation-preview.contract.ts";
import type {
  InviteDeveloperRequest,
  InviteDeveloperResponse,
} from "../../contracts/auth-workspace/invitation.contract.ts";
import type { MfaRecoveryCodeAccessAction } from "../../contracts/auth-workspace/mfa.contract.ts";
import type {
  OAuthCallbackPayload,
  OAuthLinkCallbackPayload,
  OAuthLinkStartPayload,
  OAuthStartPayload,
} from "../../contracts/auth-workspace/oauth.contract.ts";
import type { PasswordReauthPayload } from "../../contracts/auth-workspace/password-reauth.contract.ts";
import type {
  ConfirmRecoveryPayload,
  RequestRecoveryPayload,
} from "../../contracts/auth-workspace/recovery.contract.ts";
import type { RegisterPayload } from "../../contracts/auth-workspace/register-approved-path.contract.ts";
import type { RevokeMembershipResponse } from "../../contracts/auth-workspace/revoke-membership.contract.ts";
import type { CredentialPayload } from "../../contracts/auth-workspace/sign-in.contract.ts";
import type {
  SignUpPayload,
  SignUpResponse,
} from "../../contracts/auth-workspace/sign-up.contract.ts";
import type { WorkspaceRequest } from "../../contracts/auth-workspace/workspace.contract.ts";
import { GetAuthProfileHandler } from "../../queries/get-auth-profile/get-auth-profile.handler.ts";
import { GetAuthProfileQuery } from "../../queries/get-auth-profile/get-auth-profile.query.ts";
import { GetDeveloperTaskContextHandler } from "../../queries/get-developer-task-context/get-developer-task-context.handler.ts";
import { GetDeveloperTaskContextQuery } from "../../queries/get-developer-task-context/get-developer-task-context.query.ts";
import { GetWorkspaceHandler } from "../../queries/get-workspace/get-workspace.handler.ts";
import { GetWorkspaceQuery } from "../../queries/get-workspace/get-workspace.query.ts";
import { ListAuthRepositoriesHandler } from "../../queries/list-auth-repositories/list-auth-repositories.handler.ts";
import { ListAuthRepositoriesQuery } from "../../queries/list-auth-repositories/list-auth-repositories.query.ts";
import { ListAuthSessionsHandler } from "../../queries/list-auth-sessions/list-auth-sessions.handler.ts";
import { ListAuthSessionsQuery } from "../../queries/list-auth-sessions/list-auth-sessions.query.ts";
import { PreviewInvitationHandler } from "../../queries/preview-invitation/preview-invitation.handler.ts";
import { PreviewInvitationQuery } from "../../queries/preview-invitation/preview-invitation.query.ts";

export class AuthWorkspaceFacade {
  constructor(
    private readonly registerApprovedPathHandler: RegisterApprovedPathHandler,
    private readonly signInHandler: SignInHandler,
    private readonly signUpHandler: SignUpHandler,
    private readonly revokeSessionHandler: RevokeSessionHandler,
    private readonly revokeOwnedSessionHandler: RevokeOwnedSessionHandler,
    private readonly getAuthProfileHandler: GetAuthProfileHandler,
    private readonly listAuthSessionsHandler: ListAuthSessionsHandler,
    private readonly listAuthRepositoriesHandler: ListAuthRepositoriesHandler,
    private readonly getWorkspaceHandler: GetWorkspaceHandler,
    private readonly disableMfaHandler: DisableMfaHandler,
    private readonly enrollMfaHandler: EnrollMfaHandler,
    private readonly verifyMfaOtpHandler: VerifyMfaOtpHandler,
    private readonly verifyMfaRecoveryCodeHandler: VerifyMfaRecoveryCodeHandler,
    private readonly generateMfaRecoveryCodesHandler: GenerateMfaRecoveryCodesHandler,
    private readonly recordMfaRecoveryCodeAccessHandler: RecordMfaRecoveryCodeAccessHandler,
    private readonly updateProfileHandler: UpdateProfileHandler,
    private readonly requestPasswordRecoveryHandler: RequestPasswordRecoveryHandler,
    private readonly confirmPasswordRecoveryHandler: ConfirmPasswordRecoveryHandler,
    private readonly reauthenticatePasswordHandler: ReauthenticatePasswordHandler,
    private readonly oauthStartHandler: OAuthStartHandler,
    private readonly oauthCallbackHandler: OAuthCallbackHandler,
    private readonly oauthLinkStartHandler: OAuthLinkStartHandler,
    private readonly oauthLinkCallbackHandler: OAuthLinkCallbackHandler,
    private readonly inviteDeveloperHandler: InviteDeveloperHandler,
    private readonly acceptInvitationHandler: AcceptInvitationHandler,
    private readonly previewInvitationHandler: PreviewInvitationHandler,
    private readonly revokeMembershipHandler: RevokeMembershipHandler,
    private readonly getDeveloperTaskContextHandler: GetDeveloperTaskContextHandler,
  ) {}

  registerApprovedPath(
    payload: RegisterPayload,
    requestMeta: RequestMeta = {},
  ) {
    return this.registerApprovedPathHandler.execute(
      new RegisterApprovedPathCommand(payload, requestMeta),
    );
  }

  signIn(payload: CredentialPayload, requestMeta: RequestMeta = {}) {
    return this.signInHandler.execute(new SignInCommand(payload, requestMeta));
  }

  signUp(
    payload: SignUpPayload,
    requestMeta: RequestMeta = {},
  ): Promise<SignUpResponse> {
    return this.signUpHandler.execute(
      new SignUpCommand({
        email: payload.email,
        displayName: payload.display_name,
        organizationName: payload.organization_name,
        password: payload.password,
        correlationId: requestMeta.correlationId,
      }),
    );
  }

  revokeSession(sessionToken: string, requestMeta: RequestMeta = {}) {
    return this.revokeSessionHandler.execute(
      new RevokeSessionCommand(sessionToken, requestMeta),
    );
  }

  revokeOwnedSession(
    sessionId: string,
    context: PbacRequestContext,
    requestMeta: RequestMeta = {},
  ) {
    return this.revokeOwnedSessionHandler.execute(
      new RevokeOwnedSessionCommand(sessionId, context, requestMeta),
    );
  }

  getProfile(context: PbacRequestContext, correlationId: string) {
    return this.getAuthProfileHandler.execute(
      new GetAuthProfileQuery(context, correlationId),
    );
  }

  listSessions(context: PbacRequestContext) {
    return this.listAuthSessionsHandler.execute(
      new ListAuthSessionsQuery(context),
    );
  }

  listRepositories(context: PbacRequestContext) {
    return this.listAuthRepositoriesHandler.execute(
      new ListAuthRepositoriesQuery(context),
    );
  }

  disableMfa(sessionToken: string, requestMeta: RequestMeta = {}) {
    return this.disableMfaHandler.execute(
      new DisableMfaCommand(sessionToken, requestMeta),
    );
  }

  getWorkspace(request: WorkspaceRequest = {}) {
    return this.getWorkspaceHandler.execute(new GetWorkspaceQuery(request));
  }

  getDeveloperTaskContext(
    context: PbacRequestContext,
    correlationId: string,
  ): Promise<DeveloperTaskContextResponse> {
    return this.getDeveloperTaskContextHandler.execute(
      new GetDeveloperTaskContextQuery(context, correlationId),
    );
  }

  enrollMfa(sessionToken: string, requestMeta: RequestMeta = {}) {
    return this.enrollMfaHandler.execute(
      new EnrollMfaCommand(sessionToken, requestMeta),
    );
  }

  verifyMfaOtp(
    sessionToken: string,
    otp: string,
    requestMeta: RequestMeta = {},
  ) {
    return this.verifyMfaOtpHandler.execute(
      new VerifyMfaOtpCommand(sessionToken, otp, requestMeta),
    );
  }

  verifyMfaRecoveryCode(
    sessionToken: string,
    code: string,
    requestMeta: RequestMeta = {},
  ) {
    return this.verifyMfaRecoveryCodeHandler.execute(
      new VerifyMfaRecoveryCodeCommand(sessionToken, code, requestMeta),
    );
  }

  generateMfaRecoveryCodes(
    sessionToken: string,
    requestMeta: RequestMeta = {},
  ) {
    return this.generateMfaRecoveryCodesHandler.execute(
      new GenerateMfaRecoveryCodesCommand(sessionToken, requestMeta),
    );
  }

  recordMfaRecoveryCodeAccess(
    sessionToken: string,
    action: MfaRecoveryCodeAccessAction,
    requestMeta: RequestMeta = {},
  ) {
    return this.recordMfaRecoveryCodeAccessHandler.execute(
      new RecordMfaRecoveryCodeAccessCommand(sessionToken, action, requestMeta),
    );
  }

  updateProfile(
    sessionToken: string,
    payload: UpdateProfilePayload,
    requestMeta: RequestMeta = {},
  ) {
    return this.updateProfileHandler.execute(
      new UpdateProfileCommand(
        { ...payload, session_token: sessionToken },
        requestMeta,
      ),
    );
  }

  requestPasswordRecovery(
    payload: RequestRecoveryPayload,
    requestMeta: RequestMeta = {},
  ) {
    return this.requestPasswordRecoveryHandler.execute(
      new RequestPasswordRecoveryCommand(payload, requestMeta),
    );
  }

  confirmPasswordRecovery(
    payload: ConfirmRecoveryPayload,
    requestMeta: RequestMeta = {},
  ) {
    return this.confirmPasswordRecoveryHandler.execute(
      new ConfirmPasswordRecoveryCommand(payload, requestMeta),
    );
  }

  reauthenticatePassword(
    payload: PasswordReauthPayload,
    requestMeta: RequestMeta = {},
  ) {
    return this.reauthenticatePasswordHandler.execute(
      new ReauthenticatePasswordCommand(payload, requestMeta),
    );
  }

  oauthStart(payload: OAuthStartPayload, requestMeta: RequestMeta = {}) {
    return this.oauthStartHandler.execute(
      new OAuthStartCommand(payload, requestMeta),
    );
  }

  oauthCallback(payload: OAuthCallbackPayload, requestMeta: RequestMeta = {}) {
    return this.oauthCallbackHandler.execute(
      new OAuthCallbackCommand(payload, requestMeta),
    );
  }

  oauthLinkStart(
    payload: OAuthLinkStartPayload,
    context: PbacRequestContext,
    requestMeta: RequestMeta = {},
  ) {
    return this.oauthLinkStartHandler.execute(
      new OAuthLinkStartCommand(
        payload,
        context.userId,
        context.sessionId,
        requestMeta,
      ),
    );
  }

  oauthLinkCallback(
    payload: OAuthLinkCallbackPayload,
    context: PbacRequestContext,
    requestMeta: RequestMeta = {},
  ) {
    return this.oauthLinkCallbackHandler.execute(
      new OAuthLinkCallbackCommand(
        payload,
        context.userId,
        context.sessionId,
        context.organizationId,
        requestMeta,
      ),
    );
  }

  inviteDeveloper(
    orgId: string,
    actorId: string,
    payload: InviteDeveloperRequest,
    requestMeta: RequestMeta = {},
  ): Promise<InviteDeveloperResponse> {
    return this.inviteDeveloperHandler.execute(
      new InviteDeveloperCommand({
        orgId,
        actorId,
        email: payload.email,
        assessmentId: payload.assessment_id,
        allowedActions: payload.allowed_actions,
        expiresInHours: payload.expires_in_hours,
        correlationId: requestMeta.correlationId,
      }),
    );
  }

  acceptInvitation(
    payload: AcceptInvitationRequest,
    requestMeta: RequestMeta = {},
  ): Promise<AcceptInvitationResponse> {
    return this.acceptInvitationHandler.execute(
      new AcceptInvitationCommand({
        invitationToken: payload.invitation_token,
        displayName: payload.display_name,
        password: payload.password,
        correlationId: requestMeta.correlationId,
      }),
    );
  }

  previewInvitation(
    payload: InvitationPreviewRequest,
    requestMeta: RequestMeta = {},
  ): Promise<InvitationPreviewResponse> {
    return this.previewInvitationHandler.execute(
      new PreviewInvitationQuery(
        payload?.invitation_token,
        requestMeta.correlationId,
      ),
    );
  }

  revokeMembership(
    orgId: string,
    actorId: string,
    targetUserId: string,
    requestMeta: RequestMeta = {},
  ): Promise<RevokeMembershipResponse> {
    return this.revokeMembershipHandler.execute(
      new RevokeMembershipCommand({
        orgId,
        actorId,
        targetUserId,
        correlationId: requestMeta.correlationId,
      }),
    );
  }
}
