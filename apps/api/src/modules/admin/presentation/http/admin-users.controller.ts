import {
  adminListUsersQuerySchema,
  adminUserActionSchema,
  ADMIN_ACCOUNT_ERRORS,
  AUTH_USER_ROLES,
  type AdminListUsersQueryInput,
  type AdminUserActionInput,
  type AdminUserDetail,
  type AdminUserListResponse,
} from "@lcsp/contracts/auth";
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
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.ts";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.ts";
import { problemException } from "../../../../platform/http/filters/error.factory.ts";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.ts";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.ts";
import {
  RestoreUserCommand,
  SuspendUserCommand,
} from "../../application/commands/index.ts";
import {
  GetAdminUserDetailQuery,
  ListAdminUsersQuery,
} from "../../application/queries/index.ts";
import type { AdminActor } from "../../infrastructure/persistence/admin-account.transaction.ts";

const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Validates that an Idempotency-Key header is present, non-empty, and satisfies character set and length <= 128.
 */
function assertIdempotencyKey(
  idempotencyKeyHeader: string | undefined,
  correlationId: string,
): string {
  if (
    typeof idempotencyKeyHeader !== "string" ||
    !IDEMPOTENCY_KEY_REGEX.test(idempotencyKeyHeader)
  ) {
    throw problemException(
      ADMIN_ACCOUNT_ERRORS.idempotencyRequired,
      correlationId,
      {
        status: HttpStatus.BAD_REQUEST,
      },
    );
  }
  return idempotencyKeyHeader;
}

/**
 * Administrative HTTP controller for managing user accounts:
 * - List users with filtering, search, and pagination.
 * - Get user detail with usage metrics.
 * - Suspend user accounts idempotently with optimistic concurrency.
 * - Restore user accounts idempotently with optimistic concurrency.
 */
@Controller("admin/users")
export class AdminUsersController {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
  ) {}

  /**
   * Lists users with optional text search, status filter, role filter, and pagination.
   */
  @Get()
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.admin)
  async listUsers(
    @Query(
      new ZodValidationPipe(
        adminListUsersQuerySchema,
        ADMIN_ACCOUNT_ERRORS.invalidInput,
      ),
    )
    query: AdminListUsersQueryInput,
    @Req() request: AuthenticatedRequest,
  ): Promise<AdminUserListResponse> {
    return this.queryBus.execute<ListAdminUsersQuery, AdminUserListResponse>(
      new ListAdminUsersQuery(query, request.correlationId!),
    );
  }

  /**
   * Retrieves detailed profile and usage metrics for a specific user.
   */
  @Get(":id")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.admin)
  async getUserDetail(
    @Param("id") targetUserId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<AdminUserDetail> {
    return this.queryBus.execute<GetAdminUserDetailQuery, AdminUserDetail>(
      new GetAdminUserDetailQuery(targetUserId, request.correlationId!),
    );
  }

  /**
   * Suspends a user account idempotently.
   */
  @Post(":id/suspend")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.admin)
  async suspendUser(
    @Param("id") targetUserId: string,
    @Body(
      new ZodValidationPipe(
        adminUserActionSchema,
        ADMIN_ACCOUNT_ERRORS.invalidInput,
      ),
    )
    body: AdminUserActionInput,
    @Headers("idempotency-key") idempotencyKeyHeader: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<AdminUserDetail> {
    return this.commandBus.execute<SuspendUserCommand, AdminUserDetail>(
      new SuspendUserCommand(
        targetUserId,
        body,
        this.buildAdminActor(request, idempotencyKeyHeader),
      ),
    );
  }

  /**
   * Restores a suspended user account idempotently.
   */
  @Post(":id/restore")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.admin)
  async restoreUser(
    @Param("id") targetUserId: string,
    @Body(
      new ZodValidationPipe(
        adminUserActionSchema,
        ADMIN_ACCOUNT_ERRORS.invalidInput,
      ),
    )
    body: AdminUserActionInput,
    @Headers("idempotency-key") idempotencyKeyHeader: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<AdminUserDetail> {
    return this.commandBus.execute<RestoreUserCommand, AdminUserDetail>(
      new RestoreUserCommand(
        targetUserId,
        body,
        this.buildAdminActor(request, idempotencyKeyHeader),
      ),
    );
  }

  /**
   * Constructs the authenticated admin actor context including correlationId and validated idempotencyKey.
   */
  private buildAdminActor(
    request: AuthenticatedRequest,
    idempotencyKeyHeader: string | undefined,
  ): AdminActor {
    return {
      ...request.rbacContext,
      correlationId: request.correlationId!,
      idempotencyKey: assertIdempotencyKey(
        idempotencyKeyHeader,
        request.correlationId!,
      ),
    };
  }
}
