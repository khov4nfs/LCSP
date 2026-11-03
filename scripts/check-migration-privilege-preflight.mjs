#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import dotenv from "dotenv";

const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const options = {
    envFile: ".env.pm2",
    migrationEnvFile: ".env.migration",
    production: false,
    dryRun: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--env-file" && argv[i + 1]) {
      options.envFile = argv[++i];
    } else if (arg === "--migration-env-file" && argv[i + 1]) {
      options.migrationEnvFile = argv[++i];
    } else if (arg === "--production") {
      options.production = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    }
  }

  return options;
}

function sanitizeUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.protocol}//${parsed.username}:***@${parsed.host}${parsed.pathname}`;
  } catch {
    return "[MALFORMED_URL]";
  }
}

/**
 * Business purpose: Validate strict least-privilege separation between DDL migration credentials and DML runtime credentials before deployment.
 *
 * Business rules:
 * - Production deployments require an isolated migration secret file containing MIGRATION_DATABASE_URL.
 * - Runtime configuration (.env.pm2) must provide DATABASE_URL for runtime services and must not contain MIGRATION_DATABASE_URL.
 * - In production, MIGRATION_DATABASE_URL and DATABASE_URL must authenticate under distinct database users.
 * - Migration user identity must possess CREATE/DDL privileges on the target schema.
 * - Runtime user identity must NOT possess CREATE/DDL privileges on the target schema (least-privilege DML boundary).
 *
 * Execution flow:
 * 1. Parse command-line options and locate environment configuration files.
 * 2. Validate existence of required environment files and reject any leaked migration credentials in runtime config.
 * 3. Enforce distinct URLs in production mode.
 * 4. Probe PostgreSQL via MIGRATION_DATABASE_URL to confirm DDL schema privilege.
 * 5. Probe PostgreSQL via DATABASE_URL to confirm least-privilege restriction (no DDL schema privilege in production).
 * 6. Emit a sanitized validation receipt and exit cleanly.
 *
 * Failure cases:
 * - Missing migration credentials file in production fails deployment preflight.
 * - Leaked MIGRATION_DATABASE_URL in runtime configuration aborts with least-privilege violation.
 * - Identical migration and runtime URLs in production aborts with least-privilege violation.
 * - Database connection failure or missing DDL privilege on migration role exits with code 1.
 * - Runtime identity having DDL privileges in production exits with code 1.
 *
 * Side effects:
 * - Read-only queries to pg_catalog metadata (current_user, has_schema_privilege); zero state or table mutations.
 */
export async function checkMigrationPrivilegePreflight(argv = process.argv) {
  const options = parseArgs(argv);

  const envFilePath = path.resolve(process.cwd(), options.envFile);
  const migrationFilePath = path.resolve(process.cwd(), options.migrationEnvFile);

  const isProduction =
    options.production || process.env.NODE_ENV === "production";

  if (isProduction && !fs.existsSync(migrationFilePath)) {
    throw new Error(
      `Production deployment preflight failed: Migration credentials file is missing at '${migrationFilePath}'. ` +
        "Dedicated migration credentials with DDL privileges must be provisioned in .env.migration.",
    );
  }

  const runtimeEnv = fs.existsSync(envFilePath)
    ? dotenv.parse(fs.readFileSync(envFilePath))
    : {};
  const migrationEnv = fs.existsSync(migrationFilePath)
    ? dotenv.parse(fs.readFileSync(migrationFilePath))
    : {};

  if (runtimeEnv.MIGRATION_DATABASE_URL) {
    throw new Error(
      `Least privilege security violation: MIGRATION_DATABASE_URL was found inside runtime configuration file '${envFilePath}'. ` +
        "Privileged migration credentials must never be defined in runtime environment (.env.pm2).",
    );
  }

  const runtimeUrl = runtimeEnv.DATABASE_URL || process.env.DATABASE_URL;
  const migrationUrl =
    migrationEnv.MIGRATION_DATABASE_URL || process.env.MIGRATION_DATABASE_URL;

  if (isProduction) {
    if (!migrationUrl) {
      throw new Error(
        `Production deployment preflight failed: MIGRATION_DATABASE_URL is missing in '${migrationFilePath}'.`,
      );
    }
    if (!runtimeUrl) {
      throw new Error(
        `Production deployment preflight failed: DATABASE_URL is missing in '${envFilePath}'.`,
      );
    }
    if (migrationUrl === runtimeUrl) {
      throw new Error(
        "Production deployment preflight failed: MIGRATION_DATABASE_URL must be distinct from runtime DATABASE_URL. " +
          "Runtime role must remain least-privileged (DML only) and separated from privileged migration DDL role.",
      );
    }
  }

  if (options.dryRun || (!migrationUrl && !runtimeUrl)) {
    return {
      status: "SKIPPED",
      dryRun: true,
      production: isProduction,
    };
  }

  let Client;
  try {
    const pkgPath = path.resolve(process.cwd(), "apps/api/package.json");
    Client = require(pkgPath).name ? require("pg").Client : null;
  } catch {
    try {
      Client = require(path.resolve(process.cwd(), "apps/api/node_modules/pg")).Client;
    } catch {
      Client = (await import("pg")).Client;
    }
  }

  let migrationUser = null;
  let migrationCanDdl = null;
  if (migrationUrl) {
    const migrationClient = new Client({
      connectionString: migrationUrl,
      connectionTimeoutMillis: 5000,
    });
    try {
      await migrationClient.connect();
      const res = await migrationClient.query(
        "SELECT current_user AS user, session_user, has_schema_privilege(current_user, 'public', 'CREATE') AS can_create;",
      );
      migrationUser = res.rows[0]?.user;
      migrationCanDdl = Boolean(res.rows[0]?.can_create);
    } finally {
      await migrationClient.end().catch(() => {});
    }

    if (!migrationCanDdl) {
      throw new Error(
        `Migration identity '${migrationUser}' connected via MIGRATION_DATABASE_URL (${sanitizeUrl(migrationUrl)}) ` +
          "does not have CREATE privilege on schema 'public'. DDL migrations will fail.",
      );
    }
  }

  let runtimeUser = null;
  let runtimeCanDdl = null;
  if (runtimeUrl) {
    const runtimeClient = new Client({
      connectionString: runtimeUrl,
      connectionTimeoutMillis: 5000,
    });
    try {
      await runtimeClient.connect();
      const res = await runtimeClient.query(
        "SELECT current_user AS user, session_user, has_schema_privilege(current_user, 'public', 'CREATE') AS can_create;",
      );
      runtimeUser = res.rows[0]?.user;
      runtimeCanDdl = Boolean(res.rows[0]?.can_create);
    } finally {
      await runtimeClient.end().catch(() => {});
    }

    if (isProduction && runtimeCanDdl) {
      throw new Error(
        `Least privilege violation: Runtime identity '${runtimeUser}' connected via DATABASE_URL (${sanitizeUrl(runtimeUrl)}) ` +
          "has unexpected CREATE privilege on schema 'public'. Runtime role must be restricted to DML only.",
      );
    }
  }

  const receipt = {
    observedAt: new Date().toISOString(),
    status: "PASS",
    production: isProduction,
    migrationIdentity: {
      user: migrationUser,
      canDdl: migrationCanDdl,
      target: migrationUrl ? sanitizeUrl(migrationUrl) : null,
    },
    runtimeIdentity: {
      user: runtimeUser,
      canDdl: runtimeCanDdl,
      target: runtimeUrl ? sanitizeUrl(runtimeUrl) : null,
    },
    privilegeSeparationEnforced: isProduction,
  };

  return receipt;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  checkMigrationPrivilegePreflight()
    .then((receipt) => {
      console.log(JSON.stringify(receipt, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(`==> Preflight check failed: ${err.message}`);
      process.exit(1);
    });
}
