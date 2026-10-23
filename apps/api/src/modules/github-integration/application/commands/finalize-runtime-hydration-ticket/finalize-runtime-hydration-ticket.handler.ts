import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { RuntimeHydrationTicketLifecycle } from "../../services/runtime-hydration-ticket-lifecycle.service.js";
import { FinalizeRuntimeHydrationTicketCommand } from "./finalize-runtime-hydration-ticket.command.js";

@CommandHandler(FinalizeRuntimeHydrationTicketCommand)
export class FinalizeRuntimeHydrationTicketHandler implements ICommandHandler<FinalizeRuntimeHydrationTicketCommand> {
  constructor(private readonly lifecycle: RuntimeHydrationTicketLifecycle) {}

  execute(command: FinalizeRuntimeHydrationTicketCommand): Promise<void> {
    return this.lifecycle.finalizeDelivery(command);
  }
}
