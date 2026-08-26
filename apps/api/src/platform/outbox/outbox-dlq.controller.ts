import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import { OutboxDlqService } from "./outbox-dlq.service.js";

import type { AuthenticatedRequest } from "../../common/interfaces/authenticated-request.interface.js";
import { RequireRoles } from "../rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../rbac/rbac.guard.js";
import { resultEnvelope } from "../problems/result-envelope.js";

/**
 * Exposes RBAC-protected operator endpoints for inspecting and recovering outbox DLQ messages.
 */
@Controller("internal/outbox/dlq")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.admin)
export class OutboxDlqController {
  /**
   * Creates the controller with the DLQ application service.
   *
   * @param dlqService - Service that performs DLQ queries, replay, and deletion.
   */
  constructor(private readonly dlqService: OutboxDlqService) {}

  /**
   * Lists messages currently parked in the outbox dead-letter queue.
   *
   * @returns A standardized result envelope containing DLQ messages and count.
   */
  @Get()
  async getDlqMessages() {
    return resultEnvelope(await this.dlqService.getDlqMessages());
  }

  /**
   * Resets a DLQ message so the publisher can attempt delivery again.
   *
   * @param id - Identifier of the outbox message to replay.
   * @param req - Authenticated request providing actor and correlation context.
   * @returns A standardized success result after the message is queued for replay.
   */
  @Post(":id/replay")
  async replayMessage(
    @Param("id") id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.dlqService.replayMessage(
      id,
      req.rbacContext.userId,
      req.correlationId ?? "outbox-dlq-replay",
    );
    return resultEnvelope({
      success: true,
      message: `Message ${id} queued for replay`,
    });
  }

  /**
   * Permanently discards a message from the outbox dead-letter queue.
   *
   * @param id - Identifier of the DLQ message to delete.
   * @param req - Authenticated request providing actor and correlation context.
   * @returns A standardized success result after deletion.
   */
  @Delete(":id")
  async deleteMessage(
    @Param("id") id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.dlqService.deleteMessage(
      id,
      req.rbacContext.userId,
      req.correlationId ?? "outbox-dlq-delete",
    );
    return resultEnvelope({
      success: true,
      message: `Message ${id} permanently deleted`,
    });
  }
}
