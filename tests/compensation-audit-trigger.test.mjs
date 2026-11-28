import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migrations = join(import.meta.dirname, "../apps/api/prisma/migrations");

test("compensation audit trigger preserves ordinary AuditEvent UPDATE values", () => {
  // The last definition wins after Prisma deploy; the original trigger returned
  // OLD on UPDATE, silently discarding assessment deletion payload redaction.
  const definitions = readdirSync(migrations)
    .filter((directory) => /^\d{14}_/.test(directory))
    .sort()
    .map((directory) =>
      readFileSync(join(migrations, directory, "migration.sql"), "utf8"),
    )
    .filter((sql) =>
      sql.includes('CREATE OR REPLACE FUNCTION "prevent_compensation_audit_event_mutation"'),
    );
  assert.ok(definitions.length > 0);
  const latest = definitions.at(-1);
  assert.match(latest, /IF OLD\."eventType" = 'billing\.debit\.compensated' THEN[\s\S]*RAISE EXCEPTION/);
  assert.match(latest, /IF TG_OP = 'UPDATE' THEN\s+RETURN NEW;/);
  assert.match(latest, /RETURN OLD;\s+END;/);
});
