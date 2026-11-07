import { Injectable } from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * Business purpose:
 * Keep persisted instants and runtime lease checks consistent with the PostgreSQL adapter's UTC date encoding.
 *
 * Business rules:
 * - Every Prisma connection uses UTC, regardless of server, role, database, or URL timezone defaults.
 * - Preserve connection credentials and unrelated startup options; URL options take precedence over PGOPTIONS.
 *
 * Execution flow:
 * 1. Resolve the startup options that the PostgreSQL driver would otherwise inherit.
 * 2. Append the UTC setting after those options and place it inside the URL so URL parsing cannot override it.
 * 3. Return the same enforced options for connections using environment defaults without a URL.
 *
 * Failure cases:
 * - A malformed non-empty database URL is rejected without including credentials in the error.
 * - Invalid existing PostgreSQL startup options still fail when the driver opens its connection.
 *
 * Side effects:
 * - Pure configuration construction; it does not change environment variables, server settings, or stored timestamps.
 */
function prismaConnectionConfig(databaseUrl: string, inheritedOptions: string) {
  let connectionString = databaseUrl;
  let startupOptions = inheritedOptions;
  if (databaseUrl) {
    let url: URL;
    try {
      url = new URL(databaseUrl);
    } catch {
      throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL");
    }
    startupOptions =
      url.searchParams.getAll("options").at(-1) || inheritedOptions;
    startupOptions = `${startupOptions} -c timezone=UTC`.trim();
    url.searchParams.set("options", startupOptions);
    connectionString = url.toString();
  } else {
    startupOptions = `${startupOptions} -c timezone=UTC`.trim();
  }
  return { connectionString, options: startupOptions };
}

/**
 * Provides the shared Prisma client configured with the PostgreSQL adapter and managed by the Nest module lifecycle.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  /**
   * Creates the Prisma client with UTC sessions while preserving configured connection options.
   */
  constructor() {
    super({
      adapter: new PrismaPg(
        prismaConnectionConfig(
          process.env.DATABASE_URL ?? "",
          process.env.PGOPTIONS ?? "",
        ),
      ),
    });
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
