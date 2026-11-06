import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = path.resolve(import.meta.dirname, "../../..");
const temp = mkdtempSync(path.join(tmpdir(), "lcsp-browser-v2-"));
const fixtureFile = path.join(temp, "fixture.json");
const releaseFile = path.join(temp, "release");
const container = `lcsp-browser-v2-pg-${process.pid}`;
const apiPort = 3414;
const webPort = 3105;
const verticalScript =
  process.env.LCSP_BROWSER_VERTICAL_SCRIPT ??
  "tests/assessment-domain-vertical.mjs";
let vertical;
let web;

async function waitForFile(file, timeoutMs = 240_000) {
  const started = Date.now();
  while (!existsSync(file)) {
    if (Date.now() - started > timeoutMs)
      throw new Error(`Timed out waiting for ${file}`);
    await delay(500);
  }
}

async function waitForPort(port, timeoutMs = 120_000) {
  const started = Date.now();
  while (true) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
          socket.destroy();
          resolve();
        });
        socket.once("error", reject);
      });
      return;
    } catch {
      if (Date.now() - started > timeoutMs)
        throw new Error(`Timed out waiting for port ${port}`);
      await delay(500);
    }
  }
}

async function waitForPostgres(timeoutMs = 120_000) {
  const started = Date.now();
  while (true) {
    const ready = spawnSync(
      "docker",
      ["exec", container, "pg_isready", "-U", "postgres"],
      { encoding: "utf8" },
    );
    if (ready.status === 0) return;
    if (Date.now() - started > timeoutMs)
      throw new Error(
        `Timed out waiting for PostgreSQL readiness: ${ready.stdout}${ready.stderr}`,
      );
    await delay(500);
  }
}

function start(command, args, env, cwd = root, shell = false) {
  return spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    shell,
  });
}

try {
  // This exact name is owned by this harness; remove only a stale prior run.
  spawnSync("docker", ["rm", "-f", container], { cwd: root, stdio: "ignore" });
  const docker = spawnSync(
    "docker",
    [
      "run",
      "-d",
      "--name",
      container,
      "-e",
      "POSTGRES_PASSWORD=postgres",
      "-p",
      "55441:5432",
      "postgres:16-alpine",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(docker.status, 0, docker.stdout + docker.stderr);
  await waitForPort(55441);
  await waitForPostgres();

  vertical = start(
    process.execPath,
    ["--experimental-strip-types", verticalScript],
    {
      LCSP_ASSESSMENT_TEST_API_PORT: String(apiPort),
      LCSP_BROWSER_FIXTURE_FILE: fixtureFile,
      LCSP_BROWSER_RELEASE_FILE: releaseFile,
    },
  );
  let verticalLog = "";
  vertical.stdout.on("data", (chunk) => {
    verticalLog += String(chunk);
    process.stdout.write(`[vertical] ${chunk}`);
  });
  vertical.stderr.on("data", (chunk) => {
    verticalLog += String(chunk);
    process.stderr.write(`[vertical] ${chunk}`);
  });
  const fixtureWait = waitForFile(fixtureFile);
  await Promise.race([
    fixtureWait,
    new Promise((_, reject) =>
      vertical.once("exit", (code) =>
        reject(
          new Error(
            `Vertical exited before fixture creation (${code})\n${verticalLog.slice(-3000)}`,
          ),
        ),
      ),
    ),
  ]);
  const fixture = JSON.parse(readFileSync(fixtureFile, "utf8"));

  web = start(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "--port", String(webPort)],
    {
      LCSP_API_BASE_URL: fixture.apiBase,
      NODE_ENV: "test",
    },
    path.join(root, "apps/web"),
  );
  web.stdout.on("data", (chunk) => process.stdout.write(`[web] ${chunk}`));
  web.stderr.on("data", (chunk) => process.stderr.write(`[web] ${chunk}`));
  await waitForPort(webPort);

  const test = start(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["exec", "playwright", "test", "--config=playwright.assessment.config.ts"],
    {
      LCSP_BROWSER_FIXTURE_FILE: fixtureFile,
      LCSP_ASSESSMENT_WEB_URL: `http://127.0.0.1:${webPort}`,
    },
    root,
    process.platform === "win32",
  );
  test.stdout.pipe(process.stdout);
  test.stderr.pipe(process.stderr);
  const exit = await new Promise((resolve) =>
    test.once("exit", (code) => resolve(code ?? 1)),
  );
  assert.equal(
    exit,
    0,
    `Playwright failed with exit ${exit}\n${verticalLog.slice(-3000)}`,
  );
} finally {
  writeFileSync(releaseFile, "release\n");
  for (const child of [web, vertical]) {
    if (child && child.exitCode === null) child.kill("SIGTERM");
  }
  spawnSync("docker", ["rm", "-f", container], { cwd: root, stdio: "ignore" });
  rmSync(temp, { recursive: true, force: true });
}
