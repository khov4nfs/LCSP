import path from "node:path";
import process from "node:process";
import { existsSync } from "node:fs";

const pnpmCommand = "pnpm";

export function buildCommandInvocation(
  command,
  args,
  {
    platform = process.platform,
    execPath = process.execPath,
    pathEnv = process.env.PATH ?? process.env.Path ?? "",
    fileExists = existsSync,
  } = {},
) {
  if (platform !== "win32" || command !== pnpmCommand) {
    return { command, args: [...args] };
  }

  const pathApi = platform === "win32" ? path.win32 : path;
  const pnpmCli = pathApi.join(
    pathApi.dirname(execPath),
    "node_modules",
    "corepack",
    "dist",
    "pnpm.js",
  );
  if (fileExists(pnpmCli)) {
    return { command: execPath, args: [pnpmCli, ...args] };
  }

  for (const rawDirectory of pathEnv.split(pathApi.delimiter)) {
    const directory = rawDirectory.trim().replace(/^"(.*)"$/u, "$1");
    if (!directory) continue;

    const globalPnpmExe = pathApi.join(
      directory,
      "node_modules",
      "pnpm",
      "pnpm.exe",
    );
    if (fileExists(globalPnpmExe)) {
      return { command: globalPnpmExe, args: [...args] };
    }

    const globalPnpmCli = pathApi.join(
      directory,
      "node_modules",
      "pnpm",
      "bin",
      "pnpm.cjs",
    );
    if (fileExists(globalPnpmCli)) {
      return { command: execPath, args: [globalPnpmCli, ...args] };
    }
  }

  throw new Error(
    "[dev] pnpm could not be resolved. Install Corepack with pnpm or add a global pnpm installation to PATH.",
  );
}
