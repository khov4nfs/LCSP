import { setTimeout } from "node:timers/promises";
import dotenv from "dotenv";

dotenv.config({
  path: process.env.LCSP_DEPLOY_ENV_FILE ?? ".env.pm2",
  quiet: true,
});
const key = process.env.WORKER_API_KEY;
if (!key)
  throw new Error("WORKER_API_KEY is required for authenticated native drain");
const url = `${(process.env.LCSP_AGENT_SERVER_URL ?? "http://127.0.0.1:2024").replace(/\/$/, "")}/internal/execution-capacity`;
const reopen = process.argv.includes("--resume-admission");

/**
 * Business purpose: Drain native execution before replacing its process/checkpointer.
 * Business rules:
 * - Never terminate an admitted Root or infer quiescence from lease TTL; keep credentials in headers.
 * Execution flow:
 * 1. Set the authenticated server drain flag and inspect actual future/reservation occupancy.
 * 2. For deployment, wait interruptibly until all physical execution is quiescent.
 * Failure cases:
 * - Invalid/failed/unsupported responses abort deployment; an interrupted command leaves drain enabled safely.
 * Side effects:
 * - Changes only server admission state and prints sanitized aggregate drain receipts.
 */
async function drain() {
  let method = "POST";
  for (;;) {
    const response = await fetch(url, {
      method,
      headers: { "x-worker-api-key": key, "content-type": "application/json" },
      body:
        method === "POST" ? JSON.stringify({ draining: !reopen }) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const envelope = await response.json();
    if (
      !response.ok ||
      envelope.ok !== true ||
      typeof envelope.data?.quiescent !== "boolean"
    ) {
      throw new Error(
        "Native drain unavailable; deployment must not replace the runtime",
      );
    }
    console.log(
      JSON.stringify({
        observedAt: new Date().toISOString(),
        ...envelope.data,
      }),
    );
    if (reopen || envelope.data.quiescent) return;
    method = "GET";
    await setTimeout(5000);
  }
}
await drain();
