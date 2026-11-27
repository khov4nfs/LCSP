/**
 * Why: Provides automated periodic recovery sweeping of expired in-flight invocation leases (ADR-028 Line 92, Line 155).
 * How: Implements OnModuleInit and OnModuleDestroy with periodic setInterval executing SweepExpiredInvocationLeasesCommand.
 * Invariants: Operates in background without blocking web traffic; preserves financial exposure on all swept admissions.
 */

import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CommandBus } from "@nestjs/cqrs";
import type { SweepExpiredLeasesResponse } from "@lcsp/contracts/billing";
import { SweepExpiredInvocationLeasesCommand } from "../../application/commands/sweep-expired-invocation-leases/sweep-expired-invocation-leases.command.js";

@Injectable()
export class BillingReconciliationSweeperService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(BillingReconciliationSweeperService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly commandBus: CommandBus,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Business purpose: Initialize and start the periodic lease recovery sweeper background timer.
   *
   * Business rules:
   * - Sweeper starts only if enabled via configuration (`billing.reconciliationSweeper.enabled`).
   * - Configured interval defaults to 60,000ms if not explicitly overridden.
   *
   * Execution flow:
   * 1. Query configuration for enablement status.
   * 2. Log and exit early if sweeper is disabled.
   * 3. Read configured interval in milliseconds.
   * 4. Register periodic timer via setInterval invoking this.sweep().
   * 5. Log startup confirmation with active interval.
   *
   * Failure cases:
   * - Invalid interval defaults to 60s fallback without crashing lifecycle.
   *
   * Side effects:
   * - Registers an active NodeJS background interval timer.
   */
  onModuleInit(): void {
    const enabled = this.configService.get<boolean>(
      "billing.reconciliationSweeper.enabled",
      true,
    );

    if (!enabled) {
      this.logger.log("Billing reconciliation sweeper is disabled by configuration");
      return;
    }

    const intervalMs = this.configService.get<number>(
      "billing.reconciliationSweeper.intervalMs",
      60_000,
    );

    this.timer = setInterval(() => {
      void this.sweep();
    }, intervalMs);

    this.logger.log(
      `Billing reconciliation sweeper started with interval ${intervalMs}ms`,
    );
  }

  /**
   * Business purpose: Clean up and stop the periodic recovery background timer upon application shutdown.
   *
   * Business rules:
   * - Must clear active interval timer to prevent dangling handles during NestJS shutdown.
   *
   * Execution flow:
   * 1. Check if timer handle is non-null.
   * 2. Call clearInterval on active timer handle.
   * 3. Set timer handle reference to null.
   *
   * Failure cases:
   * - None; no-op if timer was already null or cleared.
   *
   * Side effects:
   * - Clears NodeJS timer reference, enabling graceful process termination.
   */
  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Business purpose: Periodically triggers the sweeper command to reclaim abandoned in-flight leases.
   *
   * Business rules:
   * - Only one sweep cycle can execute at a time (mutex lock via `running` flag).
   * - Executes `SweepExpiredInvocationLeasesCommand` with standard batch size.
   *
   * Execution flow:
   * 1. Check mutex flag; return early if previous sweep cycle is still running.
   * 2. Set running flag to true.
   * 3. Dispatch `SweepExpiredInvocationLeasesCommand` with batch size 50.
   * 4. Clear running flag in finally block.
   *
   * Failure cases:
   * - Logs error and releases mutex if command dispatch fails.
   *
   * Side effects:
   * - Dispatches background CQRS command which mutates database state.
   */
  async sweep(): Promise<SweepExpiredLeasesResponse | null> {
    if (this.running) {
      return null;
    }
    this.running = true;

    try {
      const result: SweepExpiredLeasesResponse = await this.commandBus.execute(
        new SweepExpiredInvocationLeasesCommand(
          { batchSize: 50 },
          "scheduled-reconciliation-sweep",
        ),
      );

      if (result.sweptCount > 0) {
        this.logger.log(
          `Automated sweep completed: ${result.sweptCount} expired leases transitioned, ${result.reconciliationCasesOpened} cases opened`,
        );
      }

      return result;
    } catch (err) {
      this.logger.error("Error occurred during automated reconciliation sweep", err);
      return null;
    } finally {
      this.running = false;
    }
  }
}
