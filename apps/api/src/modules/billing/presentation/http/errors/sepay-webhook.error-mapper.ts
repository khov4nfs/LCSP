import { HttpStatus } from "@nestjs/common";
import type { Request } from "express";
import { BILLING_RECONCILIATION_ERROR_CODES } from "@lcsp/contracts/billing";
import { SePayWebhookIngressError } from "../../../infrastructure/security/sepay-webhook-ingress.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";

export function rawWebhookBody(request: Request): Buffer {
  return Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
}

export function mapSePayWebhookError(error: unknown): unknown {
  if (!(error instanceof SePayWebhookIngressError)) return error;
  const code =
    error.reason === "SIGNATURE"
      ? BILLING_RECONCILIATION_ERROR_CODES.invalidSignature
      : error.reason === "TIMESTAMP"
        ? BILLING_RECONCILIATION_ERROR_CODES.staleTimestamp
        : error.reason === "BODY"
          ? BILLING_RECONCILIATION_ERROR_CODES.malformedBody
          : BILLING_RECONCILIATION_ERROR_CODES.invalidPayload;
  return problemException(code, "sepay-webhook", {
    status: HttpStatus.BAD_REQUEST,
  });
}
