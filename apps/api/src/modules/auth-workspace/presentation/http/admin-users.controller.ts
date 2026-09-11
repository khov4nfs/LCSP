import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ADMIN_ACCOUNT_OPERATIONS as O,
  AUTH_USER_ROLES,
} from "@lcsp/contracts/auth";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { AdminAccountReadService } from "../../application/services/admin/admin-account-read.service.js";
import { AdminAccountCommandService } from "../../application/services/admin/admin-account-command.service.js";
import { AdminAccountInvitationService } from "../../application/services/admin/admin-account-invitation.service.js";
import { idempotency } from "../../application/services/admin/admin-account.validation.js";
import type { AdminActor } from "../../application/services/admin/admin-account.transaction.js";

@Controller("admin/users")
export class AdminUsersController {
  constructor(
    private readonly reads: AdminAccountReadService,
    private readonly commands: AdminAccountCommandService,
    private readonly invitations: AdminAccountInvitationService,
  ) {}

  @Get()
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.admin)
  async listUsers(
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(await this.reads.list(query, request.correlationId!));
  }

  @Get(":id")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.admin)
  async getUserDetail(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(await this.reads.detail(id, request.correlationId!));
  }

  @Post(":id/suspend")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.admin)
  async suspendUser(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commands.mutate(id, O.suspend, body, this.actor(request, key)),
    );
  }

  @Post(":id/restore")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.admin)
  async restoreUser(
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commands.mutate(id, O.restore, body, this.actor(request, key)),
    );
  }

  @Post()
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.admin)
  async createUser(
    @Body() body: unknown,
    @Headers("idempotency-key") key: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.invitations.invite(body, this.actor(request, key)),
    );
  }

  private actor(request: AuthenticatedRequest, key: unknown): AdminActor {
    return {
      ...request.rbacContext,
      correlationId: request.correlationId!,
      idempotencyKey: idempotency(key, request.correlationId!),
    };
  }
}
