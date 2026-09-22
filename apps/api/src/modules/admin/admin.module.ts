import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { PrismaModule } from "../../infrastructure/prisma/prisma.module.ts";
import { AuditModule } from "../../platform/audit/audit.module.ts";
import { RbacModule } from "../../platform/rbac/rbac.module.ts";
import { AuthModule } from "../auth/auth.module.ts";
import { ADMIN_COMMAND_HANDLERS } from "./application/commands/index.ts";
import { ADMIN_QUERY_HANDLERS } from "./application/queries/index.ts";
import { AdminOverviewController } from "./presentation/http/admin-overview.controller.ts";
import { AdminUsersController } from "./presentation/http/admin-users.controller.ts";

@Module({
  imports: [PrismaModule, AuditModule, RbacModule, CqrsModule, AuthModule],
  controllers: [AdminUsersController, AdminOverviewController],
  providers: [...ADMIN_COMMAND_HANDLERS, ...ADMIN_QUERY_HANDLERS],
})
export class AdminModule {}
