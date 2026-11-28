import { randomUUID } from "node:crypto";
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import {
  AGENT_STREAM_BOUNDARY_TYPES,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
} from "@lcsp/contracts/evidence";
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import { AgentExecutionState, Prisma } from "@prisma/client";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { PublishAgentStreamEventCommand } from "../../../assessment/application/commands/publish-agent-stream-event/publish-agent-stream-event.command.js";
import { AgentServerPreparationControl } from "./agent-server-preparation-control.js";

const POLL_INTERVAL_MS = 1_000;
const POLL_BATCH_SIZE = 25;

/** Retries committed cancellation requests without holding database locks across network I/O. */
@Injectable()
export class PreparationCancellationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PreparationCancellationService.name);
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private lastScannedRunId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: AgentServerPreparationControl,
    private readonly commands: CommandBus,
  ) {}

  /**
   * Business purpose: Resume pending preparation cancellation after API startup.
   * Business rules:
   * - Only the current module instance starts its local retry timer.
   * Execution flow:
   * 1. Schedule bounded polling. 2. Start one immediate pass for recovered requests.
   * Failure cases:
   * - Poll errors are handled by poll and leave requests pending for a later pass.
   * Side effects:
   * - Starts one timer and may contact the database and Agent Server asynchronously.
   */
  onModuleInit(): void {
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    void this.poll();
  }

  /**
   * Business purpose: Stop cancellation retries when this API module shuts down.
   * Business rules:
   * - Durable pending requests remain in the database for another process or restart.
   * Execution flow:
   * 1. Clear the local timer. 2. Reset its handle.
   * Failure cases:
   * - A missing timer is a harmless no-op.
   * Side effects:
   * - Stops future local polling without changing persisted run state.
   */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Business purpose: Finish durable preparation cancellation after a request has committed.
   * Business rules:
   * - Only CANCEL_REQUESTED runs are contacted; an uncertain native stop leaves the request pending.
   * Execution flow:
   * 1. Read a bounded batch. 2. Signal each native run outside a transaction. 3. Lock and settle only unchanged requests.
   * Failure cases:
   * - Network and DB errors leave the row retryable and are logged without sensitive payloads.
   * Side effects:
   * - Calls Agent Server, updates run state, and publishes completion activity.
   */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const pending = await this.prisma.ruleSetPreparationRun.findMany({
        where: {
          executionState: AgentExecutionState.CANCEL_REQUESTED,
          ...(this.lastScannedRunId
            ? { id: { gt: this.lastScannedRunId } }
            : {}),
        },
        orderBy: { id: "asc" },
        take: POLL_BATCH_SIZE,
        select: { id: true, correlationId: true },
      });
      // Why: A fixed first page can starve later requests when its native runs keep failing.
      // How: Advance a local ID cursor after a full batch, then wrap to the beginning.
      // Invariant: Every pending row remains retryable after process restart; no cursor is persisted as authority.
      this.lastScannedRunId =
        pending.length === POLL_BATCH_SIZE
          ? (pending[pending.length - 1]?.id ?? null)
          : null;
      for (const run of pending) {
        try {
          await this.runtime.cancel(run.correlationId);
          const changed = await this.prisma.$transaction(async (tx) => {
            // The native call has completed; reacquire authority before declaring the run terminal.
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "RuleSetPreparationRun" WHERE "id" = ${run.id} FOR UPDATE`,
            );
            const settled = await tx.ruleSetPreparationRun.updateMany({
              where: {
                id: run.id,
                executionState: AgentExecutionState.CANCEL_REQUESTED,
              },
              data: {
                executionState: AgentExecutionState.CANCELLED,
                failureReason: null,
                completedAt: new Date(),
              },
            });
            return settled.count === 1;
          });
          if (changed)
            await this.publishCancellationActivity(run.id, run.correlationId);
        } catch (error) {
          this.logger.warn("Preparation cancellation remains pending", {
            preparationRunId: run.id,
            correlationId: run.correlationId,
            errorType: error instanceof Error ? error.name : "UnknownError",
          });
        }
      }
    } catch (error) {
      this.logger.warn("Preparation cancellation poll failed", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    } finally {
      this.polling = false;
    }
  }

  /**
   * Business purpose: Notify Admin listeners only after cancellation is terminal.
   * Business rules:
   * - The durable run state is authoritative; stream delivery is best-effort.
   * Execution flow:
   * 1. Build the canonical cancellation event. 2. Dispatch it to the stream boundary.
   * Failure cases:
   * - Telemetry failure is logged and does not revert a committed cancellation.
   * Side effects:
   * - May persist an Agent Stream event.
   */
  async publishCancellationActivity(
    preparationRunId: string,
    correlationId: string,
  ): Promise<void> {
    try {
      await this.commands.execute(
        new PublishAgentStreamEventCommand(
          {
            event_id: randomUUID(),
            run_id: preparationRunId,
            preparation_run_id: preparationRunId,
            correlation_id: correlationId,
            event_type:
              ASSESSMENT_AGENT_STREAM_EVENT_TYPES.preparationCancelled,
            source: "admin",
            status: ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
            data: {
              boundary_type: AGENT_STREAM_BOUNDARY_TYPES.ruleSetPreparation,
              execution_state: AGENT_EXECUTION_STATES.CANCELLED,
            },
          },
          correlationId,
        ),
      );
    } catch (error) {
      this.logger.warn("Preparation cancellation activity was not published", {
        preparationRunId,
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
}
