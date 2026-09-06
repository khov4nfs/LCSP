import * as assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { resolvePublicOrigin } from "../src/lib/http/request-origin.ts";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("public origin uses reverse-proxy host instead of the internal Next URL", () => {
  const request = new Request(
    "https://localhost:3000/api/auth/recovery/request",
    {
      headers: {
        host: "localhost:3000",
        "x-forwarded-host": "lcsp.fogewise.io.vn",
        "x-forwarded-proto": "https",
      },
    },
  );

  assert.equal(resolvePublicOrigin(request), "https://lcsp.fogewise.io.vn");
});

test("public origin falls back to the preserved Host header behind Caddy", () => {
  const request = new Request(
    "https://localhost:3000/api/auth/recovery/request",
    {
      headers: {
        host: "lcsp.fogewise.io.vn",
        "x-forwarded-proto": "https",
      },
    },
  );

  assert.equal(resolvePublicOrigin(request), "https://lcsp.fogewise.io.vn");
});

test("password recovery BFF forwards the resolved public origin", async () => {
  const source = await read("../src/app/api/auth/recovery/request/route.ts");

  assert.equal(source.includes("resolvePublicOrigin(request)"), true);
  assert.equal(source.includes('"x-app-origin": origin'), true);
  assert.equal(source.includes("new URL(request.url).origin"), false);
});
