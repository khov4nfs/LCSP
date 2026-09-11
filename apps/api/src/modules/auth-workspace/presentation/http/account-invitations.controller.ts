import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { AdminAccountInvitationService } from "../../application/services/admin/admin-account-invitation.service.js";

/** The one-time opaque token authorizes acceptance; no caller role is accepted. */
@Controller("auth/invitations")
export class AccountInvitationsController {
  constructor(private readonly invitations: AdminAccountInvitationService) {}
  @Post("accept")
  @HttpCode(HttpStatus.OK)
  async accept(
    @Body() input: unknown,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return resultEnvelope(
      await this.invitations.accept(input, correlationId ?? randomUUID()),
    );
  }
}
