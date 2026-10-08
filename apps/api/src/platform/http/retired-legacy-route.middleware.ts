import { randomUUID } from "node:crypto";

import {
  LEGACY_ROUTE_RETIRED_ERROR_CODE,
  LEGACY_ROUTE_RETIRED_STATUS,
} from "@lcsp/contracts/legacy-migration";
import { Injectable, Logger, type NestMiddleware } from "@nestjs/common";
import type { Request } from "express";

import { problemException } from "./filters/error.factory.js";

/**
 * Answers every retired V1 route with HTTP 410 and the standard problem envelope. The controllers
 * behind these routes are gone; this middleware exists so a straggler (old BFF, old worker, old pod)
 * is rejected loudly and every hit is logged under one stable event name for the cutover monitor.
 */
@Injectable()
export class RetiredLegacyRouteMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RetiredLegacyRouteMiddleware.name);

  use(request: Request): never {
    const header = request.headers["x-correlation-id"];
    const correlationId =
      (typeof header === "string" && header.trim()) || randomUUID();
    this.logger.warn(
      JSON.stringify({
        event: LEGACY_ROUTE_RETIRED_ERROR_CODE,
        method: request.method,
        // Query strings can carry tokens; never log them.
        route: request.originalUrl.split("?")[0],
        correlationId,
        userAgent: request.headers["user-agent"] ?? null,
      }),
    );
    throw problemException(LEGACY_ROUTE_RETIRED_ERROR_CODE, correlationId, {
      status: LEGACY_ROUTE_RETIRED_STATUS,
    });
  }
}
