import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
  connectionLabel,
  runStatusLabel,
  stageLabel,
  runtimeEventLabel,
  formatTimelineTime,
} from "../src/features/workspace/utils/assessment-runtime-formatter.ts";

test("assessment runtime formatter returns stable timestamp when not hydrated", () => {
  const timestamp = "2026-08-14T10:00:00.000Z";
  const result = formatTimelineTime(timestamp, false);
  assert.equal(result, timestamp);
});

test("assessment runtime formatter returns relative time when hydrated", () => {
  const now = Date.now();
  const past30s = new Date(now - 30 * 1000).toISOString();
  const past5m = new Date(now - 5 * 60 * 1000).toISOString();
  const past2h = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const past3d = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();

  assert.match(formatTimelineTime(past30s, true), /^\d+s$/);
  assert.match(formatTimelineTime(past5m, true), /^\d+m$/);
  assert.match(formatTimelineTime(past2h, true), /^\d+h$/);
  assert.match(formatTimelineTime(past3d, true), /^\d+d$/);
});

test("assessment runtime label formatters return correct localizations", () => {
  assert.ok(connectionLabel("CONNECTED"));
  assert.ok(runStatusLabel("RUNNING"));
  assert.ok(stageLabel("TECHNICAL_EVIDENCE"));
  assert.ok(runtimeEventLabel("RUN_STARTED"));
});
