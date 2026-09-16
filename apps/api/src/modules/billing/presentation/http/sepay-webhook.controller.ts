import { Controller, Headers, HttpStatus, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { BILLING_RECONCILIATION_ERROR_CODES } from "@lcsp/contracts/billing";
import {
  SePayWebhookIngressError,
  SePayWebhookIngressService,
} from "../../application/services/sepay-webhook-ingress.service.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";

@Controller("billing/sepay")
export class SePayWebhookController {
  constructor(private readonly ingress: SePayWebhookIngressService) {}

  @Post("webhook")
  async receive(
    @Req() request: Request,
    @Headers("x-sepay-signature") signature?: string,
    @Headers("x-sepay-timestamp") timestamp?: string,
  ) {
    const rawBody = Buffer.isBuffer(request.body)
      ? request.body
      : Buffer.alloc(0);
    try {
      const result = await this.ingress.accept({
        rawBody,
        signature,
        timestamp,
      });
      return resultEnvelope({ duplicate: result.duplicate });
    } catch (error) {
      if (error instanceof SePayWebhookIngressError) {
        const code =
          error.reason === "SIGNATURE"
            ? BILLING_RECONCILIATION_ERROR_CODES.invalidSignature
            : error.reason === "TIMESTAMP"
              ? BILLING_RECONCILIATION_ERROR_CODES.staleTimestamp
              : error.reason === "BODY"
                ? BILLING_RECONCILIATION_ERROR_CODES.malformedBody
                : BILLING_RECONCILIATION_ERROR_CODES.invalidPayload;
        throw problemException(code, "sepay-webhook", {
          status: HttpStatus.BAD_REQUEST,
        });
      }
      throw error;
    }
  }
}
