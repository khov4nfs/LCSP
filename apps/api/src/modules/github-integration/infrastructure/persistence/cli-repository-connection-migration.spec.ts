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

const sql = readFileSync(
  resolveMigrationPath(
    "20260824160000_allow_cli_repository_connections/migration.sql",
  ),
  "utf8",
);

describe("CLI repository connection migration", () => {
  it("makes installationId nullable for the final authentication shape", () => {
    expect(sql).toContain('ALTER COLUMN "installationId" DROP NOT NULL');
  });

  it("does not introduce the removed authorization foreign key", () => {
    expect(sql).not.toContain("credentialAuthorization" + "Id");
    expect(sql).not.toMatch(/DROP\s+(INDEX|CONSTRAINT).*installationId/iu);
  });
});
