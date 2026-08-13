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
  correlationId?: string;
}

@Controller("internal/pbac")
export class PbacPreflightController {
  constructor(
    private readonly preflightService: PbacPreflightService,
    private readonly configService: ConfigService,
  ) {}

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
