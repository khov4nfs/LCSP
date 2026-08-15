import { Controller, Get, HttpCode } from "@nestjs/common";
import { SERVICE_HEALTH_STATUSES } from "@lcsp/contracts/shared";
import { resultEnvelope } from "../../platform/problems/result-envelope.js";

/**
 * Exposes the lightweight service-health endpoint used by runtime probes and operators.
 */
@Controller("health")
export class HealthController {
  /**
   * Reports that the API process is reachable and serving requests.
   *
   * @returns The standard result envelope containing the healthy service status.
   */
  @Get()
  @HttpCode(200)
  check() {
    return resultEnvelope({ status: SERVICE_HEALTH_STATUSES.ok });
  }
}
