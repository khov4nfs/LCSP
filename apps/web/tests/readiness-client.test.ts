import * as assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { isReadinessPayload } from "../src/lib/api/readiness-client.ts";

test("readiness mock fixture satisfies the client payload contract", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL("../src/public/assets/mocks/readiness.json", import.meta.url),
      "utf8",
    ),
  );

  assert.equal(isReadinessPayload(fixture), true);
});

test("readiness payload rejects missing unknown-state projection", () => {
  assert.equal(
    isReadinessPayload({
      classification_locked: false,
      missing_evidence: [],
      readiness_mode: "READINESS_ONLY",
      completed_steps: [],
      next_action: "Continue preparation.",
      updated_at: "2026-08-04T00:00:00.000Z",
    }),
    false,
  );
});

test("readiness payload preserves the safe connected repository projection", () => {
  assert.equal(
    isReadinessPayload({
      classification_locked: true,
      missing_evidence: [],
      unresolved_unknown_items: [],
      readiness_mode: null,
      completed_steps: ["repository_connected"],
      next_action: "Wait for the repository scan to complete.",
      updated_at: "2026-08-26T00:00:00.000Z",
      repository_connection: {
        connection_id: "connection-1",
        provider: "GITLAB",
        repository_id: "project-1",
        repository_full_name: "group/project",
        default_branch: "main",
        status: "ACTIVE",
      },
    }),
    true,
  );
});

test("readiness client no longer exposes wizard readiness export helpers", async () => {
  const source = await readFile(
    new URL("../src/lib/api/readiness-client.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /generateReadinessExport/);
  assert.doesNotMatch(source, /isReadinessExportPayload/);
  assert.doesNotMatch(source, /wizard\/readiness-export/);
});
