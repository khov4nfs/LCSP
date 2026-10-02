import {
  bootstrapLocalAzureDevOpsCli,
  bootstrapLocalBitbucketCli,
  bootstrapLocalGitHubCli,
  bootstrapLocalGitLabCli,
} from "./bootstrap-github-cli-dev.mjs";

const bootstrapSteps = [
  ["GitHub", bootstrapLocalGitHubCli],
  ["GitLab", bootstrapLocalGitLabCli],
  ["Bitbucket", bootstrapLocalBitbucketCli],
  ["Azure DevOps", bootstrapLocalAzureDevOpsCli],
];
const bootstrapHeartbeatMs = resolveHeartbeatMs(
  process.env.LCSP_CLI_BOOTSTRAP_HEARTBEAT_MS,
);

console.log("[dev-bootstrap] Preparing local provider CLIs.");
for (const [provider, bootstrap] of bootstrapSteps) {
  await runBootstrapStep(provider, bootstrap);
}
console.log("[dev-bootstrap] Local provider CLI preparation complete.");

async function runBootstrapStep(provider, bootstrap) {
  const startedAt = Date.now();
  console.log(`[dev-bootstrap] ${provider} CLI: preparing...`);
  const heartbeat = setInterval(() => {
    console.log(
      `[dev-bootstrap] ${provider} CLI: still preparing (${formatElapsed(Date.now() - startedAt)})...`,
    );
  }, bootstrapHeartbeatMs);
  heartbeat.unref?.();

  try {
    const result = await bootstrap();
    const elapsed = formatElapsed(Date.now() - startedAt);
    if (result?.skipped) {
      console.log(
        `[dev-bootstrap] ${provider} CLI: skipped (${result.reason ?? "not required"}) after ${elapsed}.`,
      );
    } else {
      console.log(`[dev-bootstrap] ${provider} CLI: ready in ${elapsed}.`);
    }
  } catch (error) {
    const elapsed = formatElapsed(Date.now() - startedAt);
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[dev-bootstrap] ${provider} CLI: failed after ${elapsed}: ${message}`,
    );
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

function formatElapsed(milliseconds) {
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  return `${(milliseconds / 1_000).toFixed(1)}s`;
}

function resolveHeartbeatMs(value) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000;
}
