import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import {
  isSensitiveActionVerificationFresh,
  matchSensitiveRoute,
  sensitiveActionVerificationExpiresAt,
} from "../../../../../platform/security/sensitive-route-policy.js";
import {
  AUTH_RECORD_TYPES,
  authRecordMetadataDate,
} from "../../../infrastructure/persistence/auth-record.persistence.ts";
import type { SensitiveRouteCheckDto } from "../../contracts/auth/sensitive-route.contract.js";
import { CheckSensitiveRouteQuery } from "./check-sensitive-route.query.ts";

/**
 * Handles evaluation of whether a requested HTTP method/route is sensitive and requires step-up reauthentication.
 *
 * Enforces:
 * 1. Matches requested method and route against the sensitive route policy registry.
 * 2. Checks current session's `sensitiveActionVerifiedAt` freshness against the configured time window.
 * 3. Returns re-auth required boolean flag and timestamp bounds.
 */
@QueryHandler(CheckSensitiveRouteQuery)
export class CheckSensitiveRouteHandler implements IQueryHandler<
  CheckSensitiveRouteQuery,
  SensitiveRouteCheckDto
> {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Executes sensitive route verification check.
   *
   * @param query - Contains target method, route string, and sessionId.
   * @returns Sensitive route matching status, re-auth requirement, and validity expiration.
   */
  async execute(
    query: CheckSensitiveRouteQuery,
  ): Promise<SensitiveRouteCheckDto> {
    const routeMatch = matchSensitiveRoute(query.method, query.route);
    const isSensitive = routeMatch !== null;
    const session = await this.prisma.authRecord.findFirst({
      where: { id: query.sessionId, type: AUTH_RECORD_TYPES.session },
    });
    const verifiedAt = session
      ? authRecordMetadataDate(session, "sensitiveActionVerifiedAt")
      : null;
    const expiresAt = sensitiveActionVerificationExpiresAt(verifiedAt);

    return {
      is_sensitive: isSensitive,
      route_id: routeMatch?.routeId ?? null,
      reauth_required:
        isSensitive &&
        !isSensitiveActionVerificationFresh(verifiedAt, Date.now()),
      verified_at: verifiedAt?.toISOString() ?? null,
      expires_at: expiresAt?.toISOString() ?? null,
    };
  }
}
