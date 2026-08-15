import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { CreateUserHandler } from "./application/commands/create-user/create-user.handler.js";
import { GetUserByIdHandler } from "./application/queries/get-user-by-id/get-user-by-id.handler.js";
import { USER_REPOSITORY } from "./application/ports/persistence/user.repository.js";
import { PrismaUserRepository } from "./infrastructure/persistence/prisma-user.repository.js";
import { UsersController } from "./presentation/http/users.controller.js";

/**
 * Wires user registration and lookup flows to CQRS handlers and Prisma persistence.
 */
@Module({
  imports: [CqrsModule],
  controllers: [UsersController],
  providers: [
    CreateUserHandler,
    GetUserByIdHandler,
    PrismaUserRepository,
    {
      provide: USER_REPOSITORY,
      useExisting: PrismaUserRepository,
    },
  ],
})
export class UsersModule {}
