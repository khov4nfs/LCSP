import {
  Body,
  Controller,
  Delete,
  Headers,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";

import {
  recordMfaRecoveryCodeAccessSchema,
  verifyMfaOtpSchema,
  verifyMfaRecoveryCodeSchema,
  type RecordMfaRecoveryCodeAccessInput,
  type VerifyMfaOtpInput,
  type VerifyMfaRecoveryCodeInput,
} from "@lcsp/contracts/auth";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.ts";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.ts";
import { AllowPendingMfa } from "../../../../platform/rbac/decorators/allow-pending-mfa.decorator.ts";
import { RequireSession } from "../../../../platform/rbac/decorators/require-session.decorator.ts";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.ts";
import { ReAuthForSensitiveRoute } from "../../../../platform/security/decorators/re-auth-for-sensitive-route.decorator.ts";
import { SENSITIVE_ROUTE_IDS } from "../../../../platform/security/sensitive-route-policy.ts";
import {
  DisableMfaCommand,
  EnrollMfaCommand,
  GenerateMfaRecoveryCodesCommand,
  RecordMfaRecoveryCodeAccessCommand,
  VerifyMfaOtpCommand,
  VerifyMfaRecoveryCodeCommand,
} from "../../application/commands/index.ts";
import type {
  DisableMfaSuccess,
  EnrollMfaSuccess,
  GenerateMfaRecoveryCodesSuccess,
  RecordMfaRecoveryCodeAccessSuccess,
  VerifyMfaOtpSuccess,
  VerifyMfaRecoveryCodeSuccess,
} from "../../application/contracts/auth/index.ts";

/**
 * Controller exposing MFA enrollment, disable, OTP/recovery code verification, and recovery code generation endpoints.
 */
@Controller("auth/mfa")
export class AuthMfaController {
  constructor(private readonly commandBus: CommandBus) {}

  /**
   * Guarded MFA enrollment endpoint.
   * Enrolls the authenticated user in TOTP MFA using context userId and sessionId.
   */
  @Post("enroll")
  @UseGuards(RbacGuard)
  @RequireSession()
  @AllowPendingMfa()
  async enrollMfa(
    @Req() request: AuthenticatedRequest,
  ): Promise<EnrollMfaSuccess> {
    return this.commandBus.execute<EnrollMfaCommand, EnrollMfaSuccess>(
      new EnrollMfaCommand(
        request.rbacContext.userId,
        request.rbacContext.sessionId,
        { correlationId: request.correlationId },
      ),
    );
  }

  /**
   * Guarded MFA disable endpoint.
   * Disables MFA for the authenticated user.
   */
  @Delete()
  @UseGuards(RbacGuard)
  @RequireSession()
  async disableMfa(
    @Req() request: AuthenticatedRequest,
  ): Promise<DisableMfaSuccess> {
    return this.commandBus.execute<DisableMfaCommand, DisableMfaSuccess>(
      new DisableMfaCommand(
        request.rbacContext.userId,
        request.rbacContext.sessionId,
        { correlationId: request.correlationId },
      ),
    );
  }

  /**
   * Public MFA OTP verification endpoint during sign-in.
   */
  @Post("verify-otp")
  async verifyMfaOtp(
    @Body(new ZodValidationPipe(verifyMfaOtpSchema)) body: VerifyMfaOtpInput,
    @Headers("x-correlation-id") correlationId?: string,
  ): Promise<VerifyMfaOtpSuccess> {
    return this.commandBus.execute<VerifyMfaOtpCommand, VerifyMfaOtpSuccess>(
      new VerifyMfaOtpCommand(body.session_token, body.otp, {
        correlationId,
      }),
    );
  }

  /**
   * Public MFA recovery code verification endpoint during sign-in.
   */
  @Post("recovery-code/verify")
  async verifyMfaRecoveryCode(
    @Body(new ZodValidationPipe(verifyMfaRecoveryCodeSchema))
    body: VerifyMfaRecoveryCodeInput,
    @Headers("x-correlation-id") correlationId?: string,
  ): Promise<VerifyMfaRecoveryCodeSuccess> {
    return this.commandBus.execute<
      VerifyMfaRecoveryCodeCommand,
      VerifyMfaRecoveryCodeSuccess
    >(
      new VerifyMfaRecoveryCodeCommand(body.session_token, body.code, {
        correlationId,
      }),
    );
  }

  /**
   * Guarded MFA recovery codes generation endpoint.
   * Requires step-up re-authentication for sensitive action.
   */
  @Post("recovery-codes")
  @UseGuards(RbacGuard)
  @RequireSession()
  @ReAuthForSensitiveRoute({
    routeId: SENSITIVE_ROUTE_IDS.mfaRecoveryCodesGenerate,
    method: "POST",
    pathTemplate: "/auth/mfa/recovery-codes",
    aliases: [{ method: "POST", pathTemplate: "/api/auth/mfa/recovery-codes" }],
  })
  async generateMfaRecoveryCodes(
    @Req() request: AuthenticatedRequest,
  ): Promise<GenerateMfaRecoveryCodesSuccess> {
    return this.commandBus.execute<
      GenerateMfaRecoveryCodesCommand,
      GenerateMfaRecoveryCodesSuccess
    >(
      new GenerateMfaRecoveryCodesCommand(
        request.rbacContext.userId,
        request.rbacContext.sessionId,
        { correlationId: request.correlationId },
      ),
    );
  }

  /**
   * Guarded audit recording endpoint for MFA recovery code view/copy actions.
   */
  @Post("recovery-codes/access")
  @UseGuards(RbacGuard)
  @RequireSession()
  async recordMfaRecoveryCodeAccess(
    @Body(new ZodValidationPipe(recordMfaRecoveryCodeAccessSchema))
    body: RecordMfaRecoveryCodeAccessInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<RecordMfaRecoveryCodeAccessSuccess> {
    return this.commandBus.execute<
      RecordMfaRecoveryCodeAccessCommand,
      RecordMfaRecoveryCodeAccessSuccess
    >(
      new RecordMfaRecoveryCodeAccessCommand(
        request.rbacContext.userId,
        body.action,
        request.rbacContext.sessionId,
        { correlationId: request.correlationId },
      ),
    );
  }
}
