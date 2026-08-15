import * as crypto from "node:crypto";

import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { Body, Controller, Headers, HttpStatus, Post } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { problemException } from "../problems/problem-factory.js";
import { resultEnvelope } from "../problems/result-envelope.js";
import { PbacPreflightService } from "./pbac-preflight.service.js";

interface PreflightRequestBody {
  user_id?: string;
  organization_id?: string;
  action?: string;
  correlationId?: string;
}

/**
 * Exposes the internal worker preflight endpoint used to re-evaluate PBAC immediately before task execution.
 */
@Controller("internal/pbac")
export class PbacPreflightController {
  /**
   * Creates the controller with PBAC evaluation and worker authentication dependencies.
   *
   * @param preflightService - Service that re-evaluates worker task authorization.
   * @param configService - Configuration source for the expected worker API key.
   */
  constructor(
    private readonly preflightService: PbacPreflightService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Authenticates the worker and performs PBAC preflight evaluation for one queued action.
   *
   * @param body - Worker-provided user, organization, action, and correlation context.
   * @param apiKey - Worker API key supplied through the `x-worker-api-key` header.
   * @returns Standardized result envelope containing the authorization decision and reason code.
   */
  @Post("preflight")
  async preflight(
    @Body() body: PreflightRequestBody,
    @Headers("x-worker-api-key") apiKey?: string,
  ) {
    this.assertWorkerApiKey(apiKey);

    const result = await this.preflightService.evaluate({
      userId: body.user_id ?? "",
      organizationId: body.organization_id ?? "",
      action: body.action ?? "",
      correlationId: body.correlationId ?? body.correlationId ?? "",
    });

    return resultEnvelope({
      decision: result.decision,
      reason_code: result.reasonCode,
      correlationId: result.correlationId,
    });
  }

  /**
   * Validates the worker API key using a timing-safe comparison.
   *
   * @param provided - API key supplied by the calling worker.
   * @throws A standardized unauthorized problem when the configured or supplied key is missing or invalid.
   */
  private assertWorkerApiKey(provided?: string): void {
    const expected = this.configService.get<string>("worker.apiKey", "");

    if (!expected || !provided || !timingSafeEqual(provided, expected)) {
      throw problemException(
        AUTH_ERROR_CODES.sessionInvalid,
        crypto.randomUUID(),
        {
          status: HttpStatus.UNAUTHORIZED,
        },
      );
    }
  }
}

/**
 * Compares two UTF-8 secret values without exposing early length-dependent comparison timing.
 *
 * @param a - Supplied secret value.
 * @param b - Expected secret value.
 * @returns True when the two values have identical bytes.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  if (bufA.length !== bufB.length) {
    // Compare against a same-length buffer so the timing profile doesn't
    // reveal the expected key length via an early bail-out.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}
