import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";

import {
  AUTH_ERROR_CODES,
  MFA_RECOVERY_CODE_ACCESS_ACTIONS,
  type MfaRecoveryCodeAccessAction,
} from "@lcsp/contracts/auth";
import {
  DEVELOPER_ALLOWED_ACTION_VALUES,
  PBAC_ACTIONS,
  SUBJECT_ROLES,
} from "@lcsp/contracts/pbac";

import { REVOKE_MEMBERSHIP_ERROR_CODES } from "@lcsp/contracts/auth";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AllowPendingMfa } from "../../../../platform/pbac/decorators/allow-pending-mfa.decorator.js";
import { RequireAction } from "../../../../platform/pbac/decorators/require-action.decorator.js";
import { RequireAnyActionAsPbac } from "../../../../platform/pbac/decorators/require-any-action-as-pbac.decorator.js";
import { RequireSession } from "../../../../platform/pbac/decorators/require-session.decorator.js";
import { PbacGuard } from "../../../../platform/pbac/pbac.guard.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { ReAuthForSensitiveRoute } from "../../../../platform/security/decorators/re-auth-for-sensitive-route.decorator.js";
import { SENSITIVE_ROUTE_IDS } from "../../../../platform/security/sensitive-route-policy.js";
import type { UpdateProfilePayload } from "../../application/commands/update-profile/update-profile.command.ts";
import type { AcceptInvitationRequest } from "../../application/contracts/auth-workspace/accept-invitation.contract.ts";
import type { RequestMeta } from "../../application/contracts/auth-workspace/common.contract.ts";
import type { InvitationPreviewRequest } from "../../application/contracts/auth-workspace/invitation-preview.contract.ts";
import type { InviteDeveloperRequest } from "../../application/contracts/auth-workspace/invitation.contract.ts";
import type {
  OAuthCallbackPayload,
  OAuthLinkCallbackPayload,
  OAuthLinkStartPayload,
  OAuthStartPayload,
} from "../../application/contracts/auth-workspace/oauth.contract.ts";
import type { PasswordReauthPayload } from "../../application/contracts/auth-workspace/password-reauth.contract.ts";
import type {
  ConfirmRecoveryPayload,
  RequestRecoveryPayload,
} from "../../application/contracts/auth-workspace/recovery.contract.ts";
import type { RegisterPayload } from "../../application/contracts/auth-workspace/register-approved-path.contract.ts";
import type { SensitiveRouteCheckDto } from "../../application/contracts/auth-workspace/sensitive-route.contract.ts";
import type { CredentialPayload } from "../../application/contracts/auth-workspace/sign-in.contract.ts";
import type { SignUpPayload } from "../../application/contracts/auth-workspace/sign-up.contract.ts";
import type { WorkspaceRequest } from "../../application/contracts/auth-workspace/workspace.contract.ts";
import { CheckSensitiveRouteQuery } from "../../application/queries/check-sensitive-route/check-sensitive-route.query.ts";
import { AuthWorkspaceFacade } from "../../application/services/auth-workspace/auth-workspace.facade.ts";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";

type SensitiveRouteCheckPayload = {
  method?: unknown;
  path?: unknown;
  route?: unknown;
};

type MfaRecoveryCodeAccessPayload = {
  action?: unknown;
  session_token?: string;
};

const MFA_RECOVERY_CODE_ACCESS_ACTION_VALUES = Object.values(
  MFA_RECOVERY_CODE_ACCESS_ACTIONS,
);

@Controller()
export class AuthWorkspaceController {
  constructor(
    private readonly authWorkspaceFacade: AuthWorkspaceFacade,
    private readonly prisma: PrismaService,
    private readonly queryBus: QueryBus,
  ) {}

  @Get("workspace/developers")
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.inviteDeveloper)
  async listWorkspaceDevelopers(@Req() request: AuthenticatedRequest) {
    const orgId = request.pbacContext.organizationId;
    const memberships = await this.prisma.authMembership.findMany({
      where: {
        organizationId: orgId,
        policy: { subjectRole: SUBJECT_ROLES.developer },
      },
      include: {
        user: { select: { id: true, email: true, displayName: true } },
        policy: { select: { actions: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return resultEnvelope(
      memberships.map((membership) => ({
        user_id: membership.user.id,
        email: membership.user.email,
        display_name: membership.user.displayName,
        status: membership.status,
        allowed_actions: membership.policy.actions,
        subject_attributes: membership.subjectAttributes,
        revoked_at: membership.revokedAt,
      })),
    );
  }

  @Post("workspace/invitations")
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.inviteDeveloper)
  async inviteWorkspaceDeveloper(
    @Body() payload: InviteDeveloperRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    const pbacContext = request.pbacContext;
    return resultEnvelope(
      await this.authWorkspaceFacade.inviteDeveloper(
        pbacContext.organizationId,
        pbacContext.userId,
        payload,
        requestMeta(request.correlationId),
      ),
    );
  }

  @Delete("workspace/memberships/:userId")
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.membershipRevoke)
  async revokeWorkspaceMembership(
    @Param("userId") userId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const pbacContext = request.pbacContext;
    return resultEnvelope(
      await this.authWorkspaceFacade.revokeMembership(
        pbacContext.organizationId,
        pbacContext.userId,
        userId,
        requestMeta(request.correlationId),
      ),
    );
  }

  @Get("organizations/:orgId/developers")
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.inviteDeveloper)
  async listDevelopers(
    @Param("orgId") orgId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    if (request.pbacContext.organizationId !== orgId) {
      throw problemException(
        AUTH_ERROR_CODES.pbacDenied,
        request.correlationId as string,
        { status: HttpStatus.FORBIDDEN },
      );
    }
    const memberships = await this.prisma.authMembership.findMany({
      where: {
        organizationId: orgId,
        policy: { subjectRole: SUBJECT_ROLES.developer },
      },
      include: {
        user: { select: { id: true, email: true, displayName: true } },
        policy: { select: { actions: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return resultEnvelope(
      memberships.map((membership) => ({
        user_id: membership.user.id,
        email: membership.user.email,
        display_name: membership.user.displayName,
        status: membership.status,
        allowed_actions: membership.policy.actions,
        subject_attributes: membership.subjectAttributes,
        revoked_at: membership.revokedAt,
      })),
    );
  }

  @Post("organizations/:orgId/invitations")
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.inviteDeveloper)
  async inviteDeveloper(
    @Param("orgId") orgId: string,
    @Body() payload: InviteDeveloperRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    const pbacContext = request.pbacContext;
    if (pbacContext.organizationId !== orgId) {
      throw problemException(
        AUTH_ERROR_CODES.pbacDenied,
        request.correlationId as string,
        { status: HttpStatus.FORBIDDEN },
      );
    }

    return resultEnvelope(
      await this.authWorkspaceFacade.inviteDeveloper(
        orgId,
        pbacContext.userId,
        payload,
        requestMeta(request.correlationId),
      ),
    );
  }

  @Delete("organizations/:orgId/memberships/:userId")
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.membershipRevoke)
  async revokeMembership(
    @Param("orgId") orgId: string,
    @Param("userId") userId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const pbacContext = request.pbacContext;
    if (pbacContext.organizationId !== orgId) {
      const errorCode = REVOKE_MEMBERSHIP_ERROR_CODES.organizationScopeMismatch;
      throw problemException(errorCode, request.correlationId as string, {
        status: HttpStatus.BAD_REQUEST,
      });
    }

    return resultEnvelope(
      await this.authWorkspaceFacade.revokeMembership(
        orgId,
        pbacContext.userId,
        userId,
        requestMeta(request.correlationId),
      ),
    );
  }

  @Post("auth/register-approved-path")
  async registerApprovedPath(
    @Body() payload: RegisterPayload,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return resultEnvelope(
      await this.authWorkspaceFacade.registerApprovedPath(
        payload,
        requestMeta(correlationId),
      ),
    );
  }

  @Post("auth/accept-invitation")
  async acceptInvitation(
    @Body() payload: AcceptInvitationRequest,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return resultEnvelope(
      await this.authWorkspaceFacade.acceptInvitation(
        payload,
        requestMeta(correlationId),
      ),
    );
  }

  @Post("auth/invitations/preview")
  @HttpCode(HttpStatus.OK)
  async previewInvitation(
    @Body() payload: InvitationPreviewRequest,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return resultEnvelope(
      await this.authWorkspaceFacade.previewInvitation(
        payload,
        requestMeta(correlationId),
      ),
    );
  }

  @Post("auth/sign-in")
  @HttpCode(HttpStatus.OK)
  async signIn(
    @Body() payload: CredentialPayload,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return resultEnvelope(
      await this.authWorkspaceFacade.signIn(
        payload,
        requestMeta(correlationId),
      ),
    );
  }

  @Post("auth/sign-up")
  async signUp(
    @Body() payload: SignUpPayload,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return resultEnvelope(
      await this.authWorkspaceFacade.signUp(
        payload,
        requestMeta(correlationId),
      ),
    );
  }

  @Post("auth/revoke-session")
  async revokeSession(
    @Body() body: { session_token?: string },
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return resultEnvelope(
      await this.authWorkspaceFacade.revokeSession(
        body.session_token ?? "",
        requestMeta(correlationId),
      ),
    );
  }

  @Get("workspace")
  @UseGuards(PbacGuard)
  @RequireSession()
  async getWorkspace(
    @Req() request: AuthenticatedRequest,
    @Query("organization_id") organizationId?: string,
    @Headers("authorization") authorization?: string,
  ) {
    const workspaceRequest: WorkspaceRequest = {
      organization_id: organizationId,
      session_token: bearerToken(authorization),
      correlationId: request.correlationId,
    };
    return resultEnvelope(
      await this.authWorkspaceFacade.getWorkspace(workspaceRequest),
    );
  }

  @Get("workspace/developer-task")
  @UseGuards(PbacGuard)
  @RequireAnyActionAsPbac(...DEVELOPER_ALLOWED_ACTION_VALUES)
  async getDeveloperTaskContext(@Req() request: AuthenticatedRequest) {
    return resultEnvelope(
      await this.authWorkspaceFacade.getDeveloperTaskContext(
        request.pbacContext,
        request.correlationId!,
      ),
    );
  }

  @Post("auth/mfa/enroll")
  @UseGuards(PbacGuard)
  @RequireSession()
  @AllowPendingMfa()
  async enrollMfa(
    @Body() body: { session_token?: string },
    @Headers("authorization") authorization: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.authWorkspaceFacade.enrollMfa(
        bearerToken(authorization) ?? body.session_token ?? "",
        requestMeta(request.correlationId),
      ),
    );
  }

  @Delete("auth/mfa")
  @UseGuards(PbacGuard)
  @RequireSession()
  async disableMfa(
    @Body() body: { session_token?: string },
    @Headers("authorization") authorization: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.authWorkspaceFacade.disableMfa(
        bearerToken(authorization) ?? body.session_token ?? "",
        requestMeta(request.correlationId),
      ),
    );
  }

  @Post("auth/mfa/verify-otp")
  async verifyMfaOtp(
    @Body() body: { session_token?: string; otp?: string },
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return resultEnvelope(
      await this.authWorkspaceFacade.verifyMfaOtp(
        body.session_token ?? "",
        body.otp ?? "",
        requestMeta(correlationId),
      ),
    );
  }

  @Post("auth/mfa/recovery-code/verify")
  async verifyMfaRecoveryCode(
    @Body() body: { session_token?: string; code?: string },
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return resultEnvelope(
      await this.authWorkspaceFacade.verifyMfaRecoveryCode(
        body.session_token ?? "",
        body.code ?? "",
        requestMeta(correlationId),
      ),
    );
  }

  @Post("auth/mfa/recovery-codes")
  @UseGuards(PbacGuard)
  @RequireSession()
  @ReAuthForSensitiveRoute({
    routeId: SENSITIVE_ROUTE_IDS.mfaRecoveryCodesGenerate,
    method: "POST",
    pathTemplate: "/auth/mfa/recovery-codes",
    aliases: [{ method: "POST", pathTemplate: "/api/auth/mfa/recovery-codes" }],
  })
  async generateMfaRecoveryCodes(
    @Body() body: { session_token?: string },
    @Headers("authorization") authorization: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.authWorkspaceFacade.generateMfaRecoveryCodes(
        bearerToken(authorization) ?? body.session_token ?? "",
        requestMeta(request.correlationId),
      ),
    );
  }

  @Post("auth/mfa/recovery-codes/access")
  @UseGuards(PbacGuard)
  @RequireSession()
  async recordMfaRecoveryCodeAccess(
    @Body() body: MfaRecoveryCodeAccessPayload,
    @Headers("authorization") authorization: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const action =
      typeof body.action === "string" &&
      MFA_RECOVERY_CODE_ACCESS_ACTION_VALUES.includes(
        body.action as MfaRecoveryCodeAccessAction,
      )
        ? (body.action as MfaRecoveryCodeAccessAction)
        : null;

    if (!action) {
      throw problemException(
        AUTH_ERROR_CODES.validationFailed,
        request.correlationId!,
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    return resultEnvelope(
      await this.authWorkspaceFacade.recordMfaRecoveryCodeAccess(
        bearerToken(authorization) ?? body.session_token ?? "",
        action,
        requestMeta(request.correlationId),
      ),
    );
  }

  @Post("auth/re-auth/password")
  @UseGuards(PbacGuard)
  @RequireSession()
  @AllowPendingMfa()
  async reauthenticatePassword(
    @Body() body: PasswordReauthPayload,
    @Headers("authorization") authorization: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.authWorkspaceFacade.reauthenticatePassword(
        {
          session_token: bearerToken(authorization) ?? body.session_token ?? "",
          password: body.password,
        },
        requestMeta(request.correlationId),
      ),
    );
  }

  @Post("auth/sensitive-route/check")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PbacGuard)
  @RequireSession()
  @AllowPendingMfa()
  async checkSensitiveRoute(
    @Body() body: SensitiveRouteCheckPayload,
    @Req() request: AuthenticatedRequest,
  ) {
    const method = typeof body.method === "string" ? body.method : "";
    const route =
      typeof body.path === "string"
        ? body.path
        : typeof body.route === "string"
          ? body.route
          : "";

    if (method.trim().length === 0 || route.trim().length === 0) {
      throw problemException(
        AUTH_ERROR_CODES.validationFailed,
        request.correlationId!,
        { status: HttpStatus.BAD_REQUEST },
      );
    }

    return resultEnvelope(
      await this.queryBus.execute<
        CheckSensitiveRouteQuery,
        SensitiveRouteCheckDto
      >(
        new CheckSensitiveRouteQuery(
          request.pbacContext.sessionId,
          method,
          route,
        ),
      ),
    );
  }

  @Patch("auth/profile")
  @UseGuards(PbacGuard)
  @RequireSession()
  async updateProfile(
    @Body() body: UpdateProfilePayload & { session_token?: string },
    @Headers("authorization") authorization: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const { session_token, ...payload } = body;
    return resultEnvelope(
      await this.authWorkspaceFacade.updateProfile(
        bearerToken(authorization) ?? session_token ?? "",
        payload,
        requestMeta(request.correlationId),
      ),
    );
  }

  @Get("auth/profile")
  @UseGuards(PbacGuard)
  @RequireSession()
  async getProfile(@Req() request: AuthenticatedRequest) {
    return resultEnvelope(
      await this.authWorkspaceFacade.getProfile(
        request.pbacContext,
        request.correlationId!,
      ),
    );
  }

  @Get("auth/sessions")
  @UseGuards(PbacGuard)
  @RequireSession()
  async listSessions(@Req() request: AuthenticatedRequest) {
    return resultEnvelope(
      await this.authWorkspaceFacade.listSessions(request.pbacContext),
    );
  }

  @Delete("auth/sessions/:sessionId")
  @UseGuards(PbacGuard)
  @RequireSession()
  async revokeOwnedSession(
    @Param("sessionId") sessionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.authWorkspaceFacade.revokeOwnedSession(
        sessionId,
        request.pbacContext,
        requestMeta(request.correlationId),
      ),
    );
  }

  @Get("auth/repositories")
  @UseGuards(PbacGuard)
  @RequireSession()
  async listRepositories(@Req() request: AuthenticatedRequest) {
    return resultEnvelope(
      await this.authWorkspaceFacade.listRepositories(request.pbacContext),
    );
  }

  @Post("auth/recovery/request")
  async requestPasswordRecovery(
    @Body() payload: RequestRecoveryPayload,
    @Headers("x-correlation-id") correlationId?: string,
    @Headers("x-app-origin") appOrigin?: string,
  ) {
    return resultEnvelope(
      await this.authWorkspaceFacade.requestPasswordRecovery(
        payload,
        requestMeta(correlationId, appOrigin),
      ),
    );
  }

  @Post("auth/recovery/confirm")
  async confirmPasswordRecovery(
    @Body() payload: ConfirmRecoveryPayload,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return resultEnvelope(
      await this.authWorkspaceFacade.confirmPasswordRecovery(
        payload,
        requestMeta(correlationId),
      ),
    );
  }

  @Get("auth/oauth/start")
  async oauthStart(
    @Query("provider") provider?: string,
    @Query("redirect_uri") redirectUri?: string,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    const payload: OAuthStartPayload = {
      provider,
      redirect_uri: redirectUri,
    };
    return resultEnvelope(
      await this.authWorkspaceFacade.oauthStart(
        payload,
        requestMeta(correlationId),
      ),
    );
  }

  @Get("auth/oauth/callback")
  async oauthCallback(
    @Query("code") code?: string,
    @Query("state") state?: string,
    @Query("provider") provider?: string,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    const payload: OAuthCallbackPayload = { code, state, provider };
    return resultEnvelope(
      await this.authWorkspaceFacade.oauthCallback(
        payload,
        requestMeta(correlationId),
      ),
    );
  }

  @Get("auth/oauth/link/start")
  @UseGuards(PbacGuard)
  @RequireSession()
  async oauthLinkStart(
    @Req() request: AuthenticatedRequest,
    @Query("provider") provider?: string,
    @Query("redirect_uri") redirectUri?: string,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    const payload: OAuthLinkStartPayload = {
      provider,
      redirect_uri: redirectUri,
    };
    return resultEnvelope(
      await this.authWorkspaceFacade.oauthLinkStart(
        payload,
        request.pbacContext,
        requestMeta(correlationId),
      ),
    );
  }

  @Get("auth/oauth/link/callback")
  @UseGuards(PbacGuard)
  @RequireSession()
  async oauthLinkCallback(
    @Req() request: AuthenticatedRequest,
    @Query("code") code?: string,
    @Query("state") state?: string,
    @Query("provider") provider?: string,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    const payload: OAuthLinkCallbackPayload = { code, state, provider };
    return resultEnvelope(
      await this.authWorkspaceFacade.oauthLinkCallback(
        payload,
        request.pbacContext,
        requestMeta(correlationId),
      ),
    );
  }
}

function requestMeta(correlationId?: string, appOrigin?: string): RequestMeta {
  return {
    ...(correlationId ? { correlationId: correlationId } : {}),
    ...(appOrigin ? { app_origin: appOrigin } : {}),
  };
}

function bearerToken(authorization?: string): string | undefined {
  if (!authorization) {
    return undefined;
  }
  const [scheme, token] = authorization.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : undefined;
}
