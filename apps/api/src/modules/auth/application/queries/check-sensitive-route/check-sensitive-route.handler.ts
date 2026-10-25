import { Inject } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import {
  isSensitiveActionVerificationFresh,
  matchSensitiveRoute,
  sensitiveActionVerificationExpiresAt,
} from "../../../../../platform/security/sensitive-route-policy.js";
import type { SensitiveRouteCheckDto } from "../../contracts/auth/sensitive-route.contract.js";
import {
  AUTH_READ_REPOSITORY,
  type AuthReadRepository,
} from "../../ports/persistence/auth-read.repository.ts";
import { CheckSensitiveRouteQuery } from "./check-sensitive-route.query.ts";

/** Keeps step-up reauthentication policy independent of the data store. */
@QueryHandler(CheckSensitiveRouteQuery)
export class CheckSensitiveRouteHandler implements IQueryHandler<
  CheckSensitiveRouteQuery,
  SensitiveRouteCheckDto
> {
  constructor(
    @Inject(AUTH_READ_REPOSITORY)
    private readonly reads: AuthReadRepository,
  ) {}

  async execute(
    query: CheckSensitiveRouteQuery,
  ): Promise<SensitiveRouteCheckDto> {
    const routeMatch = matchSensitiveRoute(query.method, query.route);
    const verifiedAt = await this.reads.sessionSensitiveActionVerifiedAt(
      query.sessionId,
    );

    return {
      is_sensitive: routeMatch !== null,
      route_id: routeMatch?.routeId ?? null,
      reauth_required:
        routeMatch !== null &&
        !isSensitiveActionVerificationFresh(verifiedAt, Date.now()),
      verified_at: verifiedAt?.toISOString() ?? null,
      expires_at:
        sensitiveActionVerificationExpiresAt(verifiedAt)?.toISOString() ?? null,
    };
  }
}
