import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("provider credential reauthentication is routed to the existing Settings flow", async () => {
  const source = await readFile(
    new URL(
      "../src/features/settings/components/molecules/provider-credential-dialog.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /requiredAction === REQUIRED_ACTIONS\.reauthenticate/);
  assert.match(source, /onReauthenticate\?\./);
  assert.match(source, /setCredential\(""\)/);
});

test("provider credential request preserves requiredAction from the API problem", async () => {
  const source = await readFile(
    new URL("../src/lib/api/github-repository-client.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /requiredAction\?: string/);
  assert.match(source, /response\.requiredAction/);
});
