import { readFile } from "node:fs/promises";
import { describe, expect, it } from "@jest/globals";

describe("assessment ADMIN metadata list indexes", () => {
  it("supports unfiltered and lifecycle-filtered ADMIN ordering", async () => {
    const [schema, migration] = await Promise.all([
      readFile(
        new URL("../../../../../prisma/schema.prisma", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../../../../../prisma/migrations/20261123130000_assessment_admin_metadata_indexes/migration.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);

    // ADMIN list predicates do not include ownerId, so owner-prefixed indexes cannot
    // serve either sort shape efficiently as the Assessment table grows.
    expect(schema).toContain("@@index([updatedAt(sort: Desc), id])");
    expect(schema).toContain(
      "@@index([lifecycleState, updatedAt(sort: Desc), id])",
    );
    expect(migration).toContain('"Assessment_updatedAt_id_idx"');
    expect(migration).toContain('"Assessment_lifecycleState_updatedAt_id_idx"');
    // Production index builds must not block Assessment writes while a large table is scanned.
    expect(migration.match(/CREATE INDEX CONCURRENTLY/g)).toHaveLength(2);
  });
});
