import * as crypto from "node:crypto";

import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";

import { problemException } from "../problems/problem-factory.js";

interface RequestWithHeaders {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Protects internal HTTP endpoints by validating the configured internal API token.
 */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  /**
   * Creates the guard with access to runtime configuration.
   *
   * @param configService - Configuration service used to read the expected internal API token.
   */
  constructor(private readonly configService: ConfigService) {}

  /**
   * Validates the request's `x-internal-token` header using a timing-safe comparison.
   *
   * @param context - Nest execution context containing the incoming HTTP request.
   * @returns True when the supplied internal token is valid.
   * @throws A standardized unauthorized problem when the token is missing or invalid.
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithHeaders>();
    const provided = request.headers["x-internal-token"];
    const token = Array.isArray(provided) ? provided[0] : provided;
    const correlationId =
      headerString(request.headers["x-correlation-id"]) ?? crypto.randomUUID();

    const expected = this.configService.get<string>("internal.apiToken", "");

    if (!expected || !token || !timingSafeEqual(token, expected)) {
      throw problemException(AUTH_ERROR_CODES.sessionInvalid, correlationId, {
        status: HttpStatus.UNAUTHORIZED,
      });
    }

    return true;
  }
}

/**
 * Normalizes a request-header value to its first string value.
 *
 * @param value - Raw header value supplied by the HTTP framework.
 * @returns The first header value, or null when the header is absent.
 */
function headerString(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  return value?.[0] ?? null;
}

/**
 * Compares two UTF-8 strings without exposing value-dependent timing differences.
 *
 * @param a - Supplied token value.
 * @param b - Expected token value.
 * @returns True when both values have equal bytes.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}
