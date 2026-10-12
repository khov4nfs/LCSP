import { constants, accessSync, existsSync, statSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { GITHUB_CREDENTIAL_ERROR_CODES } from "@lcsp/contracts/github-integration";

import { GitHubCliProviderError } from "./github-cli-repository.provider.js";

/** Minimum GitHub CLI version supported by the provider adapter. */
export const SUPPORTED_GITHUB_CLI_VERSION = "2.95.0";

/** Resolve an explicit CLI override, or discover `gh` through PATH. */
export function resolveGitHubCliExecutablePath(
  configuredPath: string,
  dependencies: {
    discover?: () => string;
    cwd?: string;
  } = {},
): string {
  const candidate = configuredPath.trim();
  if (candidate) return candidate;

  let discovered: string;
  try {
    discovered = dependencies.discover?.() ?? discoverGitHubCli();
  } catch {
    throw new GitHubCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  }
  const absolutePath = resolve(dependencies.cwd ?? process.cwd(), discovered);
  if (
    !isAbsolute(absolutePath) ||
    !existsSync(absolutePath) ||
    !statSync(absolutePath).isFile()
  ) {
    throw new GitHubCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  }
  return absolutePath;
}

type GitHubCliRuntimeValidationDependencies = {
  access?: (path: string, mode: number) => void;
  cwd?: string;
  spawn?: (
    executablePath: string,
    args: string[],
    options: {
      cwd?: string;
      encoding: "utf8";
      shell: false;
      windowsHide: true;
      timeout: number;
      env: NodeJS.ProcessEnv;
    },
  ) => { status: number | null; stdout: string };
};

export function assertGitHubCliRuntime(
  executablePath: string,
  dependencies: GitHubCliRuntimeValidationDependencies = {
    access: accessSync,
    spawn: spawnSync,
  },
): void {
  const cwd = dependencies.cwd ?? process.cwd();
  const validationPath = isAbsolute(executablePath)
    ? executablePath
    : resolve(cwd, executablePath);
  try {
    (dependencies.access ?? accessSync)(validationPath, constants.X_OK);
    const result = (dependencies.spawn ?? spawnSync)(
      executablePath,
      ["--version"],
      {
        cwd,
        encoding: "utf8",
        shell: false,
        windowsHide: true,
        timeout: 5_000,
        env: minimalVersionEnvironment(),
      },
    );
    const version = parseGitHubCliVersion(String(result.stdout ?? ""));
    if (
      result.status !== 0 ||
      !version ||
      !isAtLeast(version, SUPPORTED_GITHUB_CLI_VERSION)
    ) {
      throw new Error("unsupported");
    }
  } catch {
    throw new GitHubCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  }
}

function parseGitHubCliVersion(output: string): string | null {
  const match = /^gh version (\d+\.\d+\.\d+)/u.exec(output.trim());
  return match?.[1] ?? null;
}

function isAtLeast(version: string, minimum: string): boolean {
  const current = version.split(".").map(Number);
  const required = minimum.split(".").map(Number);
  for (let index = 0; index < required.length; index += 1) {
    if (current[index] !== required[index]) {
      return current[index] > required[index];
    }
  }
  return true;
}

function minimalVersionEnvironment(): NodeJS.ProcessEnv {
  const runtimeStateRoot = join(tmpdir(), "lcsp-gh-runtime-validation");
  const environment: NodeJS.ProcessEnv = {
    GH_CONFIG_DIR: join(runtimeStateRoot, "config"),
    XDG_STATE_HOME: join(runtimeStateRoot, "state"),
  };
  for (const name of ["SystemRoot", "WINDIR", "ComSpec"] as const) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  return environment;
}

function discoverGitHubCli(): string {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  try {
    const output = execFileSync(locator, ["gh"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const firstMatch = output
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean);
    if (!firstMatch) throw new Error("gh_not_found");
    return firstMatch;
  } catch {
    throw new GitHubCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  }
}
