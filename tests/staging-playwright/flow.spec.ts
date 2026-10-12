import { spawn } from "node:child_process";
import { test, expect } from "@playwright/test";

test("owned exact-image staging flow", async () => {
  const runId = process.env.LCSP_STAGING_RUN_ID ?? "";
  const phase = process.env.LCSP_STAGING_PHASE ?? "";
  expect(runId).toMatch(/^[a-f0-9]{16}$/);
  expect(phase).not.toBe("");
  const args: string[] = JSON.parse(process.env.LCSP_STAGING_ARGS_JSON ?? "[]");
  const child = spawn(
    process.execPath,
    ["tests/staging-browser-flow.mjs", runId, phase, ...args],
    {
      stdio: "inherit",
    },
  );
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  expect(code).toBe(0);
});
