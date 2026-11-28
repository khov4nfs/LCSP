import { Injectable, Optional } from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import type { AppConfig } from "../../config/config.types.js";

/**
 * Business purpose:
 * Validates the database connection string and ensures persisted instants and runtime lease checks
 * strictly encode dates in UTC through the PostgreSQL adapter options.
 *
 * Business rules:
 * - Database URL must be non-empty and specify either postgresql: or postgres: protocol.
 * - Every Prisma connection uses UTC, regardless of server, role, database, or URL timezone defaults.
 * - Preserve connection credentials and existing startup options; URL options take precedence over PGOPTIONS.
 *
 * Execution flow:
 * 1. Validate that the connection string is non-empty and well-formed.
 * 2. Assert that the protocol is PostgreSQL-compatible.
 * 3. Resolve existing startup options from searchParams or PGOPTIONS.
 * 4. Append the `-c timezone=UTC` flag to force UTC timezone on the database session.
 * 5. Return the finalized connection string and option string for the PrismaPg adapter.
 *
 * Failure cases:
 * - Empty or blank database URL throws descriptive configuration error.
 * - Non-PostgreSQL protocols (e.g. mysql:, http:) throw descriptive validation error without leaking credentials.
 * - Malformed URL strings throw descriptive error without printing credentials.
 *
 * Side effects:
 * - Pure configuration transformation; does not alter environment variables, files, or persistent state.
 *
 * @param databaseUrl - Target PostgreSQL connection URL.
 * @param inheritedOptions - Driver options inherited from the process environment (e.g. PGOPTIONS).
 * @returns Object containing the UTC-enforced connection string and options.
 */
export function prismaConnectionConfig(
  databaseUrl: string,
  inheritedOptions: string,
): { connectionString: string; options: string } {
  // Rationale: Guard against silent connection crashes caused by empty connection strings in PrismaPg adapter.
  const trimmed = databaseUrl?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new Error(
      "DATABASE_URL must be a non-empty PostgreSQL connection URL",
    );
  }

  // Mechanism: Parse via standard URL to validate scheme and preserve search params cleanly.
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL");
  }

  // Invariant: Enforce PostgreSQL scheme to prevent accidental non-Postgres connection attempts.
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL");
  }

  let startupOptions =
    url.searchParams.getAll("options").at(-1) || inheritedOptions;
  startupOptions = `${startupOptions} -c timezone=UTC`.trim();
  url.searchParams.set("options", startupOptions);

  return { connectionString: url.toString(), options: startupOptions };
}

/**
 * Provides the shared Prisma client configured with the PostgreSQL adapter and managed by the Nest module lifecycle.
 *
 * Rationale: Centralizes database access and enforces UTC session handling across the application.
 * Mechanism: Resolves database connection credentials from ConfigService (or fallback process.env) and manages connection lifecycle.
 * Invariants: Single database connection pool per Nest application instance; always connects on boot and disconnects on shutdown.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  readonly databaseTarget: Readonly<{ hostname: string; pathname: string }>;

  /**
   * Creates the Prisma client with UTC sessions while resolving configuration from ConfigService.
   *
   * @param configService - Optional Nest ConfigService injected via DI container.
   */
  constructor(
    @Optional()
    private readonly configService?: ConfigService<AppConfig, true>,
  ) {
    const databaseUrl =
      configService?.get("database", { infer: true })?.url ||
      process.env.DATABASE_URL ||
      "";
    const inheritedOptions = process.env.PGOPTIONS ?? "";
    const connection = prismaConnectionConfig(databaseUrl, inheritedOptions);
    const target = new URL(connection.connectionString);

    super({
      adapter: new PrismaPg(connection),
    });
    // Why: Isolated diagnostic guards must inspect the database actually bound to this Prisma client.
    // How: Retain only non-secret host/name fields from the adapter's resolved connection URL.
    // Invariant: Neither credentials nor the raw DATABASE_URL are exposed to callers or logs.
    this.databaseTarget = Object.freeze({
      hostname: target.hostname,
      pathname: target.pathname,
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
