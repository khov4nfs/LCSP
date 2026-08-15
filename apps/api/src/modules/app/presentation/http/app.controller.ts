import { Controller, Get } from "@nestjs/common";

import { GetAppGreetingUseCase } from "../../application/use-cases/get-app-greeting.use-case.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";

/**
 * Exposes the root application greeting endpoint.
 */
@Controller()
export class AppController {
  /**
   * Creates the controller with the greeting use case used by the root route.
   *
   * @param getAppGreetingUseCase - Application use case that resolves the validated greeting.
   */
  constructor(private readonly getAppGreetingUseCase: GetAppGreetingUseCase) {}

  /**
   * Returns the application greeting wrapped in the standard result envelope.
   *
   * @returns The standard HTTP result envelope containing the greeting.
   */
  @Get()
  async getHello() {
    return resultEnvelope(await this.getAppGreetingUseCase.execute());
  }
}
