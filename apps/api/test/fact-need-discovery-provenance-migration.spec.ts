import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@jest/globals";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../prisma/migrations/20261116210000_fact_need_discovery_provenance/migration.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("FactNeed discovery provenance additive migration", () => {
  it("adds nullable provenance without rewriting historical FactNeeds", () => {
    expect(migration).toContain(
      'ADD COLUMN "investigationDiscoveryRefs" JSONB',
    );
    expect(migration).not.toMatch(/"investigationDiscoveryRefs"[^;]*NOT NULL/i);
    expect(migration).not.toMatch(
      /^\s*(?:UPDATE|DELETE\s+FROM|DROP\s+TABLE|TRUNCATE\s+TABLE)\b/im,
    );
  });
});
