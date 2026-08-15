import { Inject, Injectable } from "@nestjs/common";

import { AppGreeting } from "../../domain/value-objects/app-greeting.value-object.js";
import {
  APP_GREETING_PROVIDER,
  type AppGreetingProvider,
} from "../ports/app-greeting.provider.js";

/**
 * Retrieves the application greeting from its provider and normalizes it through the domain value object.
 */
@Injectable()
export class GetAppGreetingUseCase {
  /**
   * Creates the use case with the configured greeting provider.
   *
   * @param appGreetingProvider - Provider responsible for supplying the raw application greeting.
   */
  constructor(
    @Inject(APP_GREETING_PROVIDER)
    private readonly appGreetingProvider: AppGreetingProvider,
  ) {}

  /**
   * Resolves and validates the current application greeting.
   *
   * @returns The normalized greeting string.
   * @throws When the provider returns a greeting that violates the domain invariant.
   */
  async execute(): Promise<string> {
    const greeting = await this.appGreetingProvider.getGreeting();

    return AppGreeting.create(greeting).toString();
  }
}
