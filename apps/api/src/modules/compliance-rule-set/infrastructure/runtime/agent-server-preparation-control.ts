import { createHash } from "node:crypto";
import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

const THREAD_NAMESPACE = Buffer.from("b7b2697509de44e5a7d5c996523fd289", "hex");
const BOUNDARY_NAME = "rule_set_preparation_requested";

type AgentServerRun = {
  run_id?: unknown;
  runId?: unknown;
  status?: unknown;
};

/**
 * AssessmentRuntimeControlService only signals stop at Assessment Root checkpoints; it cannot
 * cancel this run. Agent Server accepts thread/run IDs, so derive its canonical boundary thread
 * from the persisted correlation ID and use the native list/cancel endpoints.
 */
@Injectable()
export class AgentServerPreparationControl {
  async cancel(preparationCorrelationId: string): Promise<void> {
    const baseUrl = process.env.LCSP_AGENT_SERVER_URL;
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
      if (listed.status === 404) return;
      if (!listed.ok)
        throw new ServiceUnavailableException(
          "Agent runtime cancellation is unavailable",
        );
      const runs: unknown = await listed.json();
      if (!Array.isArray(runs))
        throw new ServiceUnavailableException(
          "Agent runtime returned an invalid run list",
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
      // A native run may finish between list and cancel. The domain row lock decides whether
      // publication or cancellation won; a stale transport status never delays domain settlement.
      if (cancelled.status === 404 || cancelled.status === 409) return;
      if (!cancelled.ok)
        throw new ServiceUnavailableException(
          "Agent runtime cancellation is unavailable",
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
