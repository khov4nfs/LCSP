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
  if (!fileExists(pnpmCli)) {
    throw new Error(
      "[dev] Corepack pnpm.js could not be resolved from the active Node installation.",
    );
  }

  return { command: execPath, args: [pnpmCli, ...args] };
}
