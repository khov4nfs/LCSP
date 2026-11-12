// Actual Chromium, production React components and compiled Tailwind; isolated HTTP fixture, not a deployed integration.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../../../..");
process.chdir(root);
const scratch = mkdtempSync(path.join(tmpdir(), "lcsp347-browser-"));
const requireWeb = createRequire(path.resolve("apps/web/package.json"));
const requireTsx = createRequire(import.meta.resolve("tsx"));
const esbuild = requireTsx("esbuild");
const { chromium } = requireWeb("@playwright/test");
await esbuild.build({
  entryPoints: ["apps/web/tests/browser/reviewed-workflows.fixture.jsx"],
  bundle: true,
  nodePaths: [path.resolve("apps/web/node_modules")],
  platform: "browser",
  format: "iife",
  outfile: path.join(scratch, "app.js"),
  tsconfig: "apps/web/tsconfig.json",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
});
const cssRequire = createRequire(requireWeb.resolve("@tailwindcss/postcss"));
const css = await cssRequire("postcss")([
  cssRequire("@tailwindcss/postcss")({ base: path.resolve("apps/web") }),
]).process(readFileSync("apps/web/src/app/globals.css", "utf8"), {
  from: path.resolve("apps/web/src/app/globals.css"),
});
writeFileSync(path.join(scratch, "app.css"), css.css);
const server = createServer((req, res) => {
  if (req.url === "/app.css") {
    res.setHeader("content-type", "text/css");
    res.end(readFileSync(path.join(scratch, "app.css")));
  } else if (req.url === "/app.js") {
    res.setHeader("content-type", "text/javascript");
    res.end(readFileSync(path.join(scratch, "app.js")));
  } else {
    res.setHeader("content-type", "text/html");
    res.end(
      '<html><head><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
    );
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text().slice(0, 500));
});
page.on("pageerror", (error) => {
  errors.push(error.message);
  console.error("Browser error:", error.message);
});
try {
  await page.goto(`${origin}/grouping`);
  await page.getByText("Synthetic safeguard", { exact: true }).waitFor();
  await page.locator("select").selectOption("ARCHITECTURE_SAFETY_BY_DESIGN");
  await page
    .getByLabel("English rationale")
    .fill("Administrator reviewed the synthetic design responsibility.");
  await page
    .getByLabel("Vietnamese rationale")
    .fill("Quản trị viên rà soát trách nhiệm thiết kế giả lập.");
  await page.getByRole("button", { name: "Submit complete grouping" }).click();
  await page.waitForFunction(() => window.__fixture.submissions.length === 1);
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]').disabled,
  );
  await page
    .getByLabel("English rationale")
    .fill(
      "Changed after submission; the old snapshot cannot be approved from this form.",
    );
  if (
    !(await page
      .getByRole("button", { name: "Approve displayed digest independently" })
      .isDisabled())
  )
    throw Error("Dirty form can approve stale displayed snapshot");
  await page.setViewportSize({ width: 390, height: 844 });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Mobile grouping overflows");
  await page.goto(`${origin}/report`);
  await page
    .getByText("EN: Assess the requirement.", { exact: true })
    .waitFor();
  await page.evaluate(() => {
    window.__fixture.delay = true;
    window.__locale("vi");
  });
  await page.waitForFunction(() => !!window.__fixture.release);
  if (
    await page
      .getByText("EN: Assess the requirement.", { exact: true })
      .isVisible()
  )
    throw Error("Old narrative flashes under VI");
  await page.evaluate(() => {
    window.__fixture.delay = false;
    window.__fixture.release();
  });
  await page
    .getByText("VI: Assess the requirement.", { exact: true })
    .waitFor();
  await page.evaluate(() => window.__locale("en"));
  await page
    .getByText("EN: Assess the requirement.", { exact: true })
    .waitFor();
  for (const mode of ["PENDING", "FAILED"]) {
    await page.reload();
    await page
      .getByText("EN: Assess the requirement.", { exact: true })
      .waitFor();
    await page.evaluate((value) => {
      window.__fixture.mode = value;
      window.__locale("vi");
    }, mode);
    await page.locator('[data-slot="alert"]').waitFor();
    if (
      await page
        .getByText("EN: Assess the requirement.", { exact: true })
        .isVisible()
    )
      throw Error("Error state exposes old language");
  }
  await page.evaluate(() => {
    window.__fixture.mode = "READY";
    window.__locale("en");
  });
  await page.goto(`${origin}/localization`);
  await page
    .getByRole("button", { name: "Inspect scope", exact: true })
    .first()
    .click();
  await page
    .getByText("Localization operational readiness", { exact: true })
    .waitFor();
  await page.getByText("Biện pháp bảo vệ giả lập (ứng viên)").waitFor();
  await page
    .getByLabel("Review evidence")
    .fill("Browser verified target language and legal meaning.");
  await page
    .getByLabel(
      "I confirm the target language and legal/technical meaning match the canonical source.",
    )
    .check();
  await page
    .getByRole("button", { name: "Approve / normalize output" })
    .click();
  await page.waitForFunction(
    () => window.__fixture.localizationSubmissions.length === 1,
  );
  await page.goto(`${origin}/pagination`);
  await page.getByText("pagination-scope-01", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Next page", exact: true })
    .first()
    .click();
  await page.getByText("pagination-scope-30", { exact: true }).waitFor();
  await page
    .locator("li")
    .filter({ has: page.getByText("pagination-scope-30", { exact: true }) })
    .getByRole("button")
    .click();
  const queue = page.locator('[data-slot="localization-scope-review"]');
  await queue
    .locator('[data-slot="localization-queue-item"]')
    .nth(99)
    .waitFor();
  await queue.getByRole("button", { name: "Next page", exact: true }).click();
  await queue
    .locator('[data-slot="localization-queue-item"]')
    .nth(59)
    .waitFor();
  if (
    (await queue.locator('[data-slot="localization-queue-item"]').count()) !==
    60
  )
    throw Error("Missing second page jobs");
  await queue
    .getByRole("button", { name: "Previous page", exact: true })
    .click();
  await queue
    .locator('[data-slot="localization-queue-item"]')
    .nth(99)
    .waitFor();
  await page.goto(`${origin}/preparation`);
  await page.locator('[data-slot="preparation-observability"]').waitFor();
  await page.getByText("MODEL_EXECUTION", { exact: true }).waitFor();
  if ((await page.locator("body").innerText()).includes("DO_NOT_RENDER"))
    throw Error("Unsafe diagnostic content displayed");
  await page
    .getByRole("button", { name: "Load older persisted events", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll("button")).some(
        (b) => b.textContent === "Load older persisted events",
      ),
  );
  await page.evaluate(() =>
    window.__preparationStream.onerror?.(new Event("error")),
  );
  await page.getByText("Reconnecting", { exact: false }).first().waitFor();
  await page.evaluate(() => window.__preparationState("PAUSED"));
  await page
    .getByRole("button", { name: "Resume preparation", exact: true })
    .waitFor();
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Mobile Preparation overflows");
  await page.evaluate(() => window.__locale("vi"));
  await page
    .getByText("Preparation đã chọn — run canonical", { exact: true })
    .waitFor();
  await page.goto(`${origin}/catalog`);
  await page
    .getByText("EN: Architecture safety rule one", { exact: true })
    .waitFor();
  await page.evaluate(() => window.__locale("vi"));
  await page
    .getByText("VI: Quy tắc an toàn kiến trúc một", { exact: true })
    .waitFor();
  await page.evaluate(() => window.__locale("en"));
  await page
    .getByText("EN: Architecture safety rule one", { exact: true })
    .waitFor();
  if (errors.length) throw Error(JSON.stringify(errors));
  console.log(
    JSON.stringify({
      groupingSubmission: true,
      dirtyApprovalBlocked: true,
      mobile: true,
      reportEN_VI_EN: true,
      localizationQueueBrowser: true,
      scope30AndJobsBeyond100: true,
      preparationDiagnosticsHistoryMobileENVI: true,
      groupedCatalogEN_VI_EN: true,
      oldLanguageFlash: false,
      pending: true,
      failed: true,
      consoleErrors: 0,
      http: "isolated fixture; actual React components",
    }),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
