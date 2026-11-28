import { createHash } from "node:crypto";
import {
  ConflictException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AppConfig } from "../../../../config/config.types.js";

const THREAD_NAMESPACE = Buffer.from("b7b2697509de44e5a7d5c996523fd289", "hex");
const BOUNDARY_NAME = "rule_set_preparation_requested";

type AgentServerRun = {
  run_id?: unknown;
  runId?: unknown;
  status?: unknown;
};

const NATIVE_TERMINAL_STATUSES = new Set(["success", "error", "interrupted"]);

/**
 * AssessmentRuntimeControlService only signals stop at Assessment Root checkpoints; it cannot
 * cancel this run. Agent Server accepts thread/run IDs, so derive its canonical boundary thread
 * from the persisted correlation ID and use the native list/cancel endpoints.
 */
@Injectable()
export class AgentServerPreparationControl {
  constructor(
    @Optional()
    private readonly configService?: ConfigService<AppConfig>,
  ) {}

  /**
   * Business purpose: Confirm that one Preparation's native run is no longer executing.
   * Business rules: Only a recognized terminal Agent Server status or a successful empty run list proves completion.
   * Execution flow: 1. Resolve the canonical thread. 2. List runs. 3. Signal one active run and inspect its returned state.
   * Failure cases: Unknown states, multiple active runs, HTTP failure, and network errors reject so the DB request remains pending.
   * Side effects: Reads Agent Server state and may send one native cancellation request; does not mutate the database.
   */
  async cancel(preparationCorrelationId: string): Promise<void> {
    const baseUrl =
      this.configService?.get("agentServerUrl", { infer: true }) ||
      process.env.LCSP_AGENT_SERVER_URL;
    if (!baseUrl)
      throw new ServiceUnavailableException(
        "Agent runtime cancellation is unavailable",
      );

    const threadId = preparationThreadId(preparationCorrelationId);
    try {
      const listed = await fetch(
        new URL(`/threads/${threadId}/runs?limit=100`, baseUrl),
        { signal: AbortSignal.timeout(5_000) },
      );
      // Why: A missing HTTP route and a missing native run are indistinguishable at status 404.
      // How: Only a successful empty run list proves there is no active native execution.
      // Invariant: Poller must retain CANCEL_REQUESTED if Agent Server routing is unavailable.
      if (listed.status === 404)
        throw new ServiceUnavailableException(
          "Agent runtime cancellation is unavailable",
        );
      if (!listed.ok)
        throw new ServiceUnavailableException(
          "Agent runtime cancellation is unavailable",
        );
      const runs: unknown = await listed.json();
      if (!Array.isArray(runs))
        throw new ServiceUnavailableException(
          "Agent runtime returned an invalid run list",
        );
      // Why: An unknown native state cannot prove the provider has stopped.
      // How: Accept only current Local Agent Server terminal and active states.
      // Invariant: The DB cancellation fence stays pending when the runtime contract changes.
      if (
        (runs as AgentServerRun[]).some(
          (run) =>
            run.status !== "pending" &&
            run.status !== "running" &&
            !NATIVE_TERMINAL_STATUSES.has(String(run.status)),
        )
      )
        throw new ServiceUnavailableException(
          "Agent runtime returned an unknown run status",
        );
      const active = (runs as AgentServerRun[]).filter(
        (run) => run.status === "pending" || run.status === "running",
      );
      if (active.length === 0) return;
      if (active.length !== 1)
        throw new ConflictException(
          "Preparation has more than one active Agent Server run",
        );

      const runId = active[0]?.run_id ?? active[0]?.runId;
      if (typeof runId !== "string" || runId.length === 0)
        throw new ServiceUnavailableException(
          "Agent runtime returned an invalid run identity",
        );

      const cancelled = await fetch(
        new URL(
          `/threads/${threadId}/runs/${encodeURIComponent(runId)}/cancel`,
          baseUrl,
        ),
        { method: "POST", signal: AbortSignal.timeout(5_000) },
      );
      if (!cancelled.ok)
        throw new ServiceUnavailableException(
          "Agent runtime cancellation is unavailable",
        );
      const cancelledRun: unknown = await cancelled.json();
      const status =
        cancelledRun &&
        typeof cancelledRun === "object" &&
        "status" in cancelledRun
          ? cancelledRun.status
          : null;
      // Why: Native cancellation is cooperative; HTTP 200 can still mean the model is running.
      // How: Keep the durable DB request pending until a later poll sees a terminal native state.
      // Invariant: A queued or running native invocation is never reported as CANCELLED.
      if (typeof status !== "string" || !NATIVE_TERMINAL_STATUSES.has(status))
        throw new ServiceUnavailableException(
          "Agent runtime cancellation has not completed",
        );
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof ServiceUnavailableException
      )
        throw error;
      throw new ServiceUnavailableException(
        "Agent runtime cancellation is unavailable",
      );
    }
  }
}

export function preparationThreadId(correlationId: string): string {
  const name = `event:${BOUNDARY_NAME}:${correlationId}`;
  const digest = createHash("sha1")
    .update(THREAD_NAMESPACE)
    .update(name, "utf8")
    .digest();
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
