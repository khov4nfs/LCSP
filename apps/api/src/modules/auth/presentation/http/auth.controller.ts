import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";

import {
  revokeSessionSchema,
  signInSchema,
  signUpSchema,
  type RevokeSessionInput,
  type SignInInput,
  type SignUpInput,
} from "@lcsp/contracts/auth";

import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.ts";
import {
  RevokeSessionCommand,
  SignInCommand,
  SignUpCommand,
} from "../../application/commands/index.ts";
import type {
  RevokeSessionSuccess,
  SignInSuccess,
  SignUpResponse,
} from "../../application/contracts/auth/index.ts";

/**
 * Controller exposing core authentication endpoints: sign-in, self-service sign-up, and session revocation.
 */
@Controller("auth")
export class AuthController {
  constructor(private readonly commandBus: CommandBus) {}

  /**
   * Public sign-in endpoint.
   * Validates credentials against `signInSchema` and returns safe user/session projection.
   */
  @Post("sign-in")
  @HttpCode(HttpStatus.OK)
  async signIn(
    @Body(new ZodValidationPipe(signInSchema)) payload: SignInInput,
    @Headers("x-correlation-id") correlationId?: string,
  ): Promise<SignInSuccess> {
    return this.commandBus.execute<SignInCommand, SignInSuccess>(
      new SignInCommand(payload, { correlationId }),
    );
  }

  /**
   * Public self-service sign-up endpoint.
   * Validates payload against `signUpSchema` and creates new user and session.
   */
  @Post("sign-up")
  async signUp(
    @Body(new ZodValidationPipe(signUpSchema)) payload: SignUpInput,
    @Headers("x-correlation-id") correlationId?: string,
  ): Promise<SignUpResponse> {
    return this.commandBus.execute<SignUpCommand, SignUpResponse>(
      new SignUpCommand({
        email: payload.email,
        displayName: payload.display_name,
        password: payload.password,
        correlationId,
      }),
    );
  }

  /**
   * Public session revocation endpoint.
   * Revokes the specified session token.
   */
  @Post("revoke-session")
  async revokeSession(
    @Body(new ZodValidationPipe(revokeSessionSchema)) body: RevokeSessionInput,
    @Headers("x-correlation-id") correlationId?: string,
  ): Promise<RevokeSessionSuccess> {
    return this.commandBus.execute<RevokeSessionCommand, RevokeSessionSuccess>(
      new RevokeSessionCommand(body.session_token, { correlationId }),
    );
  }
}
