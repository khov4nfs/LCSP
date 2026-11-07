import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import ts from "typescript";

test.use({ acceptDownloads: true });

/**
 * Business purpose: Prove that an authorized attachment downloads in a real browser without the Save As API.
 * Business rules:
 * - Exercise the production helper with one click, one authenticated request and the exact attachment bytes.
 * - The fixture uses only its own loopback origin and synthetic session cookie.
 * Execution flow:
 * 1. Transpile the current helper and serve it with an isolated attachment fixture.
 * 2. Remove picker availability, click the button and await the native browser download.
 * 3. Verify bytes, request count, temporary-link cleanup and browser errors.
 * Failure cases:
 * - Missing authentication, duplicate requests, incorrect bytes or browser errors fail the regression.
 * Side effects:
 * - Opens an ephemeral local server and writes one test attachment; the fixture closes after the test.
 */
test("attachment fallback downloads once with its session cookie and exact bytes", async ({
  page,
}, testInfo) => {
  const source = await readFile(
    new URL("../../../apps/web/src/lib/file-download.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  });
  expect(
    compiled.diagnostics?.filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    ) ?? [],
  ).toEqual([]);

  const payload = Buffer.from(
    JSON.stringify({
      schemaVersion: "E2E_DOWNLOAD_FIXTURE",
      assessmentId: "owned-test-only",
    }),
  );
  let downloadRequests = 0;
  let cookiePresent = false;
  const server = createServer((request, response) => {
    if (request.url === "/file-download.js") {
      response.writeHead(200, { "Content-Type": "text/javascript" });
      response.end(compiled.outputText);
    } else if (request.url === "/download.json") {
      downloadRequests += 1;
      cookiePresent =
        request.headers.cookie
          ?.split(";")
          .some((cookie) => cookie.trim() === "download_fixture=authorized") ??
        false;
      if (!cookiePresent) {
        response.writeHead(401);
        response.end("Fixture session required");
        return;
      }
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="session-fixture.json"',
      });
      response.end(payload);
    } else if (request.url === "/favicon.ico") {
      response.writeHead(204);
      response.end();
    } else if (request.url === "/") {
      response.writeHead(200, {
        "Content-Type": "text/html",
        "Set-Cookie":
          "download_fixture=authorized; HttpOnly; SameSite=Strict; Path=/",
      });
      response.end(`<!doctype html>
<html><body>
<button id="download">Download session JSON</button>
<output id="result"></output>
<script type="module">
import { downloadFileWithSavePicker } from "/file-download.js";
document.querySelector("#download").addEventListener("click", async (event) => {
  await downloadFileWithSavePicker({
    url: "/download.json",
    suggestedName: "session-fixture.json",
    event,
  });
  document.querySelector("#result").textContent = "download requested";
});
</script>
</body></html>`);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Loopback fixture address unavailable");
    const origin = "http://127.0.0.1:" + address.port;
    await page.context().route("**/*", (route) =>
      route
        .request()
        .url()
        .startsWith(origin + "/")
        ? route.continue()
        : route.abort(),
    );
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    let downloadEvents = 0;
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("download", () => {
      downloadEvents += 1;
    });
    await page.addInitScript(() => {
      Object.defineProperty(window, "showSaveFilePicker", {
        value: undefined,
        configurable: true,
      });
    });
    await page.goto(origin, { waitUntil: "networkidle" });
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download session JSON" }).click(),
    ]);
    const downloadedPath = testInfo.outputPath("session-fixture.json");
    await download.saveAs(downloadedPath);

    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toBe("session-fixture.json");
    expect(await readFile(downloadedPath)).toEqual(payload);
    expect(cookiePresent).toBe(true);
    expect(downloadRequests).toBe(1);
    expect(downloadEvents).toBe(1);
    await expect(page.locator("a[download]")).toHaveCount(0);
    await expect(page.locator("#result")).toHaveText("download requested");
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
});
