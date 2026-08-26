import type { RbacRequestContext } from "../../../../../platform/rbac/interfaces/rbac-request.interface.ts";
import { ConfirmPasswordRecoveryCommand } from "../../commands/confirm-password-recovery/confirm-password-recovery.command.ts";
import { ConfirmPasswordRecoveryHandler } from "../../commands/confirm-password-recovery/confirm-password-recovery.handler.ts";
import { DisableMfaCommand } from "../../commands/disable-mfa/disable-mfa.command.ts";
import { DisableMfaHandler } from "../../commands/disable-mfa/disable-mfa.handler.ts";
import { EnrollMfaCommand } from "../../commands/enroll-mfa/enroll-mfa.command.ts";
import { EnrollMfaHandler } from "../../commands/enroll-mfa/enroll-mfa.handler.ts";
import { GenerateMfaRecoveryCodesCommand } from "../../commands/generate-mfa-recovery-codes/generate-mfa-recovery-codes.command.ts";
import { GenerateMfaRecoveryCodesHandler } from "../../commands/generate-mfa-recovery-codes/generate-mfa-recovery-codes.handler.ts";
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
import { RequestPasswordRecoveryCommand } from "../../commands/request-password-recovery/request-password-recovery.command.ts";
import { RequestPasswordRecoveryHandler } from "../../commands/request-password-recovery/request-password-recovery.handler.ts";
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
import type { RequestMeta } from "../../contracts/auth-workspace/common.contract.ts";
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
import type { CredentialPayload } from "../../contracts/auth-workspace/sign-in.contract.ts";
import type {
  SignUpPayload,
  SignUpResponse,
} from "../../contracts/auth-workspace/sign-up.contract.ts";
import type { WorkspaceRequest } from "../../contracts/auth-workspace/workspace.contract.ts";
import { GetAuthProfileHandler } from "../../queries/get-auth-profile/get-auth-profile.handler.ts";
import { GetAuthProfileQuery } from "../../queries/get-auth-profile/get-auth-profile.query.ts";
import { GetWorkspaceHandler } from "../../queries/get-workspace/get-workspace.handler.ts";
import { GetWorkspaceQuery } from "../../queries/get-workspace/get-workspace.query.ts";
import { ListAuthRepositoriesHandler } from "../../queries/list-auth-repositories/list-auth-repositories.handler.ts";
import { ListAuthRepositoriesQuery } from "../../queries/list-auth-repositories/list-auth-repositories.query.ts";
import { ListAuthSessionsHandler } from "../../queries/list-auth-sessions/list-auth-sessions.handler.ts";
import { ListAuthSessionsQuery } from "../../queries/list-auth-sessions/list-auth-sessions.query.ts";

export class AuthWorkspaceFacade {
  constructor(
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
  ) {}

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
    context: RbacRequestContext,
    requestMeta: RequestMeta = {},
  ) {
    return this.revokeOwnedSessionHandler.execute(
      new RevokeOwnedSessionCommand(sessionId, context, requestMeta),
    );
  }

  getProfile(context: RbacRequestContext, correlationId: string) {
    return this.getAuthProfileHandler.execute(
      new GetAuthProfileQuery(context, correlationId),
    );
  }

  listSessions(context: RbacRequestContext) {
    return this.listAuthSessionsHandler.execute(
      new ListAuthSessionsQuery(context),
    );
  }

  listRepositories(context: RbacRequestContext) {
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
    context: RbacRequestContext,
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
    context: RbacRequestContext,
    requestMeta: RequestMeta = {},
  ) {
    return this.oauthLinkCallbackHandler.execute(
      new OAuthLinkCallbackCommand(
        payload,
        context.userId,
        context.sessionId,
        requestMeta,
      ),
    );
  }
}
