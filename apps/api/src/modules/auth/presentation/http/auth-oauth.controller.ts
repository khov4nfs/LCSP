import {
  Controller,
  Get,
  Headers,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";

import {
  oauthCallbackSchema,
  oauthLinkCallbackSchema,
  oauthLinkStartSchema,
  oauthStartSchema,
  type OAuthCallbackInput,
  type OAuthLinkCallbackInput,
  type OAuthLinkStartInput,
  type OAuthStartInput,
} from "@lcsp/contracts/auth";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.ts";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.ts";
import { RequireSession } from "../../../../platform/rbac/decorators/require-session.decorator.ts";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.ts";
import {
  OAuthCallbackCommand,
  OAuthLinkCallbackCommand,
  OAuthLinkStartCommand,
  OAuthStartCommand,
} from "../../application/commands/index.ts";
import type {
  OAuthCallbackSuccess,
  OAuthLinkCallbackSuccess,
  OAuthLinkStartSuccess,
  OAuthStartSuccess,
} from "../../application/contracts/auth/index.ts";

/**
 * Controller exposing OAuth identity authentication and social account linking endpoints.
 */
@Controller("auth/oauth")
export class AuthOAuthController {
  constructor(private readonly commandBus: CommandBus) {}

  /**
   * Public OAuth start flow endpoint.
   */
  @Get("start")
  async oauthStart(
    @Query(new ZodValidationPipe(oauthStartSchema)) query: OAuthStartInput,
    @Headers("x-correlation-id") correlationId?: string,
  ): Promise<OAuthStartSuccess> {
    return this.commandBus.execute<OAuthStartCommand, OAuthStartSuccess>(
      new OAuthStartCommand(query, { correlationId }),
    );
  }

  /**
   * Public OAuth callback handler endpoint.
   */
  @Get("callback")
  async oauthCallback(
    @Query(new ZodValidationPipe(oauthCallbackSchema))
    query: OAuthCallbackInput,
    @Headers("x-correlation-id") correlationId?: string,
  ): Promise<OAuthCallbackSuccess> {
    return this.commandBus.execute<OAuthCallbackCommand, OAuthCallbackSuccess>(
      new OAuthCallbackCommand(query, { correlationId }),
    );
  }

  /**
   * Guarded OAuth identity linking start flow endpoint.
   */
  @Get("link/start")
  @UseGuards(RbacGuard)
  @RequireSession()
  async oauthLinkStart(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(oauthLinkStartSchema))
    query: OAuthLinkStartInput,
  ): Promise<OAuthLinkStartSuccess> {
    return this.commandBus.execute<
      OAuthLinkStartCommand,
      OAuthLinkStartSuccess
    >(
      new OAuthLinkStartCommand(
        query,
        request.rbacContext.userId,
        request.rbacContext.sessionId,
        { correlationId: request.correlationId },
      ),
    );
  }

  /**
   * Guarded OAuth identity linking callback endpoint.
   */
  @Get("link/callback")
  @UseGuards(RbacGuard)
  @RequireSession()
  async oauthLinkCallback(
    @Req() request: AuthenticatedRequest,
    @Query(new ZodValidationPipe(oauthLinkCallbackSchema))
    query: OAuthLinkCallbackInput,
  ): Promise<OAuthLinkCallbackSuccess> {
    return this.commandBus.execute<
      OAuthLinkCallbackCommand,
      OAuthLinkCallbackSuccess
    >(
      new OAuthLinkCallbackCommand(
        query,
        request.rbacContext.userId,
        request.rbacContext.sessionId,
        { correlationId: request.correlationId },
      ),
    );
  }
}
