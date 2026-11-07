import { Global, Module } from "@nestjs/common";
import { AuthoredLocalizationService } from "./authored-localization.service.js";

@Global()
@Module({
  providers: [AuthoredLocalizationService],
  exports: [AuthoredLocalizationService],
})
export class AuthoredLocalizationModule {}
