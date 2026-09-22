import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";

import {
  checkSensitiveRouteSchema,
  confirmPasswordRecoverySchema,
  passwordReauthSchema,
  requestPasswordRecoverySchema,
  type CheckSensitiveRouteInput,
  type ConfirmPasswordRecoveryInput,
  type PasswordReauthInput,
  type RequestPasswordRecoveryInput,
} from "@lcsp/contracts/auth";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.ts";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.ts";
import { AllowPendingMfa } from "../../../../platform/rbac/decorators/allow-pending-mfa.decorator.ts";
import { RequireSession } from "../../../../platform/rbac/decorators/require-session.decorator.ts";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.ts";
import {
  ConfirmPasswordRecoveryCommand,
  ReauthenticatePasswordCommand,
  RequestPasswordRecoveryCommand,
} from "../../application/commands/index.ts";
import type {
  ConfirmRecoverySuccess,
  PasswordReauthSuccess,
  RequestRecoverySuccess,
  SensitiveRouteCheckDto,
} from "../../application/contracts/auth/index.ts";
import { CheckSensitiveRouteQuery } from "../../application/queries/index.ts";

/**
 * Controller exposing password recovery, sensitive route step-up verification, and password re-authentication endpoints.
 */
@Controller("auth")
export class AuthRecoveryController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  /**
   * Guarded password re-authentication endpoint for sensitive operations.
   */
  @Post("re-auth/password")
  @UseGuards(RbacGuard)
  @RequireSession()
  @AllowPendingMfa()
  async reauthenticatePassword(
    @Body(new ZodValidationPipe(passwordReauthSchema))
    body: PasswordReauthInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<PasswordReauthSuccess> {
    return this.commandBus.execute<
      ReauthenticatePasswordCommand,
      PasswordReauthSuccess
    >(
      new ReauthenticatePasswordCommand(
        body.password,
        request.rbacContext.userId,
        request.rbacContext.sessionId,
        { correlationId: request.correlationId },
      ),
    );
  }

  /**
   * Guarded check endpoint to determine if sensitive action requires re-authentication.
   */
  @Post("sensitive-route/check")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RbacGuard)
  @RequireSession()
  @AllowPendingMfa()
  async checkSensitiveRoute(
    @Body(new ZodValidationPipe(checkSensitiveRouteSchema))
    body: CheckSensitiveRouteInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<SensitiveRouteCheckDto> {
    const route = body.path ?? body.route ?? "";
    return this.queryBus.execute<
      CheckSensitiveRouteQuery,
      SensitiveRouteCheckDto
    >(
      new CheckSensitiveRouteQuery(
        request.rbacContext.sessionId,
        body.method,
        route,
      ),
    );
  }

  /**
   * Public password recovery request endpoint.
   */
  @Post("recovery/request")
  async requestPasswordRecovery(
    @Body(new ZodValidationPipe(requestPasswordRecoverySchema))
    payload: RequestPasswordRecoveryInput,
    @Headers("x-correlation-id") correlationId?: string,
    @Headers("x-app-origin") appOrigin?: string,
  ): Promise<RequestRecoverySuccess> {
    return this.commandBus.execute<
      RequestPasswordRecoveryCommand,
      RequestRecoverySuccess
    >(
      new RequestPasswordRecoveryCommand(payload, {
        correlationId,
        app_origin: appOrigin,
      }),
    );
  }

  /**
   * Public password recovery confirmation endpoint.
   */
  @Post("recovery/confirm")
  async confirmPasswordRecovery(
    @Body(new ZodValidationPipe(confirmPasswordRecoverySchema))
    payload: ConfirmPasswordRecoveryInput,
    @Headers("x-correlation-id") correlationId?: string,
  ): Promise<ConfirmRecoverySuccess> {
    return this.commandBus.execute<
      ConfirmPasswordRecoveryCommand,
      ConfirmRecoverySuccess
    >(new ConfirmPasswordRecoveryCommand(payload, { correlationId }));
  }
}
