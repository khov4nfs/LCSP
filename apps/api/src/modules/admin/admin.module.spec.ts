import { describe, expect, it } from "@jest/globals";
import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";

import { PrismaModule } from "../../infrastructure/prisma/prisma.module.js";
import { AuditModule } from "../../platform/audit/audit.module.js";
import { RbacModule } from "../../platform/rbac/rbac.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { AdminModule } from "./admin.module.js";
import { AdminUsersController } from "./presentation/http/admin-users.controller.js";
import { AdminOverviewController } from "./presentation/http/admin-overview.controller.js";
import {
  SuspendUserHandler,
  RestoreUserHandler,
} from "./application/commands/index.js";
import {
  ListAdminUsersHandler,
  GetAdminUserDetailHandler,
  GetAdminOverviewHandler,
} from "./application/queries/index.js";

describe("AdminModule", () => {
  it("compiles and resolves all admin controllers and CQRS handlers", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        AuditModule,
        RbacModule,
        AuthModule,
        AdminModule,
      ],
    }).compile();

    expect(moduleRef.get(AdminUsersController)).toBeDefined();
    expect(moduleRef.get(AdminOverviewController)).toBeDefined();
    expect(moduleRef.get(SuspendUserHandler)).toBeDefined();
    expect(moduleRef.get(RestoreUserHandler)).toBeDefined();
    expect(moduleRef.get(ListAdminUsersHandler)).toBeDefined();
    expect(moduleRef.get(GetAdminUserDetailHandler)).toBeDefined();
    expect(moduleRef.get(GetAdminOverviewHandler)).toBeDefined();
  });
});
