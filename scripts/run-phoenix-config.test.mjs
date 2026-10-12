import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./run.mjs", import.meta.url), "utf8");

test("Phoenix dev server defaults to loopback and remains explicitly configurable", () => {
  assert.match(
    source,
    /const defaultPhoenixHost =\s*process\.env\.PHOENIX_HOST \?\? rootEnv\.PHOENIX_HOST \?\? "127\.0\.0\.1";/,
  );
  assert.match(source, /"--host",\s*defaultPhoenixHost,\s*"--port",\s*"6006"/);
  assert.match(source, /"--with",\s*"sqlalchemy<2\.1",\s*"arize-phoenix"/);
  assert.match(source, /description: "Start Arize Phoenix trace UI",\s*healthPort: 6006,\s*optional: true,/);
});
