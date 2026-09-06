import { existsSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";

export type BitbucketCliCommand = {
  executablePath: string;
  args: string[];
};

/**
 * The managed Windows `bb` launcher is a batch file that forwards to bb.mjs.
 * Invoke its Node entrypoint directly so provider-controlled arguments never
 * pass through cmd.exe's command parser.
 */
export function resolveBitbucketCliCommand(
  executablePath: string,
  args: readonly string[],
): BitbucketCliCommand {
  if (process.platform === "win32" && extname(executablePath) === ".cmd") {
    const entrypoint = join(dirname(executablePath), "bb.mjs");
    if (existsSync(entrypoint) && statSync(entrypoint).isFile()) {
      return {
        executablePath: process.execPath,
        args: [entrypoint, ...args],
      };
    }
  }

  return { executablePath, args: [...args] };
}
