import { randomUUID, timingSafeEqual } from "node:crypto";

import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import type { Request } from "express";

import { problemException } from "../../../../platform/problems/problem-factory.js";

/**
 * Protects internal worker endpoints with the configured API key using constant-time comparison.
 */
@Injectable()
export class WorkerApiKeyGuard implements CanActivate {
  /**
   * Creates the guard with access to worker authentication configuration.
   *
   * @param configService - Configuration service used to resolve the expected worker API key.
   */
  constructor(private readonly configService: ConfigService) {}

  /**
   * Validates the `x-worker-api-key` header and rejects missing/mismatched credentials as an invalid session.
   *
   * @param context - Nest execution context containing the incoming HTTP request.
   * @returns True when the supplied worker key matches the configured key.
   * @throws An unauthorized session-invalid problem when credentials are absent, unconfigured, or incorrect.
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = headerString(request.headers["x-worker-api-key"]);
    const correlationId =
      headerString(request.headers["x-correlation-id"]) ?? randomUUID();
    const expected = this.configService.get<string>("worker.apiKey", "");

    if (!provided || !expected || !secureEqual(provided, expected)) {
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, correlationId, {
        status: HttpStatus.UNAUTHORIZED,
      });
    }
    return true;
  }
}

/**
 * Normalizes a single-or-array HTTP header value to one string.
 *
 * @param value - Raw Express header value.
 * @returns Header string, first array entry, or null when absent.
 */
function headerString(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  return value?.[0] ?? null;
}

/**
 * Compares worker API keys in constant time after rejecting unequal byte lengths.
 *
 * @param left - Presented worker key.
 * @param right - Expected configured worker key.
 * @returns True when both keys are byte-for-byte equal.
 */
function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
