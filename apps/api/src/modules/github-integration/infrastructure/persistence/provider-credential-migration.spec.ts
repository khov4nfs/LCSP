import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "@jest/globals";

function resolveMigrationPath(relativePath: string): string {
  const candidates = [
    resolve(process.cwd(), "prisma/migrations", relativePath),
    resolve(process.cwd(), "apps/api/prisma/migrations", relativePath),
  ];
  const match = candidates.find((candidate) => existsSync(candidate));
  if (!match) throw new Error(`migration_not_found:${relativePath}`);
  return match;
}

const migrationPath = resolveMigrationPath(
  "20260824120000_add_provider_credentials/migration.sql",
);

describe("provider credential migration", () => {
  it("explicitly backfills existing connections before enforcing the mode", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const add = sql.indexOf('ADD COLUMN "authenticationMode"');
    const backfill = sql.indexOf(
      `UPDATE "RepositoryConnection" SET "authenticationMode" = 'GITHUB_APP'`,
    );
    const required = sql.indexOf(
      'ALTER COLUMN "authenticationMode" SET NOT NULL',
    );
    expect(add).toBeGreaterThan(-1);
    expect(backfill).toBeGreaterThan(add);
    expect(required).toBeGreaterThan(backfill);
    expect(sql).not.toMatch(
      /UPDATE\s+"RepositoryConnection"\s+SET\s+"installationId"/iu,
    );
  });

  it("stores encrypted material as bytea and never adds a plaintext column", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain('"ciphertext" BYTEA');
    expect(sql).toContain('"wrappedDekCiphertext" BYTEA');
    expect(sql).not.toContain('CREATE TABLE "ProviderCredentialSecret"');
    expect(sql).not.toMatch(/"(plaintext|token|pat|secret)"\s/iu);
  });
});
