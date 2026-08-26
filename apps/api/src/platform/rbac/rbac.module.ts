import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { AuthWorkspaceModule } from "../../modules/auth-workspace/auth-workspace.module.js";
import { RbacContextLoader } from "./rbac-context.loader.js";
import { RbacPreflightController } from "./rbac-preflight.controller.js";
import { RbacPreflightService } from "./rbac-preflight.service.js";
import { RbacGuard } from "./rbac.guard.js";

/**
 * Registers the global RBAC guard, context loader, and worker preflight authorization endpoint.
 */
@Global()
@Module({
  imports: [AuthWorkspaceModule, ConfigModule],
  controllers: [RbacPreflightController],
  providers: [RbacContextLoader, RbacGuard, RbacPreflightService],
  exports: [
    RbacContextLoader,
    RbacGuard,
    RbacPreflightService,
    AuthWorkspaceModule,
  ],
})
export class RbacModule {}
