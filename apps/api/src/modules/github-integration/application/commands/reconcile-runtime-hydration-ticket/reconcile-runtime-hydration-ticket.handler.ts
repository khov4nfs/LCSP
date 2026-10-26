import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { RuntimeHydrationTicketLifecycle } from "../../services/runtime-hydration-ticket-lifecycle.service.js";
import { ReconcileRuntimeHydrationTicketCommand } from "./reconcile-runtime-hydration-ticket.command.js";

@CommandHandler(ReconcileRuntimeHydrationTicketCommand)
export class ReconcileRuntimeHydrationTicketHandler implements ICommandHandler<ReconcileRuntimeHydrationTicketCommand> {
  constructor(private readonly lifecycle: RuntimeHydrationTicketLifecycle) {}

  /**
   * Business purpose: Reconcile a stranded runtime-hydration ticket after its Assessment Root execution reaches a verified terminal state.
   *
   * Business rules:
   * - The lifecycle service must verify ticket identity, pinned case, runtime lease state, and completed Root turn before reconciliation.
   * - A terminal Root does not prove the archive was fetched, so unresolved delivery is preserved as an unproven failure.
   *
   * Execution flow:
   * 1. Pass the requested ticket and snapshot identity to the lifecycle service.
   * 2. Return its status and whether the conditional reconciliation changed persistence.
   *
   * Failure cases:
   * - Active delivery, identity mismatch, nonterminal runtime, or reconciliation races propagate as lifecycle conflicts.
   *
   * Side effects:
   * - May transition a verified stranded ticket to its explicit outcome-unproven failure state through the lifecycle service.
   */
  execute(command: ReconcileRuntimeHydrationTicketCommand) {
    return this.lifecycle.reconcileTerminalRuntime(command);
  }
}
