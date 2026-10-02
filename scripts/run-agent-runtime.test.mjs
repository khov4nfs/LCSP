import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./run.mjs", import.meta.url), "utf8");
const developmentDockerfile = await readFile(
  new URL("../deepagents/Dockerfile.dev", import.meta.url),
  "utf8",
);

test("agent-runtime startup does not rely on generated managed build state", () => {
  const retiredCli = ["m", "d", "a"].join("");
  const legacyBuildDir = [".", retiredCli].join("");
  const legacyDevCommand = new RegExp(
    `\\b${[retiredCli, "dev"].join("\\s+")}\\b`,
    "u",
  );
  const start = source.indexOf("function prepareAgentRuntime()");
  const end = source.indexOf("function stopStaleAgentRuntimeProcesses()");
  assert.ok(start >= 0 && end > start);

  const prepareRuntime = source.slice(start, end);
  assert.match(prepareRuntime, /stopStaleAgentRuntimeProcesses\(\);/u);
  assert.doesNotMatch(prepareRuntime, /mkdirSync/u);
  assert.doesNotMatch(source, /managedAgentPersistenceDir/u);
  assert.doesNotMatch(
    source,
    new RegExp(
      `path\\.join\\(\\s*workerRoot,\\s*["']${legacyBuildDir}["'],\\s*["']build["']`,
      "u",
    ),
  );
  assert.doesNotMatch(source, legacyDevCommand);
});

test("dev supervisor identifies the child that terminates the stack", () => {
  const retiredSandboxMessage = ["LangSmith", "Sandbox", "access"].join(" ");
  assert.ok(
    source.includes(
      "[run] ${member} exited with code ${code}. Stopping remaining processes.",
    ),
  );
  assert.ok(!source.includes(retiredSandboxMessage));
  assert.match(source, /pnpm dev:app/u);
});

test("agent runtime disables LangSmith control-plane env unless explicitly enabled", () => {
  assert.match(source, /function hardenLangSmithEnv\(env\)/u);
  assert.match(source, /LCSP_LANGSMITH_TRACING/u);
  assert.match(source, /LANGGRAPH_CLOUD_LICENSE_KEY/u);
  assert.match(source, /LANGSMITH_TRACING = "false"/u);
  assert.match(source, /LANGCHAIN_TRACING_V2 = "false"/u);
});

test("agent runtime sets explicit local LangGraph concurrency", () => {
  assert.match(source, /LCSP_AGENT_RUNTIME_JOBS_PER_WORKER/u);
  assert.match(source, /--n-jobs-per-worker/u);
  assert.match(source, /resolvePositiveInteger/u);
  assert.match(source, /"1"/u);
});

test("development worker image installs the LangGraph CLI used by its entrypoint", () => {
  assert.match(developmentDockerfile, /uv sync --frozen --extra dev/u);
  assert.doesNotMatch(developmentDockerfile, /uv sync --frozen --no-dev/u);
});

test("optional observability failure does not stop Agent Runtime services", () => {
  assert.match(source, /optional: target\.optional === true/u);
  assert.match(
    source,
    /if \(optional\) \{[\s\S]*core dev services remain running\.[\s\S]*return;/u,
  );
  assert.match(source, /phoenix: \{[\s\S]*optional: true,/u);
});

test("docker worker env forwards every provider credential pool the worker rotates", async () => {
  const credentials = await readFile(
    new URL("../deepagents/provider_credentials.py", import.meta.url),
    "utf8",
  );
  const table = credentials.slice(
    credentials.indexOf("PROVIDER_KEY_ENV = {"),
    credentials.indexOf("}", credentials.indexOf("PROVIDER_KEY_ENV = {")),
  );
  const keyEnvNames = [...table.matchAll(/"([A-Z0-9_]+_API_KEY)"/gu)].map(
    ([, name]) => name,
  );
  assert.ok(keyEnvNames.length >= 4, "provider key table must be parsed");

  const start = source.indexOf("function dockerWorkerEnv()");
  const end = source.indexOf("return {", start);
  assert.ok(start >= 0 && end > start);
  const workerEnv = source.slice(start, end);
  for (const name of keyEnvNames) {
    assert.match(
      workerEnv,
      new RegExp(`"${name}"`, "u"),
      `${name} is not forwarded`,
    );
  }
  assert.match(workerEnv, /"INCEPTION_BASE_URL"/u);
  assert.match(workerEnv, /"LLM_PROVIDER_TIMEOUT_SECONDS"/u);
  // The timeout is shared by every provider; per-provider variants are not forwarded.
  assert.doesNotMatch(workerEnv, /LLM_PROVIDER_TIMEOUT_SECONDS_/u);
});
