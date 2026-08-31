import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import { GITHUB_CREDENTIAL_ERROR_CODES } from "@lcsp/contracts/github-integration";
import { GitLabCliProviderError } from "./gitlab-cli-repository.provider.js";

export const SUPPORTED_GITLAB_CLI_VERSION = "1.113.0";

/** Resolve an explicit CLI override, or discover glab through PATH. */
export function resolveGitLabCliExecutablePath(
  configuredPath: string,
  dependencies: { discover?: () => string; cwd?: string } = {},
): string {
  const candidate = configuredPath.trim();
  if (candidate) return candidate;
  let discovered: string;
  try {
    discovered = dependencies.discover?.() ?? discoverGitLabCli();
  } catch {
    throw new GitLabCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  }
  const absolutePath = resolve(dependencies.cwd ?? process.cwd(), discovered);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    throw new GitLabCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  }
  return absolutePath;
}

export function assertGitLabCliRuntime(
  executablePath: string,
  dependencies: {
    access?: (path: string, mode: number) => void;
    spawn?: (
      executablePath: string,
      args: string[],
      options: {
        encoding: "utf8";
        shell: false;
        stdio: ["ignore", "pipe", "ignore"];
      },
    ) => { status: number | null; stdout: string | Buffer };
  } = {},
): void {
  let fileAvailable = false;
  try {
    if (dependencies.access) dependencies.access(executablePath, 1);
    fileAvailable =
      existsSync(executablePath) && statSync(executablePath).isFile();
  } catch {
    fileAvailable = false;
  }
  if (!isAbsolute(executablePath) || !fileAvailable) {
    throw new GitLabCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  }
  const result = (dependencies.spawn ?? spawnSync)(
    executablePath,
    ["--version"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: false,
    },
  );
  if (
    result.status !== 0 ||
    !String(result.stdout ?? "").includes(
      `glab ${SUPPORTED_GITLAB_CLI_VERSION}`,
    )
  ) {
    throw new GitLabCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  }
}

function discoverGitLabCli(): string {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const output = execFileSync(locator, ["glab"], {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const firstMatch = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstMatch) throw new Error("glab_not_found");
  return firstMatch;
}
