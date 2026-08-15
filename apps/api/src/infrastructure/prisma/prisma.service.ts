import { Injectable } from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * Provides the shared Prisma client configured with the PostgreSQL adapter and managed by the Nest module lifecycle.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  /**
   * Creates the Prisma client using the configured PostgreSQL connection URL.
   */
  constructor() {
    super({ adapter: new PrismaPg(process.env.DATABASE_URL ?? "") });
  }

  /**
   * Opens the Prisma database connection when the Nest module initializes.
   *
   * @returns A promise that resolves after Prisma connects successfully.
   */
  async onModuleInit() {
    await this.$connect();
  }

  /**
   * Closes the Prisma database connection during Nest module shutdown.
   *
   * @returns A promise that resolves after Prisma disconnects.
   */
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
