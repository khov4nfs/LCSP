import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import process from "node:process";

import { buildCommandInvocation } from "./dev-entry-command.mjs";

test("Windows pnpm invocation uses Node and Corepack without cmd.exe", () => {
  const invocation = buildCommandInvocation("pnpm", ["run", "dev"], {
    platform: "win32",
    execPath: "C:\\Node\\node.exe",
    fileExists: () => true,
  });

  assert.equal(invocation.command, "C:\\Node\\node.exe");
  assert.deepEqual(invocation.args, [
    "C:\\Node\\node_modules\\corepack\\dist\\pnpm.js",
    "run",
    "dev",
  ]);
  assert.ok(!invocation.args.includes("/c"));
  assert.notEqual(invocation.command.toLowerCase(), "cmd.exe");
});

test("Unix pnpm invocation keeps executable and arguments separate", () => {
  assert.deepEqual(
    buildCommandInvocation("pnpm", ["--filter", "@lcsp/api", "test"], {
      platform: "linux",
    }),
    { command: "pnpm", args: ["--filter", "@lcsp/api", "test"] },
  );
});

test("Windows invocation ignores ComSpec and fails closed without Corepack", () => {
  assert.throws(
    () =>
      buildCommandInvocation("pnpm", ["--version"], {
        platform: "win32",
        execPath: "C:\\Node\\node.exe",
        fileExists: () => false,
      }),
    /Corepack pnpm\.js could not be resolved/u,
  );
});

test(
  "actual Windows Corepack pnpm invocation accepts separated arguments",
  { skip: process.platform !== "win32" ? "requires Windows" : false },
  async () => {
    const invocation = buildCommandInvocation("pnpm", ["--version"]);
    const output = await new Promise((resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(`pnpm exited with ${code}: ${stderr}`));
      });
    });
    assert.match(output, /^\d+\.\d+\.\d+/u);
  },
);

test(
  "Windows metacharacter paths remain data, not shell commands",
  { skip: process.platform !== "win32" ? "requires Windows" : false },
  async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lcsp-dev-entry-"));
    const target = path.join(tempRoot, "workspace (x) & ^ % literal.txt");
    const script =
      "require('node:fs').writeFileSync(process.argv[1], 'shell-free', 'utf8')";
    try {
      const invocation = buildCommandInvocation("pnpm", [
        "exec",
        "node",
        "-e",
        script,
        target,
      ]);
      await new Promise((resolve, reject) => {
        const child = spawn(invocation.command, invocation.args, {
          shell: false,
          stdio: "ignore",
        });
        child.once("error", reject);
        child.once("exit", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`pnpm exited with ${code ?? 1}`));
        });
      });
      assert.equal(await readFile(target, "utf8"), "shell-free");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  },
);

test("unknown developer mode is rejected before any child command", async () => {
  const child = spawn(process.execPath, ["scripts/dev-entry.mjs", "unknown"], {
    shell: false,
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = await new Promise((resolve) => {
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("exit", (code) => resolve({ code, stderr }));
  });
  assert.equal(output.code, 1);
  assert.match(output.stderr, /Unknown mode: unknown/u);
});
