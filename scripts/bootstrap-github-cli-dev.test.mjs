import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "dotenv";

import {
  bootstrapLocalGitHubCli,
  bootstrapLocalGitLabCli,
  SUPPORTED_GITHUB_CLI_VERSION,
  SUPPORTED_GITLAB_CLI_VERSION,
} from "./bootstrap-github-cli-dev.mjs";

async function withTempEnv(callback) {
  const root = mkdtempSync(path.join(os.tmpdir(), "lcsp-cli-bootstrap-"));
  try {
    return await callback(root, path.join(root, ".env"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function fakeGh(pathValue, version = SUPPORTED_GITHUB_CLI_VERSION) {
  writeFileSync(pathValue, "fake-gh", "utf8");
  return (command, args) => {
    if (args[0] === "--version") {
      return { status: 0, stdout: `gh version ${version} (test)\n` };
    }
    return { status: 0, stdout: `${pathValue}\n` };
  };
}

test("first bootstrap discovers gh, enables flags, and creates one local KEK", () =>
  withTempEnv(async (root, envFilePath) => {
    const executablePath = path.join(root, "gh.exe");
    const result = await bootstrapLocalGitHubCli({
      repoRoot: root,
      env: {
        NODE_ENV: "development",
        GITHUB_CLI_EXECUTABLE_PATH: executablePath,
      },
      platform: "win32",
      envFilePath,
      spawnSyncImpl: fakeGh(executablePath),
      randomBytesImpl: (size) => Buffer.alloc(size, 7),
    });
    const values = parse(readFileSync(envFilePath));
    assert.equal(result.version, SUPPORTED_GITHUB_CLI_VERSION);
    assert.equal(values.GITHUB_CLI_CREDENTIAL_PERSISTENCE_ENABLED, "true");
    assert.equal(values.GITHUB_CLI_SNAPSHOT_PINNING_ENABLED, "true");
    assert.equal(values.GITHUB_CLI_ARCHIVE_RETRIEVAL_ENABLED, "true");
    assert.equal(
      values.GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION,
      "local-dev-v1",
    );
    assert.deepEqual(JSON.parse(values.GITHUB_CLI_CREDENTIAL_KEK_KEYRING), {
      "local-dev-v1": Buffer.alloc(32, 7).toString("base64"),
    });
  }));

test("GitLab bootstrap enables the provider for local development", () =>
  withTempEnv(async (root, envFilePath) => {
    const executablePath = path.join(root, "glab.exe");
    writeFileSync(executablePath, "fake-glab", "utf8");
    const spawnSyncImpl = (_command, args) =>
      args[0] === "--version"
        ? { status: 0, stdout: `glab ${SUPPORTED_GITLAB_CLI_VERSION} (test)\n` }
        : { status: 0, stdout: `${executablePath}\n` };
    await bootstrapLocalGitLabCli({
      repoRoot: root,
      env: { NODE_ENV: "development" },
      platform: "win32",
      envFilePath,
      spawnSyncImpl,
    });
    assert.equal(
      parse(readFileSync(envFilePath)).GITLAB_PROVIDER_ENABLED,
      "true",
    );
  }));

test("second bootstrap reuses the existing local KEK", () =>
  withTempEnv(async (root, envFilePath) => {
    const executablePath = path.join(root, "gh");
    const spawnSyncImpl = fakeGh(executablePath);
    const options = {
      repoRoot: root,
      env: { NODE_ENV: "development" },
      platform: "linux",
      envFilePath,
      spawnSyncImpl,
      randomBytesImpl: () => {
        throw new Error("KEK must not be regenerated");
      },
    };
    await bootstrapLocalGitHubCli({
      ...options,
      randomBytesImpl: (size) => Buffer.alloc(size, 9),
    });
    const before = parse(readFileSync(envFilePath));
    await bootstrapLocalGitHubCli(options);
    const after = parse(readFileSync(envFilePath));
    assert.equal(
      after.GITHUB_CLI_CREDENTIAL_KEK_KEYRING,
      before.GITHUB_CLI_CREDENTIAL_KEK_KEYRING,
    );
  }));

test("valid manually configured KEK is preserved", () =>
  withTempEnv(async (root, envFilePath) => {
    const executablePath = path.join(root, "gh");
    const keyring = JSON.stringify({
      "manual-v1": Buffer.alloc(32, 3).toString("base64"),
    });
    writeFileSync(
      envFilePath,
      `GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION=manual-v1\nGITHUB_CLI_CREDENTIAL_KEK_KEYRING=${keyring}\n`,
    );
    await bootstrapLocalGitHubCli({
      repoRoot: root,
      env: { NODE_ENV: "development" },
      platform: "linux",
      envFilePath,
      spawnSyncImpl: fakeGh(executablePath),
      randomBytesImpl: () => {
        throw new Error("existing KEK must be preserved");
      },
    });
    const values = parse(readFileSync(envFilePath));
    assert.equal(values.GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION, "manual-v1");
    assert.deepEqual(
      JSON.parse(values.GITHUB_CLI_CREDENTIAL_KEK_KEYRING),
      JSON.parse(keyring),
    );
  }));

test("unsupported platform fails with a clear error", () =>
  withTempEnv(async (root, envFilePath) => {
    await assert.rejects(
      bootstrapLocalGitHubCli({
        repoRoot: root,
        env: { NODE_ENV: "development" },
        platform: "freebsd",
        envFilePath,
        spawnSyncImpl: () => ({ status: 1, stdout: "" }),
      }),
      /not supported on freebsd/u,
    );
  }));

test("empty managed cache provisions GitHub CLI without auth commands", () =>
  withTempEnv(async (root, envFilePath) => {
    const archive = Buffer.from("synthetic-archive");
    const checksum = createHash("sha256").update(archive).digest("hex");
    const manifest = Buffer.from(
      `${checksum}  gh_${SUPPORTED_GITHUB_CLI_VERSION}_linux_amd64.tar.gz\n`,
    );
    const executablePath = path.join(root, "extract", "gh");
    const spawnSyncImpl = (command, args) => {
      if (args[0] === "--version") {
        return {
          status: 0,
          stdout: `gh version ${SUPPORTED_GITHUB_CLI_VERSION} (test)\n`,
        };
      }
      return { status: 1, stdout: "" };
    };
    const result = await bootstrapLocalGitHubCli({
      repoRoot: root,
      env: { NODE_ENV: "development" },
      platform: "linux",
      envFilePath,
      spawnSyncImpl,
      downloadImpl: async (name) =>
        name.endsWith("checksums.txt") ? manifest : archive,
      checksumManifestSha256: createHash("sha256")
        .update(manifest)
        .digest("hex"),
      extractArchiveImpl: async (_archivePath, extractionDir) => {
        mkdirSync(extractionDir, { recursive: true });
        writeFileSync(path.join(extractionDir, "gh"), "fake-gh", "utf8");
      },
      randomBytesImpl: (size) => Buffer.alloc(size, 5),
    });
    assert.equal(
      result.executablePath,
      path.join(
        root,
        ".cache",
        "lcsp-cli",
        "github-cli",
        SUPPORTED_GITHUB_CLI_VERSION,
        "bin",
        "gh",
      ),
    );
    assert.equal(existsSync(result.executablePath), true);
    await assert.doesNotReject(
      bootstrapLocalGitHubCli({
        repoRoot: root,
        env: { NODE_ENV: "development" },
        platform: "linux",
        envFilePath,
        spawnSyncImpl,
        downloadImpl: async () => {
          throw new Error("network must not be used for cache reuse");
        },
        checksumManifestSha256: "unused",
        randomBytesImpl: (size) => Buffer.alloc(size, 5),
      }),
    );
  }));

test("failed GitHub CLI integrity verification leaves no promoted executable", () =>
  withTempEnv(async (root, envFilePath) => {
    await assert.rejects(
      bootstrapLocalGitHubCli({
        repoRoot: root,
        env: { NODE_ENV: "development" },
        platform: "linux",
        envFilePath,
        spawnSyncImpl: () => ({ status: 1, stdout: "" }),
        downloadImpl: async () => Buffer.from("invalid"),
      }),
      /checksum manifest integrity mismatch/u,
    );
    assert.equal(
      existsSync(
        path.join(
          root,
          ".cache",
          "lcsp-cli",
          "github-cli",
          SUPPORTED_GITHUB_CLI_VERSION,
          "bin",
          "gh",
        ),
      ),
      false,
    );
  }));

test("explicit absolute executable path is respected", () =>
  withTempEnv(async (root, envFilePath) => {
    const executablePath = path.join(root, "custom-gh");
    await bootstrapLocalGitHubCli({
      repoRoot: root,
      env: {
        NODE_ENV: "development",
        GITHUB_CLI_EXECUTABLE_PATH: executablePath,
      },
      platform: "linux",
      envFilePath,
      spawnSyncImpl: fakeGh(executablePath),
      randomBytesImpl: (size) => Buffer.alloc(size, 4),
    });
    assert.equal(
      parse(readFileSync(envFilePath)).GITHUB_CLI_EXECUTABLE_PATH,
      undefined,
    );
  }));

test("relative executable configuration is rejected", () =>
  withTempEnv(async (root, envFilePath) => {
    await assert.rejects(
      bootstrapLocalGitHubCli({
        repoRoot: root,
        env: {
          NODE_ENV: "development",
          GITHUB_CLI_EXECUTABLE_PATH: "tools/gh",
        },
        platform: "linux",
        envFilePath,
        spawnSyncImpl: () => ({ status: 0, stdout: "" }),
      }),
      /must be an absolute path/u,
    );
  }));

test("resolved GitHub CLI path is injected without writing it to .env", () =>
  withTempEnv(async (root, envFilePath) => {
    const executablePath = path.join(root, "injected-gh");
    const previous = process.env.GITHUB_CLI_EXECUTABLE_PATH;
    try {
      await bootstrapLocalGitHubCli({
        repoRoot: root,
        env: {
          NODE_ENV: "development",
          GITHUB_CLI_EXECUTABLE_PATH: executablePath,
        },
        platform: "linux",
        envFilePath,
        spawnSyncImpl: fakeGh(executablePath),
        applyToProcessEnv: true,
        randomBytesImpl: (size) => Buffer.alloc(size, 6),
      });
      assert.equal(process.env.GITHUB_CLI_EXECUTABLE_PATH, executablePath);
      assert.equal(
        parse(readFileSync(envFilePath)).GITHUB_CLI_EXECUTABLE_PATH,
        undefined,
      );
    } finally {
      if (previous === undefined) delete process.env.GITHUB_CLI_EXECUTABLE_PATH;
      else process.env.GITHUB_CLI_EXECUTABLE_PATH = previous;
    }
  }));

test("unsupported gh version fails safely", () =>
  withTempEnv(async (root, envFilePath) => {
    const executablePath = path.join(root, "gh");
    await assert.rejects(
      bootstrapLocalGitHubCli({
        repoRoot: root,
        env: {
          NODE_ENV: "development",
          GITHUB_CLI_EXECUTABLE_PATH: executablePath,
        },
        platform: "linux",
        envFilePath,
        spawnSyncImpl: fakeGh(executablePath, "2.97.0"),
      }),
      /Unsupported GitHub CLI version/u,
    );
  }));

test("malformed existing KEK fails without overwriting it", () =>
  withTempEnv(async (root, envFilePath) => {
    const executablePath = path.join(root, "gh");
    const malformed = '{"local-dev-v1":"not-a-key"}';
    writeFileSync(
      envFilePath,
      `GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION=local-dev-v1\nGITHUB_CLI_CREDENTIAL_KEK_KEYRING=${malformed}\n`,
    );
    await assert.rejects(
      bootstrapLocalGitHubCli({
        repoRoot: root,
        env: { NODE_ENV: "development" },
        platform: "linux",
        envFilePath,
        spawnSyncImpl: fakeGh(executablePath),
      }),
      /KEK configuration is malformed/u,
    );
    assert.match(readFileSync(envFilePath, "utf8"), /not-a-key/u);
  }));

test("production mode skips local discovery and KEK generation", () =>
  withTempEnv(async (root, envFilePath) => {
    const result = await bootstrapLocalGitHubCli({
      repoRoot: root,
      env: { NODE_ENV: "production" },
      envFilePath,
      spawnSyncImpl: () => {
        throw new Error("production must not probe gh");
      },
      randomBytesImpl: () => {
        throw new Error("production must not generate a KEK");
      },
    });
    assert.deepEqual(result, { skipped: true, reason: "production" });
  }));
