import { Global, Module } from "@nestjs/common";

import { PrismaService } from "./prisma.service.js";

/**
 * Registers the shared Prisma database client as a global Nest provider.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
