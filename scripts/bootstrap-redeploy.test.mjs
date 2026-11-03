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
  fs.writeFileSync(path.join(binDir, "dotenv"), "#!/bin/sh\nexit 0\n");
  fs.writeFileSync(path.join(binDir, "pm2"), "#!/bin/sh\nexit 0\n");
  fs.chmodSync(path.join(binDir, "dotenv"), 0o755);
  fs.chmodSync(path.join(binDir, "pm2"), 0o755);

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

    assert.equal(res.status, 0);
    assert.match(res.stdout, new RegExp(`TARGET_SELF_REEXEC_PASSED: ${targetSha}`));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});
