import { Injectable } from "@nestjs/common";

import type { AppGreetingProvider } from "../../application/ports/app-greeting.provider.js";

/**
 * Supplies a fixed application greeting without relying on an external data source.
 */
@Injectable()
export class StaticAppGreetingProvider implements AppGreetingProvider {
  /**
   * Returns the configured static greeting.
   *
   * @returns A promise resolving to the application greeting.
   */
  getGreeting(): Promise<string> {
    return Promise.resolve("Hello World!");
  }
}
