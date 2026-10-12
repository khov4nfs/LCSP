import { Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { describe, expect, it } from "@jest/globals";
import { RbacModule } from "../../platform/rbac/rbac.module.js";
import {
  AUTH_MFA_ENROLLMENT_REPOSITORY,
  AUTH_SESSION_REPOSITORY,
  AUTH_USER_REPOSITORY,
} from "./application/ports/persistence/index.ts";
import { AuthModule } from "./auth.module.ts";

describe("AuthModule CQRS registration", () => {
  it("initializes without TypeError in CQRS CommandBus", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        RbacModule,
        AuthModule,
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    expect(app).toBeDefined();
    await app.close();
  });

  it("exports minimal required authentication ports for consumer modules", async () => {
    const EXPORTED_TOKENS = [
      AUTH_USER_REPOSITORY,
      AUTH_SESSION_REPOSITORY,
      AUTH_MFA_ENROLLMENT_REPOSITORY,
    ];

    @Module({
      imports: [AuthModule],
    })
    class ConsumerTestModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        RbacModule,
        ConsumerTestModule,
      ],
    }).compile();

    for (const token of EXPORTED_TOKENS) {
      const resolved: unknown = moduleRef.get(token);
      expect(resolved).toBeDefined();
    }
  });
});
