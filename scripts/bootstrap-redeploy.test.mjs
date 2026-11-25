import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..");
const bootstrapScript = path.join(workspaceRoot, "scripts/bootstrap-redeploy.sh");

test("bootstrap-redeploy: CI requires 3 GiB free on every deployment filesystem by default", () => {
  // Stub only capacity discovery. An invalid SHA stops the run before Git or deployment.
  const run = (availableKiB, override = "") =>
    spawnSync(
      "bash",
      [
        "-c",
        [
          "docker() { echo .; }",
          "df() {",
          "  printf '%s\\n' 'Filesystem 1024-blocks Used Available Capacity Mounted on' 'app 9000000 1 9000000 1% /app'",
          "  printf 'docker 9000000 1 %s 1%% /docker\\n' \"$AVAILABLE_KIB\"",
          "  printf '%s\\n' 'tmp 9000000 1 9000000 1% /tmp'",
          "}",
          "export -f docker df",
          // The fixture runs from workspaceRoot, so Bash can use a fixed script path.
          "bash ./scripts/bootstrap-redeploy.sh --ci keep",
        ].join("\n"),
      ],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          APP: ".",
          AVAILABLE_KIB: String(availableKiB),
          LCSP_DEPLOY_MIN_FREE_MIB: override,
          LCSP_DEPLOY_EXPECTED_SHA: "stop-before-deploy",
        },
        encoding: "utf8",
      },
    );

  const below = run(3072 * 1024 - 1);
  assert.equal(below.status, 1, below.stderr);
  assert.match(below.stdout, /Minimum free disk per filesystem: 3072 MiB/);
  assert.match(below.stderr, /Insufficient free disk for deploy/);

  const atMinimum = run(3072 * 1024);
  assert.equal(atMinimum.status, 1, atMinimum.stderr);
  assert.match(atMinimum.stderr, /LCSP_DEPLOY_EXPECTED_SHA must pin/);

  const overridden = run(3072 * 1024, "4096");
  assert.equal(overridden.status, 1, overridden.stderr);
  assert.match(overridden.stdout, /Minimum free disk per filesystem: 4096 MiB/);
  assert.match(overridden.stderr, /Insufficient free disk for deploy/);
});

test("bootstrap-redeploy: fails when LCSP_DEPLOY_EXPECTED_SHA is invalid or unset", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-redeploy-test-"));
  try {
    const res = spawnSync("bash", [bootstrapScript], {
      cwd: tmpDir,
      env: { ...process.env, APP: tmpDir, LCSP_DEPLOY_EXPECTED_SHA: "invalid-sha" },
      encoding: "utf8",
    });
    assert.equal(res.status, 1);
    assert.match(
      res.stderr,
      /LCSP_DEPLOY_EXPECTED_SHA must pin the reviewed 40-character target revision/,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("bootstrap-redeploy: rejects deployment when working tree is dirty", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-redeploy-dirty-"));
  try {
    execSync("git init && git config user.name 'Test' && git config user.email 'test@example.com'", {
      cwd: tmpDir,
    });
    fs.writeFileSync(path.join(tmpDir, "file.txt"), "hello\n");
    execSync("git add . && git commit -m 'Initial commit'", { cwd: tmpDir });
    const initialSha = execSync("git rev-parse HEAD", { cwd: tmpDir, encoding: "utf8" }).trim();

    // Make working tree dirty
    fs.writeFileSync(path.join(tmpDir, "dirty.txt"), "uncommitted change\n");

    const res = spawnSync("bash", [bootstrapScript], {
      cwd: tmpDir,
      env: { ...process.env, APP: tmpDir, LCSP_DEPLOY_EXPECTED_SHA: initialSha },
      encoding: "utf8",
    });

    assert.equal(res.status, 1);
    assert.match(
      res.stderr,
      /Production checkout has local changes; preserve them before deployment/,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("bootstrap-redeploy: rejects when origin/develop does not match expected target SHA", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-redeploy-mismatch-"));
  try {
    execSync("git init && git config user.name 'Test' && git config user.email 'test@example.com'", {
      cwd: tmpDir,
    });
    fs.writeFileSync(path.join(tmpDir, "file.txt"), "initial\n");
    execSync("git add . && git commit -m 'Initial commit'", { cwd: tmpDir });
    const initialSha = execSync("git rev-parse HEAD", { cwd: tmpDir, encoding: "utf8" }).trim();

    // Create a target commit
    fs.writeFileSync(path.join(tmpDir, "file.txt"), "target update\n");
    execSync("git commit -am 'Target commit'", { cwd: tmpDir });
    const targetSha = execSync("git rev-parse HEAD", { cwd: tmpDir, encoding: "utf8" }).trim();

    // Set origin/develop to point to initialSha (simulating origin/develop not updated to targetSha yet)
    execSync(`git update-ref refs/remotes/origin/develop ${initialSha}`, { cwd: tmpDir });

    const res = spawnSync("bash", [bootstrapScript], {
      cwd: tmpDir,
      env: {
        ...process.env,
        APP: tmpDir,
        LCSP_DEPLOY_EXPECTED_SHA: targetSha,
      },
      encoding: "utf8",
    });

    assert.equal(res.status, 1);
    assert.match(
      res.stderr,
      /origin\/develop .* does not match expected SHA .*; aborting before drain/,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("bootstrap-redeploy: extracts target redeploy.sh without modifying working tree before execution", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-redeploy-exec-"));
  try {
    execSync("git init && git config user.name 'Test' && git config user.email 'test@example.com'", {
      cwd: tmpDir,
    });

    // Old revision: has old redeploy.sh that records OLD_EXECUTION
    const oldRedeploy = `#!/usr/bin/env bash\necho "OLD_EXECUTION"\nexit 1\n`;
    fs.writeFileSync(path.join(tmpDir, "redeploy.sh"), oldRedeploy);
    execSync("git add redeploy.sh && git commit -m 'Old redeploy revision'", { cwd: tmpDir });
    const oldSha = execSync("git rev-parse HEAD", { cwd: tmpDir, encoding: "utf8" }).trim();

    // New revision: has new redeploy.sh that records TARGET_EXECUTION and exits cleanly
    const targetRedeploy = `#!/usr/bin/env bash\necho "TARGET_EXECUTION_SUCCESS: \${LCSP_DEPLOY_EXPECTED_SHA}"\nexit 0\n`;
    fs.writeFileSync(path.join(tmpDir, "redeploy.sh"), targetRedeploy);
    execSync("git commit -am 'New redeploy revision'", { cwd: tmpDir });
    const targetSha = execSync("git rev-parse HEAD", { cwd: tmpDir, encoding: "utf8" }).trim();

    // Reset checkout back to old revision so working tree is in the "old" state
    execSync(`git checkout ${oldSha} --quiet`, { cwd: tmpDir });

    // Set origin/develop to point to targetSha
    execSync(`git update-ref refs/remotes/origin/develop ${targetSha}`, { cwd: tmpDir });

    // Verify working tree has old redeploy content
    assert.equal(fs.readFileSync(path.join(tmpDir, "redeploy.sh"), "utf8"), oldRedeploy);

    const res = spawnSync("bash", [bootstrapScript], {
      cwd: tmpDir,
      env: {
        ...process.env,
        APP: tmpDir,
        LCSP_DEPLOY_EXPECTED_SHA: targetSha,
      },
      encoding: "utf8",
    });

    assert.equal(res.status, 0);
    assert.match(res.stdout, new RegExp(`TARGET_EXECUTION_SUCCESS: ${targetSha}`));
    assert.doesNotMatch(res.stdout, /OLD_EXECUTION/);

    // Verify working tree was not mutated during extraction
    assert.equal(fs.readFileSync(path.join(tmpDir, "redeploy.sh"), "utf8"), oldRedeploy);

    // Verify bootstrap cache was cleaned up
    const cacheDir = path.join(tmpDir, ".cache");
    if (fs.existsSync(cacheDir)) {
      const remainingFiles = fs.readdirSync(cacheDir);
      assert.deepEqual(remainingFiles, []);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("redeploy.sh: self-reexecutes target redeploy.sh when invoked directly on an intermediate checkout", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "redeploy-self-reexec-"));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "redeploy-test-bin-"));
  // The fixture stops at script handoff. Satisfy command discovery without
  // depending on deployment tooling being installed on the test runner.
  for (const command of ["dotenv", "pm2", "docker", "pnpm"]) {
    fs.writeFileSync(path.join(binDir, command), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }

  try {
    execSync("git init && git config user.name 'Test' && git config user.email 'test@example.com'", {
      cwd: tmpDir,
    });

    const realRedeployContent = fs.readFileSync(path.join(workspaceRoot, "redeploy.sh"), "utf8");

    // Commit current redeploy.sh with self-reexec support
    fs.writeFileSync(path.join(tmpDir, "redeploy.sh"), realRedeployContent);
    execSync("git add redeploy.sh && git commit -m 'Intermediate redeploy revision'", { cwd: tmpDir });
    const intermediateSha = execSync("git rev-parse HEAD", { cwd: tmpDir, encoding: "utf8" }).trim();

    // Now commit a new target revision where redeploy.sh echoes a marker and exits 0
    const targetRedeployContent = `#!/usr/bin/env bash\necho "TARGET_SELF_REEXEC_PASSED: \${LCSP_DEPLOY_EXPECTED_SHA}"\nexit 0\n`;
    fs.writeFileSync(path.join(tmpDir, "redeploy.sh"), targetRedeployContent);
    execSync("git commit -am 'Target future revision'", { cwd: tmpDir });
    const targetSha = execSync("git rev-parse HEAD", { cwd: tmpDir, encoding: "utf8" }).trim();

    // Check out intermediateSha so intermediate redeploy.sh is on disk
    execSync(`git checkout ${intermediateSha} --quiet`, { cwd: tmpDir });

    // Point origin/develop to targetSha
    execSync(`git update-ref refs/remotes/origin/develop ${targetSha}`, { cwd: tmpDir });

    // Run the intermediate redeploy.sh directly from disk!
    const res = spawnSync("bash", [path.join(tmpDir, "redeploy.sh")], {
      cwd: tmpDir,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        APP: tmpDir,
        LCSP_DEPLOY_EXPECTED_SHA: targetSha,
      },
      encoding: "utf8",
    });

    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, new RegExp(`TARGET_SELF_REEXEC_PASSED: ${targetSha}`));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});

test("bootstrap-redeploy pins main independently and refuses a stale dispatch", () => {
  const origin = fs.mkdtempSync(path.join(os.tmpdir(), "lcsp-deploy-origin-"));
  const app = fs.mkdtempSync(path.join(os.tmpdir(), "lcsp-deploy-app-"));
  try {
    // Model a server currently on develop with a different main release.
    const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });
    const commands = [
      ["init", "-b", "main"],
      ["config", "user.name", "Test"],
      ["config", "user.email", "test@example.com"],
    ];
    for (const args of commands) {
      const result = git(origin, ...args);
      assert.equal(result.status, 0, result.stderr);
    }
    fs.writeFileSync(path.join(origin, "redeploy.sh"), "#!/bin/bash\necho MAIN_TARGET_LOADED\n");
    assert.equal(git(origin, "add", "redeploy.sh").status, 0);
    assert.equal(git(origin, "commit", "-m", "main release").status, 0);
    const mainSha = git(origin, "rev-parse", "HEAD").stdout.trim();
    assert.equal(git(origin, "switch", "-c", "develop").status, 0);
    assert.equal(git(origin, "commit", "--allow-empty", "-m", "develop release").status, 0);
    const developSha = git(origin, "rev-parse", "HEAD").stdout.trim();
    assert.equal(git(app, "clone", origin, ".").status, 0);

    const env = { ...process.env, APP: app, LCSP_DEPLOY_BRANCH: "main" };
    const fresh = spawnSync("bash", [bootstrapScript], {
      env: { ...env, LCSP_DEPLOY_EXPECTED_SHA: mainSha },
      encoding: "utf8",
    });
    assert.equal(fresh.status, 0, fresh.stderr);
    assert.match(fresh.stdout, /MAIN_TARGET_LOADED/);
    assert.equal(git(app, "rev-parse", "HEAD").stdout.trim(), developSha);

    const stale = spawnSync("bash", [bootstrapScript], {
      env: { ...env, LCSP_DEPLOY_EXPECTED_SHA: developSha },
      encoding: "utf8",
    });
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /origin\/main .* does not match expected SHA/);
    assert.doesNotMatch(stale.stdout, /MAIN_TARGET_LOADED/);
  } finally {
    fs.rmSync(app, { recursive: true, force: true });
    fs.rmSync(origin, { recursive: true, force: true });
  }
});
