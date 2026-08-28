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
import type { SensitiveRouteCheckDto } from "../../contracts/auth-workspace/sensitive-route.contract.js";
import { CheckSensitiveRouteQuery } from "./check-sensitive-route.query.ts";

@QueryHandler(CheckSensitiveRouteQuery)
export class CheckSensitiveRouteHandler implements IQueryHandler<
  CheckSensitiveRouteQuery,
  SensitiveRouteCheckDto
> {
  constructor(private readonly prisma: PrismaService) {}

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
