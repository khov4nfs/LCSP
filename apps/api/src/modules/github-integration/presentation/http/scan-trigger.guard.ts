import { randomUUID, timingSafeEqual } from "node:crypto";

import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  type HttpException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";

import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import {
  GITHUB_INTEGRATION_ERROR_CODES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
  type RepositoryScanTriggerSource,
} from "@lcsp/contracts/github-integration";

import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";

export interface ScanTriggerRequestContext extends Request {
  scanTriggerSource?: RepositoryScanTriggerSource;
}

/**
 * Selects the trusted-worker or manual-RBAC authentication path for scan triggers and normalizes the resulting trigger source.
 */
@Injectable()
export class ScanTriggerGuard implements CanActivate {
  /**
   * Creates the guard with RBAC authorization and worker-key configuration dependencies.
   *
   * @param rbacGuard - Standard RBAC guard used for manually triggered scans.
   * @param configService - Configuration service used to validate trusted worker API keys.
   */
  constructor(
    private readonly rbacGuard: RbacGuard,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Authenticates trusted worker requests by API key or delegates manual requests to RBAC, rejecting forged/mismatched trigger sources.
   *
   * @param context - Nest execution context containing request headers, body, and RBAC metadata.
   * @returns True when the request is authorized and its normalized scan trigger source has been attached.
   * @throws When worker credentials are invalid or the requested trigger source conflicts with the authentication path.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<ScanTriggerRequestContext>();
    const apiKey = headerString(request.headers["x-worker-api-key"]);
    const correlationId =
      headerString(request.headers["x-correlation-id"]) ?? randomUUID();
    const requestedSource = readTriggerSource(request.body);

    if (apiKey) {
      this.assertWorkerApiKey(apiKey, correlationId);
      if (
        requestedSource &&
        requestedSource !== REPOSITORY_SCAN_TRIGGER_SOURCES.trusted
      ) {
        throw this.invalidSource(correlationId);
      }
      request.scanTriggerSource = REPOSITORY_SCAN_TRIGGER_SOURCES.trusted;
      return true;
    }

    if (requestedSource === REPOSITORY_SCAN_TRIGGER_SOURCES.trusted) {
      throw this.unauthorized(correlationId);
    }
    if (
      requestedSource &&
      requestedSource !== REPOSITORY_SCAN_TRIGGER_SOURCES.manual
    ) {
      throw this.invalidSource(correlationId);
    }

    const allowed = await this.rbacGuard.canActivate(context);
    if (allowed) {
      request.scanTriggerSource = REPOSITORY_SCAN_TRIGGER_SOURCES.manual;
    }
    return allowed;
  }

  /**
   * Validates a presented trusted-worker key using constant-time comparison.
   *
   * @param provided - Worker API key supplied by the request.
   * @param correlationId - Correlation identifier attached to authentication failures.
   * @returns Nothing when the key matches the configured worker key.
   * @throws An unauthorized problem when the worker key is missing from configuration or does not match.
   */
  private assertWorkerApiKey(provided: string, correlationId: string): void {
    const expected = this.configService.get<string>("worker.apiKey", "");
    if (!expected || !secureEqual(provided, expected)) {
      throw this.unauthorized(correlationId);
    }
  }

  /**
   * Builds the bad-request exception used for unsupported or forged trigger-source values.
   *
   * @param correlationId - Correlation identifier attached to the problem response.
   * @returns Standard invalid-trigger-source HTTP exception.
   */
  private invalidSource(correlationId: string): HttpException {
    return problemException(
      GITHUB_INTEGRATION_ERROR_CODES.scanTriggerSourceInvalid,
      correlationId,
      { status: HttpStatus.BAD_REQUEST },
    );
  }

  /**
   * Builds the unauthorized exception used for invalid trusted-worker authentication.
   *
   * @param correlationId - Correlation identifier attached to the problem response.
   * @returns Standard session-invalid HTTP exception.
   */
  private unauthorized(correlationId: string): HttpException {
    return problemException(AUTH_ERROR_CODES.sessionInvalid, correlationId, {
      status: HttpStatus.UNAUTHORIZED,
    });
  }
}

/**
 * Reads the optional scan trigger source from an untyped request body.
 *
 * @param body - Unknown HTTP body to inspect.
 * @returns Trimmed trigger-source string, or null when absent/non-string.
 */
function readTriggerSource(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const value = (body as Record<string, unknown>).trigger_source;
  return typeof value === "string" ? value.trim() : null;
}

/**
 * Normalizes a single-or-array HTTP header value to one string.
 *
 * @param value - Raw request header value.
 * @returns Header string, first array element, or null when absent.
 */
function headerString(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  return value?.[0] ?? null;
}

/**
 * Compares two worker keys in constant time after rejecting unequal byte lengths.
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
