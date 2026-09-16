import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { describe, expect, it } from "@jest/globals";
import { RbacModule } from "../../platform/rbac/rbac.module.js";
import { AuthWorkspaceModule } from "./auth-workspace.module.ts";

describe("AuthWorkspaceModule CQRS registration", () => {
  it("initializes without TypeError in CQRS CommandBus", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        RbacModule,
        AuthWorkspaceModule,
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    expect(app).toBeDefined();
    await app.close();
  });
});
