import { HttpStatus, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { GITHUB_INTEGRATION_ERROR_CODES } from "@lcsp/contracts/github-integration";

import { problemException } from "../../../../platform/problems/problem-factory.js";
import type { RbacRequestContext } from "../../../../platform/rbac/interfaces/rbac-request.interface.js";

const MAX_REQUEST_BYTES = 16 * 1024;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;

type GuardRequest = {
  headers: Record<string, string | string[] | undefined>;
  rbacContext?: RbacRequestContext;
  correlationId?: string;
  body?: unknown;
};

/** Applies a small secret-bearing body boundary after RBAC authentication. */
@Injectable()
export class GitHubCredentialRequestGuard implements CanActivate {
  private readonly windows = new Map<
    string,
    { startsAt: number; count: number }
  >();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<GuardRequest>();
    const correlationId = request.correlationId ?? crypto.randomUUID();
    const contentType = String(
      request.headers["content-type"] ?? "",
    ).toLowerCase();
    const contentLength = Number(request.headers["content-length"] ?? 0);
    const parsedBodyBytes = safeBodyBytes(request.body);
    if (
      !contentType.startsWith("application/json") ||
      !Number.isFinite(contentLength) ||
      contentLength > MAX_REQUEST_BYTES ||
      parsedBodyBytes > MAX_REQUEST_BYTES
    ) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.credentialRequestInvalid,
        correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }
    const rbac = request.rbacContext;
    if (!rbac) return false;
    const key = rbac.userId;
    const now = Date.now();
    const current = this.windows.get(key);
    if (!current || now - current.startsAt >= WINDOW_MS) {
      this.windows.set(key, { startsAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    if (current.count > MAX_REQUESTS_PER_WINDOW) {
      throw problemException(
        GITHUB_INTEGRATION_ERROR_CODES.credentialRequestInvalid,
        correlationId,
        { status: HttpStatus.TOO_MANY_REQUESTS },
      );
    }
    return true;
  }
}

function safeBodyBytes(body: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(body), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
