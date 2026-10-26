import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { RuntimeHydrationTicketLifecycle } from "../../services/runtime-hydration-ticket-lifecycle.service.js";
import { FinalizeRuntimeHydrationTicketCommand } from "./finalize-runtime-hydration-ticket.command.js";

@CommandHandler(FinalizeRuntimeHydrationTicketCommand)
export class FinalizeRuntimeHydrationTicketHandler implements ICommandHandler<FinalizeRuntimeHydrationTicketCommand> {
  constructor(private readonly lifecycle: RuntimeHydrationTicketLifecycle) {}

  /**
   * Business purpose: Apply the streamed archive outcome to the matching runtime-hydration ticket.
   *
   * Business rules:
   * - Ticket identity, allowed terminal outcomes, idempotency, and concurrent delivery checks are owned by the lifecycle service.
   * - The command handler does not reinterpret archive success or failure.
   *
   * Execution flow:
   * 1. Pass the command's ticket, snapshot, and outcome to the hydration lifecycle.
   * 2. Resolve when the lifecycle has accepted the terminal state.
   *
   * Failure cases:
   * - Lifecycle identity, state, or race conflicts propagate to the command boundary without being converted to success.
   *
   * Side effects:
   * - Delegates the conditional runtime-hydration ticket update to the lifecycle service.
   */
  execute(command: FinalizeRuntimeHydrationTicketCommand): Promise<void> {
    return this.lifecycle.finalizeDelivery(command);
  }
}
