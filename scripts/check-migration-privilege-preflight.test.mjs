import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { checkMigrationPrivilegePreflight } from "./check-migration-privilege-preflight.mjs";

const require = createRequire(import.meta.url);
const { Client } = require(path.resolve(process.cwd(), "apps/api/node_modules/pg"));

test("check-migration-privilege-preflight: fails in production when .env.migration is missing", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-preflight-test-"));
  const envPm2 = path.join(tmpDir, ".env.pm2");
  fs.writeFileSync(envPm2, "DATABASE_URL=postgresql://api_user:pass@127.0.0.1:5432/db\n");
  const nonExistentMigration = path.join(tmpDir, ".env.migration.nonexistent");

  try {
    await assert.rejects(
      async () => {
        await checkMigrationPrivilegePreflight([
          "node",
          "script.mjs",
          "--env-file",
          envPm2,
          "--migration-env-file",
          nonExistentMigration,
          "--production",
        ]);
      },
      {
        message: /Migration credentials file is missing/,
      },
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("check-migration-privilege-preflight: fails in production when MIGRATION_DATABASE_URL equals DATABASE_URL", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-preflight-test-"));
  const envPm2 = path.join(tmpDir, ".env.pm2");
  const envMigration = path.join(tmpDir, ".env.migration");
  const sharedUrl = "postgresql://same_user:pass@127.0.0.1:5432/db";

  fs.writeFileSync(envPm2, `DATABASE_URL=${sharedUrl}\n`);
  fs.writeFileSync(envMigration, `MIGRATION_DATABASE_URL=${sharedUrl}\n`);

  try {
    await assert.rejects(
      async () => {
        await checkMigrationPrivilegePreflight([
          "node",
          "script.mjs",
          "--env-file",
          envPm2,
          "--migration-env-file",
          envMigration,
          "--production",
        ]);
      },
      {
        message: /MIGRATION_DATABASE_URL must be distinct from runtime DATABASE_URL/,
      },
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("check-migration-privilege-preflight: skips database probes in dry-run mode", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-preflight-test-"));
  const envPm2 = path.join(tmpDir, ".env.pm2");
  const envMigration = path.join(tmpDir, ".env.migration");

  fs.writeFileSync(
    envPm2,
    "DATABASE_URL=postgresql://api_user:pass@127.0.0.1:5432/db\n",
  );
  fs.writeFileSync(
    envMigration,
    "MIGRATION_DATABASE_URL=postgresql://mig_user:pass@127.0.0.1:5432/db\n",
  );

  try {
    const result = await checkMigrationPrivilegePreflight([
      "node",
      "script.mjs",
      "--env-file",
      envPm2,
      "--migration-env-file",
      envMigration,
      "--dry-run",
    ]);

    assert.equal(result.status, "SKIPPED");
    assert.equal(result.dryRun, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

const databaseUrl =
  process.env.LCSP328_TEST_DATABASE_URL || process.env.DATABASE_URL;

if (databaseUrl) {
  test("check-migration-privilege-preflight: real postgres probe validates privilege separation", async () => {
    const adminClient = new Client({ connectionString: databaseUrl });
    const suffix = Math.random().toString(36).slice(2, 8);
    const migRole = `mig_preflight_${suffix}`;
    const apiRole = `api_preflight_${suffix}`;
    const password = `Pass_${suffix}!123`;

    await adminClient.connect();

    const parseUrl = new URL(databaseUrl);
    const host = parseUrl.hostname;
    const port = parseUrl.port || "5432";
    const db = parseUrl.pathname.replace(/^\//u, "");

    const migUrl = `postgresql://${migRole}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
    const apiUrl = `postgresql://${apiRole}:${encodeURIComponent(password)}@${host}:${port}/${db}`;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-preflight-real-"));
    const envPm2 = path.join(tmpDir, ".env.pm2");
    const envMigration = path.join(tmpDir, ".env.migration");

    try {
      // Create migration role with CREATE and runtime role without CREATE
      await adminClient.query(`
        CREATE ROLE "${migRole}" WITH LOGIN PASSWORD '${password}';
        CREATE ROLE "${apiRole}" WITH LOGIN PASSWORD '${password}';
        GRANT CREATE ON SCHEMA public TO "${migRole}";
        REVOKE CREATE ON SCHEMA public FROM "${apiRole}";
      `);

      fs.writeFileSync(envPm2, `DATABASE_URL=${apiUrl}\n`);
      fs.writeFileSync(envMigration, `MIGRATION_DATABASE_URL=${migUrl}\n`);

      const receipt = await checkMigrationPrivilegePreflight([
        "node",
        "script.mjs",
        "--env-file",
        envPm2,
        "--migration-env-file",
        envMigration,
        "--production",
      ]);

      assert.equal(receipt.status, "PASS");
      assert.equal(receipt.production, true);
      assert.equal(receipt.migrationIdentity.canDdl, true);
      assert.equal(receipt.runtimeIdentity.canDdl, false);

      // Now test violation: if runtime role is granted CREATE on public, preflight must fail
      await adminClient.query(`GRANT CREATE ON SCHEMA public TO "${apiRole}";`);
      await assert.rejects(
        async () => {
          await checkMigrationPrivilegePreflight([
            "node",
            "script.mjs",
            "--env-file",
            envPm2,
            "--migration-env-file",
            envMigration,
            "--production",
          ]);
        },
        {
          message: /Least privilege violation: Runtime identity .* has unexpected CREATE privilege/,
        },
      );
    } finally {
      await adminClient.query(`
        DROP ROLE IF EXISTS "${apiRole}";
        DROP ROLE IF EXISTS "${migRole}";
      `).catch(() => {});
      await adminClient.end().catch(() => {});
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
}
