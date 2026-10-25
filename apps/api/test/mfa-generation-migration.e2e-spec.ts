import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "pg";

/**
 * Execute the actual migration against transaction-scoped legacy tables.
 * A TEMP table shadows its public counterpart and ROLLBACK removes the fixture.
 */
const databaseUrl = process.env.DATABASE_URL;
const allowed = (() => {
  if (!databaseUrl || process.env.NODE_ENV === "production") return false;
  try {
    const url = new URL(databaseUrl);
    return (
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
      /^lcsp_[a-z0-9_]*test$|^lcsp_api_e2e$|^lcsp_mfa_[a-z0-9_]+$/.test(
        url.pathname.slice(1),
      )
    );
  } catch {
    return false;
  }
})();
const integration = allowed ? describe : describe.skip;

integration(
  "MFA generation migration on existing account credentials (e2e)",
  () => {
    it("backfills prior sessions/codes, preserves proofs and skips unrelated records", async () => {
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        await client.query("BEGIN");
        await client.query('CREATE TEMP TABLE "User" ("id" TEXT PRIMARY KEY);');
        await client.query(
          'CREATE TEMP TABLE "AuthRecord" (' +
            '"id" TEXT PRIMARY KEY, "userId" TEXT, ' +
            '"type" public."AuthRecordType" NOT NULL, "metadata" JSONB);',
        );
        await client.query('INSERT INTO "User" ("id") VALUES ($1), ($2)', [
          "migration-user-a",
          "migration-user-b",
        ]);

        const records = [
          {
            id: "session-verified",
            userId: "migration-user-a",
            type: "SESSION",
            metadata: {
              accessVersion: 3,
              mfaVerifiedAt: "2026-10-24T10:00:00.000Z",
              sensitiveActionVerifiedAt: "2026-10-24T10:05:00.000Z",
              theme: "light",
            },
          },
          {
            id: "session-unverified",
            userId: "migration-user-a",
            type: "SESSION",
            metadata: { accessVersion: 3, mfaVerifiedAt: null },
          },
          {
            id: "code-existing",
            userId: "migration-user-a",
            type: "MFA_RECOVERY_CODE",
            metadata: {
              batchId: "legacy-batch",
              accountLabel: "before-migration",
            },
          },
          {
            id: "unrelated-token",
            userId: "migration-user-b",
            type: "RECOVERY_REQUEST",
            metadata: { issuedTo: "fixture" },
          },
        ];
        for (const record of records) {
          await client.query(
            'INSERT INTO "AuthRecord" ("id", "userId", "type", "metadata") ' +
              'VALUES ($1, $2, $3::public."AuthRecordType", $4::jsonb)',
            [
              record.id,
              record.userId,
              record.type,
              JSON.stringify(record.metadata),
            ],
          );
        }

        const migrationSql = readFileSync(
          new URL(
            "../prisma/migrations/20261024220000_auth_mfa_proof_generation/migration.sql",
            import.meta.url,
          ),
          "utf8",
        );
        await client.query(migrationSql);

        const ownerRows = await client.query<{
          id: string;
          mfaGenerationId: string;
        }>('SELECT "id", "mfaGenerationId" FROM "User" ORDER BY "id"');
        assert.equal(ownerRows.rows.length, 2);
        const generations = new Map(
          ownerRows.rows.map((row) => [row.id, row.mfaGenerationId]),
        );
        assert.ok(generations.get("migration-user-a"));
        assert.ok(generations.get("migration-user-b"));
        assert.notEqual(
          generations.get("migration-user-a"),
          generations.get("migration-user-b"),
        );

        const migrated = await client.query<{
          id: string;
          metadata: Record<string, unknown>;
        }>('SELECT "id", "metadata" FROM "AuthRecord" ORDER BY "id"');
        assert.equal(migrated.rows.length, 4);
        const byId = new Map(
          migrated.rows.map((row) => [row.id, row.metadata]),
        );
        for (const id of [
          "session-verified",
          "session-unverified",
          "code-existing",
        ]) {
          assert.equal(
            byId.get(id)?.mfaGenerationId,
            generations.get("migration-user-a"),
            "Legacy session/recovery code must bind to its account generation",
          );
        }
        assert.equal(
          byId.get("session-verified")?.mfaVerifiedAt,
          "2026-10-24T10:00:00.000Z",
        );
        assert.equal(
          byId.get("session-verified")?.sensitiveActionVerifiedAt,
          "2026-10-24T10:05:00.000Z",
        );
        assert.equal(byId.get("session-verified")?.accessVersion, 3);
        assert.equal(byId.get("session-verified")?.theme, "light");
        assert.equal(byId.get("code-existing")?.batchId, "legacy-batch");
        assert.equal(
          byId.get("code-existing")?.accountLabel,
          "before-migration",
        );
        assert.equal(byId.get("unrelated-token")?.mfaGenerationId, undefined);
        assert.equal(byId.get("unrelated-token")?.issuedTo, "fixture");
      } finally {
        await client.query("ROLLBACK").finally(() => client.end());
      }
    });
  },
);
