import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  ADMIN_ACCOUNT_ERRORS,
  ADMIN_ACCOUNT_OPERATIONS,
  ADMIN_ERROR_CODES,
  AUTH_AUDIT_EVENT_TYPES,
  USER_ACCESS_STATUSES,
  type AdminUserDetail,
} from "@lcsp/contracts/auth";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { AuthAuditService } from "../../../../auth/application/services/auth/auth-audit.service.js";
import {
  accountTransaction,
  assertCurrentAdmin,
  legacyRequestHash,
  receipt,
  replay,
  requestHash,
} from "../../../infrastructure/persistence/admin-account.transaction.js";
import { fetchAdminUserDetail } from "../../queries/get-admin-user-detail/get-admin-user-detail.handler.js";
import { RestoreUserCommand } from "./restore-user.command.js";

/**
 * Handles the administrative restoration of a suspended user account.
 *
 * Enforces:
 * 1. Admin actor authentication and permission verification inside transaction.
 * 2. Idempotency replay detection using SHA-256 request payload hash.
 * 3. Pessimistic row locking (SELECT FOR UPDATE) to prevent concurrent state changes.
 * 4. Optimistic concurrency version check (expectedVersion vs accessVersion).
 * 5. Suspended state check (account must currently be in SUSPENDED status to be restored).
 * 6. Atomic status transition to ACTIVE and accessVersion increment.
 * 7. Audit logging and receipt recording.
 */
@CommandHandler(RestoreUserCommand)
export class RestoreUserHandler implements ICommandHandler<RestoreUserCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuthAuditService,
  ) {}

  async execute(command: RestoreUserCommand): Promise<AdminUserDetail> {
    const { targetId: targetUserId, body, actor } = command;
    const { expectedVersion, reason } = body;

    // Generate deterministic canonical and legacy request hashes for idempotency checking
    const payloadHash = requestHash(ADMIN_ACCOUNT_OPERATIONS.restore, {
      id: targetUserId,
      expectedVersion,
      reason,
    });
    const legacyHash = legacyRequestHash(ADMIN_ACCOUNT_OPERATIONS.restore, {
      id: targetUserId,
      expectedVersion,
      reason,
    });

    return accountTransaction(
      this.prisma,
      actor.correlationId,
      async (transactionClient) => {
        // Step 1: Re-verify that the acting admin is currently active, verified, and not revoked
        await assertCurrentAdmin(transactionClient, actor);

        // Step 2: Check if this exact idempotent request was already processed
        const previousReceipt = await replay(
          transactionClient,
          actor,
          ADMIN_ACCOUNT_OPERATIONS.restore,
          payloadHash,
          legacyHash,
        );
        if (previousReceipt) {
          return {
            ...(await fetchAdminUserDetail(
              transactionClient,
              previousReceipt.resourceId,
              actor.correlationId,
            )),
            replayed: true,
          };
        }

        // Step 3: Lock target user row with SELECT ... FOR UPDATE to serialize concurrent mutations
        await transactionClient.$queryRaw(
          Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${targetUserId} FOR UPDATE`,
        );

        const targetUser = await transactionClient.user.findUnique({
          where: { id: targetUserId },
          select: {
            id: true,
            role: true,
            accessStatus: true,
            accessVersion: true,
          },
        });

        if (!targetUser) {
          throw problemException(
            ADMIN_ERROR_CODES.userNotFound,
            actor.correlationId,
            { status: HttpStatus.NOT_FOUND },
          );
        }

        // Step 4: Validate optimistic concurrency version
        if (targetUser.accessVersion !== expectedVersion) {
          throw problemException(
            ADMIN_ACCOUNT_ERRORS.staleVersion,
            actor.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }

        // Step 5: Verify account is currently suspended before restoring
        if (targetUser.accessStatus !== USER_ACCESS_STATUSES.suspended) {
          throw problemException(
            ADMIN_ACCOUNT_ERRORS.invalidState,
            actor.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }

        // Step 6: Update target status to ACTIVE and increment accessVersion atomically
        const updateResult = await transactionClient.user.updateMany({
          where: {
            id: targetUserId,
            accessVersion: expectedVersion,
            accessStatus: targetUser.accessStatus,
          },
          data: {
            accessVersion: { increment: 1 },
            accessStatus: USER_ACCESS_STATUSES.active,
          },
        });
        if (updateResult.count !== 1) {
          throw problemException(
            ADMIN_ACCOUNT_ERRORS.staleVersion,
            actor.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }

        // Step 7: Record audit event in transaction
        await this.audit.writeInTx(
          {
            eventType: AUTH_AUDIT_EVENT_TYPES.authAdminUserRestored,
            actorId: actor.userId,
            sessionId: actor.sessionId,
            correlationId: actor.correlationId,
            resourceType: AUDIT_RESOURCE_TYPES.authAccount,
            resourceId: targetUserId,
            decision: AUDIT_DECISIONS.allow,
            payload: {
              targetUserId,
              previousStatus: targetUser.accessStatus,
              newStatus: USER_ACCESS_STATUSES.active,
              previousVersion: expectedVersion,
              newVersion: expectedVersion + 1,
              reason,
              changed: true,
              timestamp: new Date().toISOString(),
            },
          },
          transactionClient,
        );

        // Step 8: Save command receipt for future idempotent replays
        await receipt(
          transactionClient,
          actor,
          ADMIN_ACCOUNT_OPERATIONS.restore,
          payloadHash,
          targetUserId,
        );

        // Step 9: Return updated detail view
        return {
          ...(await fetchAdminUserDetail(
            transactionClient,
            targetUserId,
            actor.correlationId,
          )),
          replayed: false,
        };
      },
    );
  }
}
