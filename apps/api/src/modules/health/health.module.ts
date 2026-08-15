import { Module } from "@nestjs/common";

import { HealthController } from "./health.controller.js";

/**
 * Registers the API health-check endpoint used by runtime availability probes.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
