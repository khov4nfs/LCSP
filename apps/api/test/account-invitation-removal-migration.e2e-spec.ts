import { describe, expect, it } from "@jest/globals";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ADMIN_ACCOUNT_OPERATIONS } from "@lcsp/contracts/auth";

const databaseUrl =
  process.env.LCSP328_TEST_DATABASE_URL || process.env.DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("LCSP-328 Account invitation removal migration", () => {
  it("safely drops AccountInvitation and cleans up historical INVITE command receipts", async () => {
    const client = new Client({ connectionString: databaseUrl });
    const schema = `lcsp328_migration_${randomUUID().replaceAll("-", "")}`;
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);

      // 1. Seed pre-LCSP-328 state with AccountInvitation table and AdminAccountOperation containing INVITE
      await client.query(`
        CREATE TYPE "AccountInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');
        CREATE TYPE "InvitationDeliveryStatus" AS ENUM ('DELIVERED', 'FAILED');
        CREATE TABLE "AccountInvitation" (
          "id" text PRIMARY KEY,
          "email" text NOT NULL,
          "status" "AccountInvitationStatus" NOT NULL DEFAULT 'PENDING',
          "deliveryStatus" "InvitationDeliveryStatus" NOT NULL DEFAULT 'DELIVERED'
        );
        CREATE TYPE "AdminAccountOperation" AS ENUM ('SUSPEND', 'RESTORE', 'INVITE');
        CREATE TABLE "AdminAccountCommandReceipt" (
          "id" text PRIMARY KEY,
          "operation" "AdminAccountOperation" NOT NULL
        );

        INSERT INTO "AccountInvitation" ("id", "email") VALUES ('inv_1', 'user@example.com');
        INSERT INTO "AdminAccountCommandReceipt" ("id", "operation") VALUES
          ('historical_invite_1', 'INVITE'),
          ('historical_invite_2', 'INVITE'),
          ('active_suspend', 'SUSPEND'),
          ('active_restore', 'RESTORE');
      `);

      // 2. Read and apply the forward migration
      const sql = await readFile(
        new URL(
          "../prisma/migrations/20260918203000_drop_account_invitation/migration.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await client.query(sql);

      // 3. Verify AccountInvitation table is dropped
      const tableCheck = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT FROM information_schema.tables 
           WHERE table_schema = $1 AND table_name = 'AccountInvitation'
         ) AS exists`,
        [schema],
      );
      expect(tableCheck.rows[0].exists).toBe(false);

      // 4. Verify AdminAccountOperation enum contains only SUSPEND and RESTORE
      const enumValues = await client.query<{ value: string }>(
        `SELECT e.enumlabel AS value FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE t.typname = 'AdminAccountOperation' AND n.nspname = $1 ORDER BY e.enumlabel`,
        [schema],
      );
      expect(enumValues.rows.map((row) => row.value)).toEqual(
        Object.values(ADMIN_ACCOUNT_OPERATIONS).sort(),
      );

      // 5. Verify only supported receipts remain (historical INVITE deleted)
      const receipts = await client.query<{ id: string; operation: string }>(
        'SELECT "id", "operation" FROM "AdminAccountCommandReceipt" ORDER BY "id"',
      );
      expect(receipts.rows).toEqual([
        { id: "active_restore", operation: "RESTORE" },
        { id: "active_suspend", operation: "SUSPEND" },
      ]);

      // 6. Verify inserting INVITE now fails at Postgres enum level
      await expect(
        client.query(
          'INSERT INTO "AdminAccountCommandReceipt" VALUES ($1, $2)',
          ["invalid_invite", "INVITE"],
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
