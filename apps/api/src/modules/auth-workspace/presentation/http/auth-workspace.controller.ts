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

import { AllowPendingMfa } from "../../../../platform/rbac/decorators/allow-pending-mfa.decorator.js";
import { RequireSession } from "../../../../platform/rbac/decorators/require-session.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { ReAuthForSensitiveRoute } from "../../../../platform/security/decorators/re-auth-for-sensitive-route.decorator.js";
import { SENSITIVE_ROUTE_IDS } from "../../../../platform/security/sensitive-route-policy.js";
import type { UpdateProfilePayload } from "../../application/commands/update-profile/update-profile.command.ts";
import type { RequestMeta } from "../../application/contracts/auth-workspace/common.contract.ts";
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
    private readonly queryBus: QueryBus,
  ) {}

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
  @UseGuards(RbacGuard)
  @RequireSession()
  async getWorkspace(
    @Req() request: AuthenticatedRequest,
    @Headers("authorization") authorization?: string,
  ) {
    const workspaceRequest: WorkspaceRequest = {
      session_token: bearerToken(authorization),
      correlationId: request.correlationId,
    };
    return resultEnvelope(
      await this.authWorkspaceFacade.getWorkspace(workspaceRequest),
    );
  }

  @Post("auth/mfa/enroll")
  @UseGuards(RbacGuard)
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
  @UseGuards(RbacGuard)
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
  @UseGuards(RbacGuard)
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
  @UseGuards(RbacGuard)
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
  @UseGuards(RbacGuard)
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
  @UseGuards(RbacGuard)
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
          request.rbacContext.sessionId,
          method,
          route,
        ),
      ),
    );
  }

  @Patch("auth/profile")
  @UseGuards(RbacGuard)
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
  @UseGuards(RbacGuard)
  @RequireSession()
  async getProfile(@Req() request: AuthenticatedRequest) {
    return resultEnvelope(
      await this.authWorkspaceFacade.getProfile(
        request.rbacContext,
        request.correlationId!,
      ),
    );
  }

  @Get("auth/sessions")
  @UseGuards(RbacGuard)
  @RequireSession()
  async listSessions(@Req() request: AuthenticatedRequest) {
    return resultEnvelope(
      await this.authWorkspaceFacade.listSessions(request.rbacContext),
    );
  }

  @Delete("auth/sessions/:sessionId")
  @UseGuards(RbacGuard)
  @RequireSession()
  async revokeOwnedSession(
    @Param("sessionId") sessionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.authWorkspaceFacade.revokeOwnedSession(
        sessionId,
        request.rbacContext,
        requestMeta(request.correlationId),
      ),
    );
  }

  @Get("auth/repositories")
  @UseGuards(RbacGuard)
  @RequireSession()
  async listRepositories(@Req() request: AuthenticatedRequest) {
    return resultEnvelope(
      await this.authWorkspaceFacade.listRepositories(request.rbacContext),
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
  @UseGuards(RbacGuard)
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
        request.rbacContext,
        requestMeta(correlationId),
      ),
    );
  }

  @Get("auth/oauth/link/callback")
  @UseGuards(RbacGuard)
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
        request.rbacContext,
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
