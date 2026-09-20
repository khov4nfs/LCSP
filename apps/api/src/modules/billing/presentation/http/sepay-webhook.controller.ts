import { Controller, Headers, Post, Req } from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import type { Request } from "express";
import { AcceptSePayWebhookCommand } from "../../application/commands/accept-sepay-webhook/accept-sepay-webhook.command.js";
import {
  mapSePayWebhookError,
  rawWebhookBody,
} from "./errors/sepay-webhook.error-mapper.js";

@Controller("billing/sepay")
export class SePayWebhookController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post("webhook")
  async receive(
    @Req() request: Request,
    @Headers("x-sepay-signature") signature?: string,
    @Headers("x-sepay-timestamp") timestamp?: string,
  ) {
    try {
      await this.commandBus.execute(
        new AcceptSePayWebhookCommand({
          rawBody: rawWebhookBody(request),
          signature,
          timestamp,
        }),
      );
      return { success: true };
    } catch (error) {
      throw mapSePayWebhookError(error);
    }
  }
}
