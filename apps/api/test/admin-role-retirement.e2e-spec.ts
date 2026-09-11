import { describe, expect, it } from "@jest/globals";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  ADMIN_ACCOUNT_OPERATIONS,
  AUTH_USER_ROLES,
} from "@lcsp/contracts/auth";

const databaseUrl = process.env.LCSP299_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("LCSP-299 retired Admin operation migration", () => {
  it("removes only retired receipts and preserves roles, audit and supported receipts", async () => {
    const url = new URL(databaseUrl!);
    if (
      url.hostname !== "127.0.0.1" ||
      url.port !== "55439" ||
      url.pathname !== "/lcsp_299_test"
    )
      throw new Error(
        "Migration regression requires the explicit disposable LCSP-299 database",
      );
    const client = new Client({ connectionString: databaseUrl });
    const schema = `lcsp299_retirement_${randomUUID().replaceAll("-", "")}`;
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      // Minimal pre-clarification persistence fixture. Execute the actual forward
      // migration unchanged, in a dedicated schema, without touching public data.
      await client.query(`
        CREATE TYPE "AdminAccountOperation" AS ENUM ('ROLE_CHANGE', 'SUSPEND', 'RESTORE', 'INVITE');
        CREATE TABLE "AdminAccountCommandReceipt" ("id" text PRIMARY KEY, "operation" "AdminAccountOperation" NOT NULL);
        CREATE TABLE "User" ("id" text PRIMARY KEY, "role" text NOT NULL);
        CREATE TABLE "AuditEvent" ("id" text PRIMARY KEY, "eventType" text NOT NULL);
        INSERT INTO "AdminAccountCommandReceipt" VALUES
          ('retired', 'ROLE_CHANGE'), ('suspend', 'SUSPEND'), ('restore', 'RESTORE'), ('invite', 'INVITE');
        INSERT INTO "AuditEvent" VALUES ('historical', 'AUTH_ADMIN_USER_ROLE_UPDATED');
      `);
      await client.query('INSERT INTO "User" VALUES ($1, $2), ($3, $4)', [
        "admin",
        AUTH_USER_ROLES.admin,
        "customer",
        AUTH_USER_ROLES.customer,
      ]);
      const sql = await readFile(
        new URL(
          "../prisma/migrations/20260911190000_retire_admin_role_mutation/migration.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await client.query(sql);
      const values = await client.query<{ value: string }>(
        `SELECT e.enumlabel AS value FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE t.typname = 'AdminAccountOperation' AND n.nspname = $1 ORDER BY e.enumlabel`,
        [schema],
      );
      expect(values.rows.map((row) => row.value)).toEqual(
        Object.values(ADMIN_ACCOUNT_OPERATIONS).sort(),
      );
      const receipts = await client.query<{ id: string }>(
        'SELECT "id" FROM "AdminAccountCommandReceipt" ORDER BY "id"',
      );
      expect(receipts.rows.map((row) => row.id)).toEqual([
        "invite",
        "restore",
        "suspend",
      ]);
      const users = await client.query<{ id: string; role: string }>(
        'SELECT * FROM "User" ORDER BY "id"',
      );
      expect(users.rows).toEqual([
        { id: "admin", role: AUTH_USER_ROLES.admin },
        { id: "customer", role: AUTH_USER_ROLES.customer },
      ]);
      const audit = await client.query<{ id: string; eventType: string }>(
        'SELECT * FROM "AuditEvent"',
      );
      expect(audit.rows).toEqual([
        { id: "historical", eventType: "AUTH_ADMIN_USER_ROLE_UPDATED" },
      ]);
      await expect(
        client.query(
          'INSERT INTO "AdminAccountCommandReceipt" VALUES ($1, $2)',
          ["forbidden", "ROLE_CHANGE"],
        ),
      ).rejects.toThrow();
    } finally {
      await client.query("ROLLBACK");
      await client.query("SET search_path TO public");
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  });
});
