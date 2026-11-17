import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

const migration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20261116190000_repository_discovery_expansions/migration.sql",
  ),
  "utf-8",
);

describe("repository discovery expansion migration", () => {
  it("is additive and preserves immutable historical discovery rows", () => {
    expect(migration).toContain(
      'CREATE TABLE "AssessmentRepositoryDiscoveryExpansion"',
    );
    expect(migration).toContain(
      'REFERENCES "AssessmentRepositoryDiscovery"("recordId", "assessmentId")',
    );
    expect(migration).toContain(
      'CREATE TRIGGER "AssessmentRepositoryDiscoveryExpansion_immutable_guard"',
    );
    expect(migration).not.toMatch(
      /\b(?:DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM|UPDATE\s+[^;]+\s+SET)\b/i,
    );
  });

  it("binds events to content integrity and bounded structured metadata", () => {
    expect(migration).toContain(
      "\"discoveryContentDigest\" ~ '^sha256:[a-f0-9]{64}$'",
    );
    expect(migration).toContain(
      "jsonb_typeof(\"assessmentRuleIds\") = 'array'",
    );
    expect(migration).toContain("jsonb_typeof(\"trace\") = 'object'");
    expect(migration).toContain(
      "\"idempotencyKey\" ~ '^discovery-expansion:[a-f0-9]{64}$'",
    );
  });
});
