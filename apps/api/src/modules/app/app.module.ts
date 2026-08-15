import { Module } from "@nestjs/common";

import { GetAppGreetingUseCase } from "./application/use-cases/get-app-greeting.use-case.js";
import { APP_GREETING_PROVIDER } from "./application/ports/app-greeting.provider.js";
import { StaticAppGreetingProvider } from "./infrastructure/providers/static-app-greeting.provider.js";
import { AppController } from "./presentation/http/app.controller.js";

/**
 * Wires the root application greeting feature across presentation, application, and provider layers.
 */
@Module({
  controllers: [AppController],
  providers: [
    GetAppGreetingUseCase,
    StaticAppGreetingProvider,
    {
      provide: APP_GREETING_PROVIDER,
      useExisting: StaticAppGreetingProvider,
    },
  ],
})
export class AppFeatureModule {}
