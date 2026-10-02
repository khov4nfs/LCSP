import { spawnSync } from "node:child_process";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("[checks] Missing command.");
  process.exit(2);
}

const scopeEnabled =
  process.platform === "linux" &&
  process.env.XDG_RUNTIME_DIR &&
  !process.env.CI &&
  !process.env.LCSP_CHECK_MEMORY_SCOPE;

const result = scopeEnabled
  ? spawnSync(
      "systemd-run",
      [
        "--user",
        "--scope",
        "--collect",
        "--same-dir",
        "-p",
        "MemoryMax=3800M",
        "--setenv=LCSP_CHECK_MEMORY_SCOPE=1",
        command,
        ...args,
      ],
      { stdio: "inherit", env: process.env, shell: false },
    )
  : spawnSync(command, args, {
      stdio: "inherit",
      env: process.env,
      shell: process.platform === "win32",
    });

if (result.error) {
  console.error(`[checks] Failed to start ${command}: ${result.error.message}`);
}
if (result.signal) {
  process.kill(process.pid, result.signal);
}
process.exit(result.status ?? 1);
