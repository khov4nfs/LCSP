import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { parse } from "dotenv";

export const SUPPORTED_GITHUB_CLI_VERSION = "2.98.0";
export const SUPPORTED_GITLAB_CLI_VERSION = "1.113.0";
export const LOCAL_GITHUB_CLI_ENV_FILE = ".env";
export const LOCAL_CLI_CACHE_ROOT = ".cache/lcsp-cli";

const GITLAB_ARTIFACTS = {
  win32: {
    name: `glab_${SUPPORTED_GITLAB_CLI_VERSION}_windows_amd64.zip`,
    sha256: "614017db6860d0fa941eb73098bd999dfda58b7862e544b075f8d2d48931ce72",
  },
  linux: {
    name: `glab_${SUPPORTED_GITLAB_CLI_VERSION}_linux_amd64.tar.gz`,
    sha256: "c265589fb2018f310b6a27df9356efee42991f858e7e3a5fa232228a13b47467",
  },
  darwin: {
    name: `glab_${SUPPORTED_GITLAB_CLI_VERSION}_darwin_amd64.tar.gz`,
    sha256: "9dcb04a634f77a96f9683849d54980cba8ac57ebbbed4fce607c3b13f2bb77fb",
  },
};

const LOCAL_GITHUB_CLI_KEYS = [
  "GITHUB_CLI_EXECUTABLE_PATH",
  "GITHUB_CLI_CREDENTIAL_PERSISTENCE_ENABLED",
  "GITHUB_CLI_SNAPSHOT_PINNING_ENABLED",
  "GITHUB_CLI_ARCHIVE_RETRIEVAL_ENABLED",
  "GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION",
  "GITHUB_CLI_CREDENTIAL_KEK_KEYRING",
];

/**
 * Prepares GitHub CLI configuration for local development only.
 * Production configuration remains deployment-owned and is never generated here.
 */
export async function bootstrapLocalGitHubCli(options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const envFilePath =
    options.envFilePath ?? path.join(repoRoot, LOCAL_GITHUB_CLI_ENV_FILE);
  const shouldApplyToProcessEnv = options.applyToProcessEnv ?? false;
  const fileValues = readEnvFile(envFilePath);
  const effective = Object.fromEntries(
    LOCAL_GITHUB_CLI_KEYS.concat("NODE_ENV").map((key) => [
      key,
      env[key] ?? fileValues[key],
    ]),
  );

  if ((effective.NODE_ENV ?? "development").toLowerCase() === "production") {
    return { skipped: true, reason: "production" };
  }

  const executablePath = await resolveGitHubExecutablePath({
    repoRoot,
    configuredPath: effective.GITHUB_CLI_EXECUTABLE_PATH,
    platform,
    spawnSyncImpl: options.spawnSyncImpl ?? spawnSync,
    downloadImpl: options.downloadImpl,
    extractArchiveImpl: options.extractArchiveImpl,
    checksumManifestSha256: options.checksumManifestSha256,
  });
  const version = verifyExecutable({
    executablePath,
    spawnSyncImpl: options.spawnSyncImpl ?? spawnSync,
  });

  const persistenceEnabled = configuredOrDefault(
    effective.GITHUB_CLI_CREDENTIAL_PERSISTENCE_ENABLED,
    "true",
  );
  const updates = {
    GITHUB_CLI_CREDENTIAL_PERSISTENCE_ENABLED: persistenceEnabled,
    GITHUB_CLI_SNAPSHOT_PINNING_ENABLED: configuredOrDefault(
      effective.GITHUB_CLI_SNAPSHOT_PINNING_ENABLED,
      "true",
    ),
    GITHUB_CLI_ARCHIVE_RETRIEVAL_ENABLED: configuredOrDefault(
      effective.GITHUB_CLI_ARCHIVE_RETRIEVAL_ENABLED,
      "true",
    ),
    ...(persistenceEnabled.toLowerCase() === "true"
      ? resolveLocalKek({
          activeVersion: effective.GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION,
          encodedKeyring: effective.GITHUB_CLI_CREDENTIAL_KEK_KEYRING,
          randomBytesImpl: options.randomBytesImpl ?? randomBytes,
        })
      : {}),
  };

  writeEnvValues(envFilePath, updates);
  if (shouldApplyToProcessEnv) {
    Object.assign(process.env, updates);
    process.env.GITHUB_CLI_EXECUTABLE_PATH = executablePath;
  }

  console.log(`[dev-bootstrap] GitHub CLI: ${executablePath}`);
  console.log(`[dev-bootstrap] GitHub CLI version: ${version}`);
  const cliEnabled =
    updates.GITHUB_CLI_CREDENTIAL_PERSISTENCE_ENABLED.toLowerCase() ===
      "true" &&
    updates.GITHUB_CLI_SNAPSHOT_PINNING_ENABLED.toLowerCase() === "true" &&
    updates.GITHUB_CLI_ARCHIVE_RETRIEVAL_ENABLED.toLowerCase() === "true";
  console.log(
    `[dev-bootstrap] CLI integration: ${cliEnabled ? "enabled" : "disabled"}`,
  );
  console.log(
    `[dev-bootstrap] Local credential KEK: configured (${updates.GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION})`,
  );

  return {
    skipped: false,
    executablePath,
    version,
    envFilePath,
    activeKekVersion: updates.GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION,
  };
}

/**
 * Resolves the pinned GitLab CLI for local development before run.mjs starts
 * the API.
 */
export async function bootstrapLocalGitLabCli(options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd();
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const envFilePath =
    options.envFilePath ?? path.join(repoRoot, LOCAL_GITHUB_CLI_ENV_FILE);
  const fileValues = readEnvFile(envFilePath);
  const configuredPath =
    env.GITLAB_CLI_EXECUTABLE_PATH ?? fileValues.GITLAB_CLI_EXECUTABLE_PATH;
  if (
    (env.NODE_ENV ?? fileValues.NODE_ENV ?? "development").toLowerCase() ===
    "production"
  ) {
    return { skipped: true, reason: "production" };
  }

  const spawnSyncImpl = options.spawnSyncImpl ?? spawnSync;
  const explicit = configuredPath?.trim();
  if (explicit && !path.isAbsolute(explicit)) {
    throw new Error(
      "GITLAB_CLI_EXECUTABLE_PATH must be an absolute path when configured",
    );
  }

  let executablePath = explicit;
  if (executablePath && !isRunnableCli(executablePath, spawnSyncImpl, "glab")) {
    throw new Error(
      `GitLab CLI executable was not found or is not runnable: ${executablePath}`,
    );
  }
  if (!executablePath) {
    const candidate = resolveOnPath("glab", platform, spawnSyncImpl);
    if (candidate && isSupportedGitLabVersion(candidate, spawnSyncImpl)) {
      executablePath = candidate;
    }
  }
  if (!executablePath) {
    executablePath = await ensureManagedGitLabCli({
      repoRoot,
      platform,
      spawnSyncImpl,
      downloadImpl: options.downloadImpl,
      extractArchiveImpl: options.extractArchiveImpl,
    });
  }

  const updates = {
    GITLAB_CLI_EXECUTABLE_PATH: executablePath,
    GITLAB_PROVIDER_ENABLED:
      env.GITLAB_PROVIDER_ENABLED ??
      fileValues.GITLAB_PROVIDER_ENABLED ??
      "true",
  };
  if (options.persist !== false) writeEnvValues(envFilePath, updates);
  if (options.applyToProcessEnv ?? false) Object.assign(process.env, updates);
  console.log(`[dev-bootstrap] GitLab CLI: ${executablePath}`);
  console.log(
    `[dev-bootstrap] GitLab CLI version: ${SUPPORTED_GITLAB_CLI_VERSION}`,
  );
  return {
    skipped: false,
    executablePath,
    version: SUPPORTED_GITLAB_CLI_VERSION,
    envFilePath,
  };
}

function resolveOnPath(command, platform, spawnSyncImpl) {
  const lookup = platform === "win32" ? "where.exe" : "which";
  const result = spawnSyncImpl(lookup, [command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  if (result.status !== 0) return undefined;
  return String(result.stdout ?? "")
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .find((value) => value.length > 0 && path.isAbsolute(value));
}

function isRunnableCli(executablePath, spawnSyncImpl, command) {
  if (!existsSync(executablePath) || !statSync(executablePath).isFile())
    return false;
  const result = spawnSyncImpl(executablePath, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  return (
    result.status === 0 &&
    String(result.stdout ?? "").includes(
      `${command} ${SUPPORTED_GITLAB_CLI_VERSION}`,
    )
  );
}

function isSupportedGitLabVersion(executablePath, spawnSyncImpl) {
  return isRunnableCli(executablePath, spawnSyncImpl, "glab");
}

async function ensureManagedGitLabCli({
  repoRoot,
  platform,
  spawnSyncImpl,
  downloadImpl,
  extractArchiveImpl,
}) {
  const artifact = GITLAB_ARTIFACTS[platform];
  if (!artifact)
    throw new Error(
      `GitLab CLI ${SUPPORTED_GITLAB_CLI_VERSION} is not supported on ${platform}`,
    );
  const cacheDir = path.resolve(
    repoRoot,
    LOCAL_CLI_CACHE_ROOT,
    "gitlab-cli",
    SUPPORTED_GITLAB_CLI_VERSION,
  );
  const executableName = platform === "win32" ? "glab.exe" : "glab";
  const cached = findFile(cacheDir, executableName);
  if (cached && isRunnableCli(cached, spawnSyncImpl, "glab")) return cached;
  mkdirSync(cacheDir, { recursive: true });
  const archivePath = path.join(cacheDir, artifact.name);
  try {
    const bytes = downloadImpl
      ? await downloadImpl(artifact.name, platform)
      : new Uint8Array(
          await (
            await fetch(
              `https://gitlab.com/gitlab-org/cli/-/releases/v${SUPPORTED_GITLAB_CLI_VERSION}/downloads/${artifact.name}`,
            )
          ).arrayBuffer(),
        );
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== artifact.sha256)
      throw new Error("GitLab CLI checksum mismatch");
    writeFileSync(archivePath, bytes);
    if (extractArchiveImpl) {
      await extractArchiveImpl(archivePath, cacheDir);
    } else {
      const result = spawnSyncImpl(
        "tar",
        ["-xf", archivePath, "-C", cacheDir],
        {
          encoding: "utf8",
          stdio: ["ignore", "ignore", "pipe"],
          shell: false,
        },
      );
      if (result.status !== 0)
        throw new Error("GitLab CLI archive extraction failed");
    }
    const extracted = findFile(cacheDir, executableName);
    if (!extracted || !isRunnableCli(extracted, spawnSyncImpl, "glab")) {
      throw new Error(
        "GitLab CLI archive did not contain a runnable pinned binary",
      );
    }
    return extracted;
  } catch (error) {
    throw new Error(
      `GitLab CLI ${SUPPORTED_GITLAB_CLI_VERSION} provisioning failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

function findFile(root, name) {
  if (!existsSync(root)) return undefined;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase())
      return candidate;
    if (entry.isDirectory()) {
      const nested = findFile(candidate, name);
      if (nested) return nested;
    }
  }
  return undefined;
}

function readEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  return parse(readFileSync(filePath));
}

function configuredOrDefault(value, fallback) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

async function resolveGitHubExecutablePath({
  repoRoot,
  configuredPath,
  platform,
  spawnSyncImpl,
  downloadImpl,
  extractArchiveImpl,
  checksumManifestSha256,
}) {
  const explicit = configuredPath?.trim();
  if (explicit) {
    if (!path.isAbsolute(explicit)) {
      throw new Error(
        "GITHUB_CLI_EXECUTABLE_PATH must be an absolute path when configured",
      );
    }
    return explicit;
  }

  const cacheDir = path.resolve(
    repoRoot,
    LOCAL_CLI_CACHE_ROOT,
    "github-cli",
    SUPPORTED_GITHUB_CLI_VERSION,
  );
  const executableName = platform === "win32" ? "gh.exe" : "gh";
  const cached = findFile(cacheDir, executableName);
  if (cached && isRunnableGitHubCli(cached, spawnSyncImpl)) return cached;

  const candidate = resolveOnPath("gh", platform, spawnSyncImpl);
  if (candidate && isRunnableGitHubCli(candidate, spawnSyncImpl)) {
    return candidate;
  }

  return ensureManagedGitHubCli({
    repoRoot,
    platform,
    spawnSyncImpl,
    downloadImpl,
    extractArchiveImpl,
    checksumManifestSha256,
  });
}

function isRunnableGitHubCli(executablePath, spawnSyncImpl) {
  if (!existsSync(executablePath) || !statSync(executablePath).isFile()) {
    return false;
  }
  const result = spawnSyncImpl(executablePath, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  return (
    result.status === 0 &&
    String(result.stdout ?? "").includes(
      `gh version ${SUPPORTED_GITHUB_CLI_VERSION}`,
    )
  );
}

const GITHUB_ARTIFACTS = {
  win32: {
    name: `gh_${SUPPORTED_GITHUB_CLI_VERSION}_windows_amd64.zip`,
    checksumName: `gh_${SUPPORTED_GITHUB_CLI_VERSION}_checksums.txt`,
  },
  linux: {
    name: `gh_${SUPPORTED_GITHUB_CLI_VERSION}_linux_amd64.tar.gz`,
    checksumName: `gh_${SUPPORTED_GITHUB_CLI_VERSION}_checksums.txt`,
  },
};

const GITHUB_CHECKSUMS_SHA256 =
  "0af03f03d2952a1e1c5bc658cecefef507af521929b5a7d0b267a09df2a1df18";

async function ensureManagedGitHubCli({
  repoRoot,
  platform,
  spawnSyncImpl,
  downloadImpl,
  extractArchiveImpl,
  checksumManifestSha256 = GITHUB_CHECKSUMS_SHA256,
}) {
  const artifact = GITHUB_ARTIFACTS[platform];
  if (!artifact) {
    throw new Error(
      `GitHub CLI ${SUPPORTED_GITHUB_CLI_VERSION} is not supported on ${platform}`,
    );
  }
  const cacheDir = path.resolve(
    repoRoot,
    LOCAL_CLI_CACHE_ROOT,
    "github-cli",
    SUPPORTED_GITHUB_CLI_VERSION,
  );
  mkdirSync(path.dirname(cacheDir), { recursive: true });
  const tempDir = mkdtempSync(`${cacheDir}.tmp-`);
  try {
    const archiveBytes = await downloadAsset(
      artifact.name,
      platform,
      downloadImpl,
    );
    const checksumBytes = await downloadAsset(
      artifact.checksumName,
      platform,
      downloadImpl,
    );
    const checksumText = Buffer.from(checksumBytes).toString("utf8");
    if (
      createHash("sha256").update(checksumBytes).digest("hex") !==
      checksumManifestSha256
    ) {
      throw new Error("GitHub CLI checksum manifest integrity mismatch");
    }
    const expected = parseChecksum(checksumText, artifact.name);
    const actual = createHash("sha256").update(archiveBytes).digest("hex");
    if (actual !== expected)
      throw new Error("GitHub CLI artifact checksum mismatch");

    const archivePath = path.join(tempDir, artifact.name);
    writeFileSync(archivePath, archiveBytes, { mode: 0o600 });
    const extractionDir = path.join(tempDir, "extracted");
    mkdirSync(extractionDir, { recursive: true });
    if (extractArchiveImpl) {
      await extractArchiveImpl(archivePath, extractionDir);
    } else {
      const listing = spawnSyncImpl("tar", ["-tf", archivePath], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
      if (listing.status !== 0)
        throw new Error("GitHub CLI archive listing failed");
      assertSafeArchiveEntries(String(listing.stdout ?? ""));
      const result = spawnSyncImpl(
        "tar",
        ["-xf", archivePath, "-C", extractionDir],
        {
          encoding: "utf8",
          stdio: ["ignore", "ignore", "pipe"],
          shell: false,
        },
      );
      if (result.status !== 0)
        throw new Error("GitHub CLI archive extraction failed");
    }

    const executable = findFile(
      extractionDir,
      platform === "win32" ? "gh.exe" : "gh",
    );
    if (!executable || !statSync(executable).isFile()) {
      throw new Error("GitHub CLI archive did not contain a runnable binary");
    }
    const finalDir = path.join(cacheDir, "bin");
    mkdirSync(finalDir, { recursive: true });
    const finalPath = path.join(
      finalDir,
      platform === "win32" ? "gh.exe" : "gh",
    );
    rmSync(finalPath, { force: true });
    renameSync(executable, finalPath);
    if (!isRunnableGitHubCli(finalPath, spawnSyncImpl)) {
      throw new Error("Provisioned GitHub CLI is not runnable");
    }
    return finalPath;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function downloadAsset(name, platform, downloadImpl) {
  if (downloadImpl) return Buffer.from(await downloadImpl(name, platform));
  const response = await fetch(
    `https://github.com/cli/cli/releases/download/v${SUPPORTED_GITHUB_CLI_VERSION}/${name}`,
  );
  if (!response.ok)
    throw new Error(`GitHub CLI download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function parseChecksum(text, filename) {
  const line = text
    .split(/\r?\n/u)
    .find((entry) => entry.trim().endsWith(`  ${filename}`));
  const checksum = line?.trim().split(/\s+/u)[0];
  if (!checksum || !/^[a-f0-9]{64}$/u.test(checksum)) {
    throw new Error("GitHub CLI checksum manifest missing expected artifact");
  }
  return checksum;
}

function assertSafeArchiveEntries(listing) {
  for (const entry of listing
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean)) {
    const normalized = entry.replaceAll("\\", "/");
    if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
      throw new Error("GitHub CLI archive contains an unsafe path");
    }
  }
}

function verifyExecutable({ executablePath, spawnSyncImpl }) {
  if (!existsSync(executablePath) || !statSync(executablePath).isFile()) {
    throw new Error(`GitHub CLI executable was not found: ${executablePath}`);
  }

  const result = spawnSyncImpl(executablePath, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  const output = String(result.stdout ?? "");
  const version = /^gh version ([^\s]+)/mu.exec(output)?.[1];
  if (result.status !== 0 || !version) {
    throw new Error(`GitHub CLI executable is not runnable: ${executablePath}`);
  }
  if (version !== SUPPORTED_GITHUB_CLI_VERSION) {
    throw new Error(
      `Unsupported GitHub CLI version ${version}; LCSP requires ${SUPPORTED_GITHUB_CLI_VERSION}`,
    );
  }
  return version;
}

function resolveLocalKek({ activeVersion, encodedKeyring, randomBytesImpl }) {
  const version = activeVersion?.trim();
  const keyring = encodedKeyring?.trim();
  if (!version && !keyring) {
    const generatedVersion = "local-dev-v1";
    const generatedKey = randomBytesImpl(32).toString("base64");
    return {
      GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION: generatedVersion,
      GITHUB_CLI_CREDENTIAL_KEK_KEYRING: JSON.stringify({
        [generatedVersion]: generatedKey,
      }),
    };
  }
  if (!version || !keyring) {
    throw new Error(
      "Local GitHub CLI KEK configuration is incomplete; provide both GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION and GITHUB_CLI_CREDENTIAL_KEK_KEYRING.",
    );
  }
  if (!isValidKekKeyring(keyring, version)) {
    throw new Error(
      "Local GitHub CLI KEK configuration is malformed; the keyring must contain canonical Base64 32-byte keys and the active version.",
    );
  }
  return {
    GITHUB_CLI_CREDENTIAL_KEK_ACTIVE_VERSION: version,
    GITHUB_CLI_CREDENTIAL_KEK_KEYRING: keyring,
  };
}

function isValidKekKeyring(encodedKeyring, activeVersion) {
  let parsed;
  try {
    parsed = JSON.parse(encodedKeyring);
  } catch {
    return false;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !Object.hasOwn(parsed, activeVersion)
  ) {
    return false;
  }
  return Object.entries(parsed).every(([version, encoded]) => {
    if (!version || /[\r\n]/u.test(version) || typeof encoded !== "string") {
      return false;
    }
    const decoded = Buffer.from(encoded, "base64");
    const valid =
      decoded.length === 32 && decoded.toString("base64") === encoded;
    decoded.fill(0);
    return valid;
  });
}

function writeEnvValues(filePath, updates) {
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const lines = existing.split(/\r?\n/u);
  if (lines.length === 1 && lines[0] === "") lines.pop();
  for (const [key, value] of Object.entries(updates)) {
    const index = lines.findIndex((line) =>
      new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).test(line),
    );
    const line = `${key}=${value}`;
    if (index >= 0) lines[index] = line;
    else lines.push(line);
  }
  const next = `${lines.join("\n").replace(/\n*$/u, "")}\n`;
  if (next !== existing.replace(/\r\n/gu, "\n")) {
    writeFileSync(filePath, next, { encoding: "utf8", mode: 0o600 });
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
