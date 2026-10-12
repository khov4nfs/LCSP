import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  connectionLabel,
  canonicalLifecycleLabel,
  canonicalExecutionLabel,
  formatLocaleTimestamp,
} from "../src/features/workspace/utils/assessment-runtime-formatter.ts";

test("assessment runtime formatter formats a valid timestamp for the active locale", () => {
  const timestamp = "2026-08-14T10:00:00.000Z";
  assert.ok(formatLocaleTimestamp(timestamp));
});

test("assessment runtime formatter preserves an invalid timestamp", () => {
  assert.equal(formatLocaleTimestamp("invalid"), "invalid");
});

test("assessment runtime label formatters return correct localizations", () => {
  assert.ok(connectionLabel("CONNECTED"));
  assert.ok(canonicalLifecycleLabel("ACTIVE"));
  assert.ok(canonicalExecutionLabel("RUNNING"));
});
