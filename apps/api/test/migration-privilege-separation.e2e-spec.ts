import { beforeAll, describe, expect, it } from "@jest/globals";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { resolveDatasourceUrl } from "../prisma.config.js";

interface LedgerRow {
  id: string;
  balance: number;
  description: string | null;
}

function assertDisposableDatabase(url: string | undefined): void {
  if (!url) {
    throw new Error(
      "Dedicated local disposable test database required: DATABASE_URL must be defined",
    );
  }
  const parsed = new URL(url);
  const isLocal = ["127.0.0.1", "localhost"].includes(parsed.hostname);
  const dbName = parsed.pathname.replace(/^\//u, "");
  const isDisposable =
    ["lcsp_api_test", "lcsp_api_e2e", "lcsp364_capacity"].includes(dbName) ||
    dbName.endsWith("_test") ||
    dbName.endsWith("_e2e");
  if (!isLocal || !isDisposable) {
    throw new Error(
      "Refusing execution on non-disposable database. Dedicated local disposable test database required (localhost/127.0.0.1 and name matching lcsp_api_test, lcsp_api_e2e, lcsp364_capacity, *_test, or *_e2e).",
    );
  }
}

const databaseUrl =
  process.env.LCSP328_TEST_DATABASE_URL || process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

describe("Prisma configuration fail-closed resolution", () => {
  const originalEnv = { ...process.env };
  const originalArgv = [...process.argv];

  afterEach(() => {
    process.env = { ...originalEnv };
    process.argv = [...originalArgv];
  });

  it("fails closed in production migration mode when MIGRATION_DATABASE_URL is missing", () => {
    process.env.NODE_ENV = "production";
    process.env.PRISMA_MIGRATION_MODE = "true";
    delete process.env.MIGRATION_DATABASE_URL;
    process.env.DATABASE_URL =
      "postgresql://runtime_api:pass@127.0.0.1:5432/lcsp_prod";

    expect(() => resolveDatasourceUrl()).toThrow(
      /MIGRATION_DATABASE_URL must be explicitly configured for production migrations/,
    );
  });

  it("fails closed in production migration mode when MIGRATION_DATABASE_URL matches runtime DATABASE_URL", () => {
    process.env.NODE_ENV = "production";
    process.env.PRISMA_MIGRATION_MODE = "true";
    const sharedUrl = "postgresql://shared_user:pass@127.0.0.1:5432/lcsp_prod";
    process.env.MIGRATION_DATABASE_URL = sharedUrl;
    process.env.DATABASE_URL = sharedUrl;

    expect(() => resolveDatasourceUrl()).toThrow(
      /In production, MIGRATION_DATABASE_URL must be distinct from runtime DATABASE_URL/,
    );
  });

  it("fails closed in production migration mode when MIGRATION_DATABASE_URL and DATABASE_URL target different databases", () => {
    process.env.NODE_ENV = "production";
    process.env.PRISMA_MIGRATION_MODE = "true";
    process.env.MIGRATION_DATABASE_URL =
      "postgresql://migration_admin:pass@127.0.0.1:5432/lcsp_migrations";
    process.env.DATABASE_URL =
      "postgresql://runtime_api:pass@127.0.0.1:5432/lcsp_prod";

    expect(() => resolveDatasourceUrl()).toThrow(
      /Both connection URLs must target the exact same database/,
    );
  });

  it("resolves MIGRATION_DATABASE_URL in production when distinct migration credentials are provided", () => {
    process.env.NODE_ENV = "production";
    process.env.PRISMA_MIGRATION_MODE = "true";
    process.env.MIGRATION_DATABASE_URL =
      "postgresql://migration_admin:pass@127.0.0.1:5432/lcsp_prod";
    process.env.DATABASE_URL =
      "postgresql://runtime_api:pass@127.0.0.1:5432/lcsp_prod";

    expect(resolveDatasourceUrl()).toBe(process.env.MIGRATION_DATABASE_URL);
  });

  it("allows prisma generate / nest build in production without requiring migration credentials", () => {
    process.env.NODE_ENV = "production";
    delete process.env.PRISMA_MIGRATION_MODE;
    process.argv = ["node", "nest", "build"];
    delete process.env.MIGRATION_DATABASE_URL;
    process.env.DATABASE_URL =
      "postgresql://runtime_api:pass@127.0.0.1:5432/lcsp_prod";

    expect(resolveDatasourceUrl()).toBe(process.env.DATABASE_URL);
  });

  it("gracefully falls back to DATABASE_URL in test/development environments", () => {
    process.env.NODE_ENV = "test";
    delete process.env.MIGRATION_DATABASE_URL;
    process.env.DATABASE_URL =
      "postgresql://dev_user:pass@127.0.0.1:5432/lcsp_dev";

    expect(resolveDatasourceUrl()).toBe(process.env.DATABASE_URL);
  });
});

integration("PostgreSQL DDL/DML privilege separation", () => {
  beforeAll(() => {
    assertDisposableDatabase(databaseUrl);
  });

  it("enforces that migration role can execute DDL while runtime role is restricted to DML only", async () => {
    const adminClient = new Client({ connectionString: databaseUrl });
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const schemaName = `lcsp_priv_test_${suffix}`;
    const migRole = `mig_role_${suffix}`;
    const apiRole = `api_role_${suffix}`;
    const migPassword = `MigPass_${suffix}!123`;
    const apiPassword = `ApiPass_${suffix}!123`;

    await adminClient.connect();

    const parseDbUrl = new URL(databaseUrl!);
    const baseHost = parseDbUrl.hostname;
    const basePort = parseDbUrl.port || "5432";
    const baseDb = parseDbUrl.pathname.replace(/^\//u, "");

    const migConnectionUrl = `postgresql://${migRole}:${encodeURIComponent(migPassword)}@${baseHost}:${basePort}/${baseDb}`;
    const apiConnectionUrl = `postgresql://${apiRole}:${encodeURIComponent(apiPassword)}@${baseHost}:${basePort}/${baseDb}`;

    try {
      // 1. Provision roles and schema with admin connection
      await adminClient.query(`
        CREATE ROLE "${migRole}" WITH LOGIN PASSWORD '${migPassword}';
        CREATE ROLE "${apiRole}" WITH LOGIN PASSWORD '${apiPassword}';
        CREATE SCHEMA "${schemaName}" AUTHORIZATION "${migRole}";
        GRANT USAGE, CREATE ON SCHEMA "${schemaName}" TO "${migRole}";
        GRANT USAGE ON SCHEMA "${schemaName}" TO "${apiRole}";
      `);

      // 2. Migration role performs DDL operations
      const migClient = new Client({ connectionString: migConnectionUrl });
      await migClient.connect();
      try {
        await migClient.query(`SET search_path TO "${schemaName}";`);

        // Create table (DDL)
        await migClient.query(`
          CREATE TABLE "${schemaName}"."account_ledger" (
            "id" text PRIMARY KEY,
            "balance" int NOT NULL DEFAULT 0,
            "created_at" timestamptz NOT NULL DEFAULT now()
          );
        `);

        // Alter table (DDL)
        await migClient.query(`
          ALTER TABLE "${schemaName}"."account_ledger"
          ADD COLUMN "description" text;
        `);

        // Create index (DDL)
        await migClient.query(`
          CREATE INDEX "idx_ledger_created" ON "${schemaName}"."account_ledger" ("created_at");
        `);

        // Grant least-privilege DML to runtime role
        await migClient.query(`
          GRANT SELECT, INSERT, UPDATE, DELETE ON "${schemaName}"."account_ledger" TO "${apiRole}";
        `);
      } finally {
        await migClient.end();
      }

      // 3. API runtime role performs DML operations
      const apiClient = new Client({ connectionString: apiConnectionUrl });
      await apiClient.connect();
      try {
        await apiClient.query(`SET search_path TO "${schemaName}";`);

        // DML: INSERT must succeed
        await apiClient.query(
          `INSERT INTO "${schemaName}"."account_ledger" ("id", "balance", "description") VALUES ($1, $2, $3);`,
          ["rec-1", 1000, "Initial credit"],
        );

        // DML: SELECT must succeed
        const selectRes = await apiClient.query<LedgerRow>(
          `SELECT "id", "balance", "description" FROM "${schemaName}"."account_ledger" WHERE "id" = $1;`,
          ["rec-1"],
        );
        expect(selectRes.rows).toHaveLength(1);
        expect(selectRes.rows[0]?.balance).toBe(1000);

        // DML: UPDATE must succeed
        await apiClient.query(
          `UPDATE "${schemaName}"."account_ledger" SET "balance" = $1 WHERE "id" = $2;`,
          [1500, "rec-1"],
        );

        // DML: DELETE must succeed
        await apiClient.query(
          `DELETE FROM "${schemaName}"."account_ledger" WHERE "id" = $1;`,
          ["rec-1"],
        );

        // 4. API runtime role must FAIL when attempting DDL
        let ddlFailed = false;
        try {
          await apiClient.query(
            `CREATE TABLE "${schemaName}"."unauthorized_table" ("id" text PRIMARY KEY);`,
          );
        } catch (error: unknown) {
          ddlFailed = true;
          const pgError = error as { code?: string };
          // PostgreSQL error code 42501: insufficient_privilege
          expect(pgError.code).toBe("42501");
        }
        expect(ddlFailed).toBe(true);

        // API runtime role cannot drop table
        let dropFailed = false;
        try {
          await apiClient.query(`DROP TABLE "${schemaName}"."account_ledger";`);
        } catch (error: unknown) {
          dropFailed = true;
          const pgError = error as { code?: string };
          expect(pgError.code).toBe("42501");
        }
        expect(dropFailed).toBe(true);

        // API runtime role cannot alter table
        let alterFailed = false;
        try {
          await apiClient.query(
            `ALTER TABLE "${schemaName}"."account_ledger" ADD COLUMN "unauthorized_col" text;`,
          );
        } catch (error: unknown) {
          alterFailed = true;
          const pgError = error as { code?: string };
          expect(pgError.code).toBe("42501");
        }
        expect(alterFailed).toBe(true);
      } finally {
        await apiClient.end();
      }
    } finally {
      // 5. Teardown test schema and roles safely
      await adminClient.query(`
        DROP SCHEMA IF EXISTS "${schemaName}" CASCADE;
        DROP ROLE IF EXISTS "${apiRole}";
        DROP ROLE IF EXISTS "${migRole}";
      `);
      await adminClient.end();
    }
  });
});
