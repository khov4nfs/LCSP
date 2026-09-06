import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import { GITHUB_CREDENTIAL_ERROR_CODES } from "@lcsp/contracts/github-integration";
import { AzureDevOpsCliProviderError } from "./azure-devops-cli-repository.provider.js";

export const SUPPORTED_AZURE_DEVOPS_CLI_VERSION = "2.60.0";

/** Resolve an explicit CLI override, or discover az through PATH. */
export function resolveAzureDevOpsCliExecutablePath(
  configuredPath: string,
  dependencies: { discover?: () => string; cwd?: string } = {},
): string {
  const candidate = configuredPath.trim();
  if (candidate) return candidate;
  let discovered: string;
  try {
    discovered = dependencies.discover?.() ?? discoverAzureDevOpsCli();
  } catch {
    throw new AzureDevOpsCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  }
  const absolutePath = resolve(dependencies.cwd ?? process.cwd(), discovered);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    throw new AzureDevOpsCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  }
  return absolutePath;
}

export function assertAzureDevOpsCliRuntime(
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
      throw new Error("az_unavailable");
    }
  } catch {
    throw new AzureDevOpsCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  }
  const result = (dependencies.spawn ?? spawnSync)(
    executablePath,
    ["--version"],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: false,
    },
  );
  const output = String(result.stdout ?? "");
  if (
    result.status !== 0 ||
    (!output.includes("azure-cli") &&
      !output.includes("az ") &&
      !output.includes("azure-devops") &&
      !output.includes(SUPPORTED_AZURE_DEVOPS_CLI_VERSION))
  ) {
    throw new AzureDevOpsCliProviderError(
      GITHUB_CREDENTIAL_ERROR_CODES.providerClientUnavailable,
    );
  }
}

function discoverAzureDevOpsCli(): string {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const output = execFileSync(locator, ["az"], {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const firstMatch = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstMatch) throw new Error("az_not_found");
  return firstMatch;
}
