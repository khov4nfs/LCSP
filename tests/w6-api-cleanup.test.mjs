import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { startApi } from "./support/w6-api.mjs";

test(
  "W6 API cleanup returns when called again after SIGTERM",
  { timeout: 5000 },
  async () => {
    const reservation = createServer();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const { port } = reservation.address();
    await new Promise((resolve) => reservation.close(resolve));
    const dir = await mkdtemp(path.join(tmpdir(), "w6-api-cleanup-"));
    const main = path.join(dir, "api.mjs");
    await writeFile(
      main,
      `import { createServer } from "node:http";
createServer((_, response) => response.end("ok")).listen(Number(process.env.PORT), "127.0.0.1");
`,
    );
    let api;
    try {
      api = await startApi({ main, port, databaseUrl: "", storagePath: dir });
      await api.stop();
      const repeated = await Promise.race([
        api.stop().then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 250)),
      ]);
      assert.equal(
        repeated,
        true,
        "a second cleanup must not wait for an already-emitted exit",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
