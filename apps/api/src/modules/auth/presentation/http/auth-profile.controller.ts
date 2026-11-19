import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";

import {
  updateProfileSchema,
  type UpdateProfileInput,
} from "@lcsp/contracts/auth";

import type { AuthenticatedRequest } from "../../../../platform/rbac/interfaces/authenticated-request.interface.ts";
import { ZodValidationPipe } from "../../../../platform/http/pipes/zod-validation.pipe.ts";
import { RequireSession } from "../../../../platform/rbac/decorators/require-session.decorator.ts";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.ts";
import {
  RevokeOwnedSessionCommand,
  RevokeAllSessionsCommand,
  UpdateProfileCommand,
} from "../../application/commands/index.ts";
import type {
  AuthProfileSuccess,
  AuthSessionsSuccess,
  RevokeOwnedSessionSuccess,
  RevokeAllSessionsSuccess,
  UpdateProfileSuccess,
} from "../../application/contracts/auth/index.ts";
import {
  GetAuthProfileQuery,
  ListAuthSessionsQuery,
} from "../../application/queries/index.ts";

/**
 * Controller exposing authenticated user profile retrieval/update and session management endpoints.
 */
@Controller("auth")
export class AuthProfileController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  /**
   * Guarded profile update endpoint.
   */
  @Patch("profile")
  @UseGuards(RbacGuard)
  @RequireSession()
  async updateProfile(
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<UpdateProfileSuccess> {
    return this.commandBus.execute<UpdateProfileCommand, UpdateProfileSuccess>(
      new UpdateProfileCommand(
        body,
        request.rbacContext.userId,
        request.rbacContext.sessionId,
        {
          correlationId: request.correlationId,
        },
      ),
    );
  }

  /**
   * Guarded profile retrieval endpoint.
   */
  @Get("profile")
  @UseGuards(RbacGuard)
  @RequireSession()
  async getProfile(
    @Req() request: AuthenticatedRequest,
  ): Promise<AuthProfileSuccess> {
    return this.queryBus.execute<GetAuthProfileQuery, AuthProfileSuccess>(
      new GetAuthProfileQuery(request.rbacContext, request.correlationId!),
    );
  }

  /**
   * Guarded active sessions list endpoint.
   */
  @Get("sessions")
  @UseGuards(RbacGuard)
  @RequireSession()
  async listSessions(
    @Req() request: AuthenticatedRequest,
  ): Promise<AuthSessionsSuccess> {
    return this.queryBus.execute<ListAuthSessionsQuery, AuthSessionsSuccess>(
      new ListAuthSessionsQuery(request.rbacContext),
    );
  }

  /**
   * Business purpose: Sign the authenticated owner out of all existing devices.
   * Business rules:
   * - The session guard identifies the owner; the command enforces recent step-up.
   * Execution flow:
   * 1. Delegate the authenticated context to the all-sessions revocation command.
   * Failure cases:
   * - Command authorization and persistence failures use the shared problem envelope.
   * Side effects:
   * - Revokes every active session including the calling session.
   */
  @Delete("sessions")
  @UseGuards(RbacGuard)
  @RequireSession()
  async revokeAllSessions(
    @Req() request: AuthenticatedRequest,
  ): Promise<RevokeAllSessionsSuccess> {
    return this.commandBus.execute<
      RevokeAllSessionsCommand,
      RevokeAllSessionsSuccess
    >(
      new RevokeAllSessionsCommand(request.rbacContext, {
        correlationId: request.correlationId,
      }),
    );
  }

  /**
   * Guarded session revocation endpoint for a user's own session by sessionId.
   */
  @Delete("sessions/:sessionId")
  @UseGuards(RbacGuard)
  @RequireSession()
  async revokeOwnedSession(
    @Param("sessionId") sessionId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<RevokeOwnedSessionSuccess> {
    return this.commandBus.execute<
      RevokeOwnedSessionCommand,
      RevokeOwnedSessionSuccess
    >(
      new RevokeOwnedSessionCommand(sessionId, request.rbacContext, {
        correlationId: request.correlationId,
      }),
    );
  }
}
