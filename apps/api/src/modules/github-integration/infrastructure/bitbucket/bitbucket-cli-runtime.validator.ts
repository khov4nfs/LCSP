import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import { GITHUB_CREDENTIAL_ERROR_CODES } from "@lcsp/contracts/github-integration";
import { BitbucketCliProviderError } from "./bitbucket-cli-repository.provider.js";
import { resolveBitbucketCliCommand } from "./bitbucket-cli-command.js";

export const SUPPORTED_BITBUCKET_CLI_VERSION = "0.1.0";

/** Resolve an explicit CLI override, or discover bb through PATH. */
export function resolveBitbucketCliExecutablePath(
  configuredPath: string,
  dependencies: { discover?: () => string; cwd?: string } = {},
): string {
  const candidate = configuredPath.trim();
  if (candidate) return candidate;
  let discovered: string;
  try {
    discovered = dependencies.discover?.() ?? discoverBitbucketCli();
  } catch {
    throw new BitbucketCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  }
  const absolutePath = resolve(dependencies.cwd ?? process.cwd(), discovered);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    throw new BitbucketCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  }
  return absolutePath;
}

export function assertBitbucketCliRuntime(
  executablePath: string,
  dependencies: {
    access?: (path: string, mode: number) => void;
    cwd?: string;
    spawn?: (
      executablePath: string,
      args: string[],
      options: {
        cwd?: string;
        encoding: "utf8";
        shell: false;
        stdio: ["ignore", "pipe", "ignore"];
      },
    ) => { status: number | null; stdout: string | Buffer };
  } = {},
): void {
  const cwd = dependencies.cwd ?? process.cwd();
  const validationPath = isAbsolute(executablePath)
    ? executablePath
    : resolve(cwd, executablePath);
  try {
    if (dependencies.access) {
      dependencies.access(validationPath, 1);
    } else if (
      !existsSync(validationPath) ||
      !statSync(validationPath).isFile()
    ) {
      throw new Error("bb_unavailable");
    }
  } catch {
    throw new BitbucketCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  }
  const command = resolveBitbucketCliCommand(executablePath, ["--version"]);
  const result = (dependencies.spawn ?? spawnSync)(
    command.executablePath,
    command.args,
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: false,
    },
  );
  if (
    result.status !== 0 ||
    !String(result.stdout ?? "").includes(SUPPORTED_BITBUCKET_CLI_VERSION)
  ) {
    throw new BitbucketCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  }
}

function discoverBitbucketCli(): string {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const output = execFileSync(locator, ["bb"], {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const firstMatch = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstMatch) throw new Error("bb_not_found");
  return firstMatch;
}
