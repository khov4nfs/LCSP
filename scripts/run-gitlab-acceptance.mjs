import { spawn } from "node:child_process";
import { bootstrapLocalGitLabCli } from "./bootstrap-github-cli-dev.mjs";

if (!process.env.LCSP_ACCEPTANCE_GITLAB_REPOSITORY_URL) {
  throw new Error("LCSP_ACCEPTANCE_GITLAB_REPOSITORY_URL is required");
}
if (!process.env.LCSP_ACCEPTANCE_GITLAB_TOKEN) {
  throw new Error("LCSP_ACCEPTANCE_GITLAB_TOKEN is required");
}

const runtime = await bootstrapLocalGitLabCli({
  env: process.env,
  applyToProcessEnv: true,
  persist: false,
});
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(
  command,
  [
    "--filter",
    "@lcsp/api",
    "test",
    "--runInBand",
    "src/modules/github-integration/infrastructure/gitlab",
  ],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, GITLAB_CLI_EXECUTABLE_PATH: runtime.executablePath },
  },
);
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
