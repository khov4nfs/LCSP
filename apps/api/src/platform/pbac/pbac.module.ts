import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { AuthWorkspaceModule } from "../../modules/auth-workspace/auth-workspace.module.js";
import { PbacContextLoader } from "./pbac-context.loader.js";
import { PbacEvaluatorService } from "./pbac-evaluator.service.js";
import { PbacPreflightController } from "./pbac-preflight.controller.js";
import { PbacPreflightService } from "./pbac-preflight.service.js";
import { PbacGuard } from "./pbac.guard.js";

/**
 * Registers the global PBAC guard, context loader, evaluator, and worker preflight authorization endpoint.
 */
@Global()
@Module({
  imports: [AuthWorkspaceModule, ConfigModule],
  controllers: [PbacPreflightController],
  providers: [
    PbacEvaluatorService,
    PbacContextLoader,
    PbacGuard,
    PbacPreflightService,
  ],
  exports: [
    PbacEvaluatorService,
    PbacContextLoader,
    PbacGuard,
    AuthWorkspaceModule,
  ],
})
export class PbacModule {}
