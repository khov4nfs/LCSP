import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const launchers = path.join(root, "fogewise-dev-launchers");
const compose = path.join(launchers, "common/docker-compose.local-infra.yml");
const keys = [
  "LCSP_LOCAL_POSTGRES_PASSWORD",
  "LCSP_LOCAL_RABBITMQ_PASSWORD",
  "LCSP_LOCAL_REDIS_PASSWORD",
];
const docker = spawnSync("docker", ["compose", "version"], {
  encoding: "utf8",
});
const hasCompose = docker.status === 0;

test("launcher templates contain no credential literals and require all private values", () => {
  const source = readFileSync(compose, "utf8");
  for (const key of keys) assert.ok(source.includes("${" + key + ":?"));
  const example = readFileSync(
    path.join(launchers, "common/.env.example"),
    "utf8",
  )
    .split(/\r?\n/u)
    .filter((line) => line && !line.startsWith("#"));
  assert.deepEqual(
    example,
    keys.map((key) => key + "="),
  );
  for (const file of [
    compose,
    path.join(launchers, "fedora/fogewise-local-infra-fedora.sh"),
    path.join(launchers, "windows/fogewise-local-infra-windows.ps1"),
  ]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /\b[a-f0-9]{40,}\b/iu);
  }
});

test(
  "Compose uses the private env from arbitrary working directories and rejects missing passwords",
  { skip: !hasCompose && "Docker Compose unavailable" },
  () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "lcsp compose & test "));
    try {
      const envFile = path.join(temp, "private.env");
      const values = keys.map(() => randomBytes(24).toString("hex"));
      values[2] += ' $(literal) ; & | " quote';
      const env = { ...process.env };
      for (const key of keys) delete env[key];
      const run = (cwd) =>
        spawnSync(
          "docker",
          [
            "compose",
            "--env-file",
            envFile,
            "-f",
            compose,
            "config",
            "--format",
            "json",
          ],
          { cwd, env, encoding: "utf8" },
        );
      writeFileSync(
        envFile,
        keys.map((key, i) => `${key}='${values[i]}'`).join("\n"),
        { mode: 0o600 },
      );
      for (const cwd of [root, path.join(launchers, "windows"), temp]) {
        const result = run(cwd);
        assert.equal(
          result.status,
          0,
          "Compose configuration rejected private test values",
        );
        const services = JSON.parse(result.stdout).services;
        assert.equal(
          services["fogewise-postgres"].environment.POSTGRES_PASSWORD,
          values[0],
        );
        assert.equal(
          services["fogewise-rabbitmq"].environment.RABBITMQ_DEFAULT_PASS,
          values[1],
        );
        const renderedPassword = values[2].replaceAll("$", () => "$$");
        assert.equal(
          services["fogewise-redis"].command.at(-1),
          renderedPassword,
        );
        assert.deepEqual(services["fogewise-redis"].healthcheck.test, [
          "CMD",
          "redis-cli",
          "-e",
          "--no-auth-warning",
          "-a",
          renderedPassword,
          "ping",
        ]);
      }
      for (let missing = 0; missing < keys.length; missing++) {
        writeFileSync(
          envFile,
          keys
            .map((key, i) => `${key}='${i === missing ? "" : values[i]}'`)
            .join("\n"),
        );
        assert.notEqual(
          run(temp).status,
          0,
          "An empty required password was accepted",
        );
      }
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  },
);

test(
  "Fedora launcher passes a private env path and stops before hosts or startup on invalid configuration",
  { skip: process.platform === "win32" && "Requires Bash on Linux" },
  () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), "lcsp launcher & test "));
    try {
      const bin = path.join(temp, "bin");
      const common = path.join(temp, "common");
      const fedora = path.join(temp, "fedora");
      for (const folder of [bin, common, fedora]) mkdirSync(folder);
      const launcher = path.join(fedora, "fogewise-local-infra-fedora.sh");
      copyFileSync(
        path.join(launchers, "fedora/fogewise-local-infra-fedora.sh"),
        launcher,
      );
      writeFileSync(
        path.join(common, "docker-compose.local-infra.yml"),
        "services: {}\n",
      );
      writeFileSync(path.join(common, ".env"), "# private test fixture\n", {
        mode: 0o600,
      });
      const log = path.join(temp, "calls.jsonl");
      writeFileSync(
        path.join(bin, "docker"),
        `#!/usr/bin/env node\nconst fs=require('node:fs'); const args=process.argv.slice(2); fs.appendFileSync(process.env.CALL_LOG,JSON.stringify(args)+'\\n'); if(args.includes('config') && process.env.FAIL_CONFIG==='1')process.exit(17); if(args[0]==='inspect')console.log('healthy');\n`,
        { mode: 0o755 },
      );
      writeFileSync(path.join(bin, "systemctl"), "#!/bin/sh\nexit 0\n", {
        mode: 0o755,
      });
      writeFileSync(path.join(bin, "grep"), "#!/bin/sh\nexit 0\n", {
        mode: 0o755,
      });
      writeFileSync(path.join(bin, "sudo"), "#!/bin/sh\nexit 99\n", {
        mode: 0o755,
      });
      const env = {
        ...process.env,
        PATH: bin + path.delimiter + process.env.PATH,
        CALL_LOG: log,
      };
      const success = spawnSync("bash", [launcher], {
        env,
        encoding: "utf8",
        cwd: temp,
      });
      assert.equal(success.status, 0);
      const calls = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const composeCalls = calls.filter(
        (args) => args[0] === "compose" && args[1] !== "version",
      );
      for (const args of composeCalls)
        assert.deepEqual(args.slice(0, 3), [
          "compose",
          "--env-file",
          path.join(common, ".env"),
        ]);
      assert.deepEqual(
        composeCalls.map((args) => args.slice(-2)),
        [
          ["config", "--quiet"],
          ["up", "-d"],
          [path.join(common, "docker-compose.local-infra.yml"), "ps"],
        ],
      );
      writeFileSync(log, "");
      const failed = spawnSync("bash", [launcher], {
        env: { ...env, FAIL_CONFIG: "1" },
        encoding: "utf8",
      });
      assert.equal(failed.status, 17);
      assert.doesNotMatch(
        failed.stdout,
        /Ensuring host alias|Starting local PostgreSQL/u,
      );
      const failedCalls = readFileSync(log, "utf8");
      assert.doesNotMatch(failedCalls, /"up"/u);
      rmSync(path.join(common, ".env"));
      writeFileSync(log, "");
      const missing = spawnSync("bash", [launcher], { env, encoding: "utf8" });
      assert.equal(missing.status, 1);
      assert.match(missing.stderr, /Private configuration missing/u);
      assert.equal(readFileSync(log, "utf8"), "");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  },
);
