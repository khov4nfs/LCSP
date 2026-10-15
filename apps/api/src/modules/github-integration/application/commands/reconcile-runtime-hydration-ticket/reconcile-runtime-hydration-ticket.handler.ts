import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { RuntimeHydrationTicketLifecycle } from "../../services/runtime-hydration-ticket-lifecycle.service.js";
import { ReconcileRuntimeHydrationTicketCommand } from "./reconcile-runtime-hydration-ticket.command.js";

@CommandHandler(ReconcileRuntimeHydrationTicketCommand)
export class ReconcileRuntimeHydrationTicketHandler implements ICommandHandler<ReconcileRuntimeHydrationTicketCommand> {
  constructor(private readonly lifecycle: RuntimeHydrationTicketLifecycle) {}

  execute(command: ReconcileRuntimeHydrationTicketCommand) {
    return this.lifecycle.reconcileTerminalRuntime(command);
  }
}
