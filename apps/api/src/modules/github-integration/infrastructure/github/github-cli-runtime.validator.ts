import { constants, accessSync, existsSync, statSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";

import { GITHUB_CREDENTIAL_ERROR_CODES } from "@lcsp/contracts/github-integration";

import { GitHubCliProviderError } from "./github-cli-repository.provider.js";

export const SUPPORTED_GITHUB_CLI_VERSION = "2.98.0";

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
  access: (path: string, mode: number) => void;
  spawn: (
    executablePath: string,
    args: string[],
    options: {
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
  try {
    dependencies.access(executablePath, constants.X_OK);
    const result = dependencies.spawn(executablePath, ["--version"], {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 5_000,
      env: minimalVersionEnvironment(),
    });
    if (
      result.status !== 0 ||
      !result.stdout.startsWith(`gh version ${SUPPORTED_GITHUB_CLI_VERSION}`)
    ) {
      throw new Error("unsupported");
    }
  } catch {
    throw new GitHubCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  }
}

function minimalVersionEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
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
