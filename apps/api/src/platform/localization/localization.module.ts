import { Global, Module } from "@nestjs/common";
import { AuthoredLocalizationService } from "./authored-localization.service.js";
import { AuthoredLocalizationAdminController } from "./authored-localization-admin.controller.js";

@Global()
@Module({
  controllers: [AuthoredLocalizationAdminController],
  providers: [AuthoredLocalizationService],
  exports: [AuthoredLocalizationService],
})
export class AuthoredLocalizationModule {}
