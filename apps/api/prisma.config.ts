import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { defineConfig, env } from "prisma/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..", "..");

dotenv.config({ path: path.join(workspaceRoot, ".env") });
if (process.env.NODE_ENV === "test") {
  dotenv.config({
    path: path.join(workspaceRoot, ".env.test"),
  });
}

/**
 * Resolves the Prisma datasource URL enforcing least privilege separation.
 *
 * In production migration mode, MIGRATION_DATABASE_URL is strictly required
 * and cannot fall back to runtime DATABASE_URL.
 */
export function resolveDatasourceUrl(): string {
  const isMigrateCommand =
    process.argv.includes("migrate") ||
    process.env.PRISMA_MIGRATION_MODE === "true";
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && isMigrateCommand) {
    if (!process.env.MIGRATION_DATABASE_URL) {
      throw new Error(
        "MIGRATION_DATABASE_URL must be explicitly configured for production migrations. " +
          "Fallback to runtime DATABASE_URL is prohibited to prevent DDL privilege escalation or silent migration failures.",
      );
    }
    if (
      process.env.DATABASE_URL &&
      process.env.MIGRATION_DATABASE_URL === process.env.DATABASE_URL
    ) {
      throw new Error(
        "In production, MIGRATION_DATABASE_URL must be distinct from runtime DATABASE_URL " +
          "to enforce least-privilege separation between DDL migrations and DML API runtime.",
      );
    }
    return env("MIGRATION_DATABASE_URL");
  }

  if (process.env.MIGRATION_DATABASE_URL) {
    return env("MIGRATION_DATABASE_URL");
  }

  if (process.env.DATABASE_URL) {
    return env("DATABASE_URL");
  }

  return "postgresql://placeholder:placeholder@localhost:5432/placeholder";
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: resolveDatasourceUrl(),
  },
});
