import { Command } from "@nestjs/cqrs";
import type { WorkerAgentStreamEventRequest } from "@lcsp/contracts/evidence";

export class PublishAgentStreamEventCommand extends Command<{
  recorded: boolean;
  eventId: string | null;
}> {
  constructor(
    public readonly payload: WorkerAgentStreamEventRequest,
    public readonly correlationId?: string,
    public readonly leaseToken?: string,
  ) {
    super();
  }
}
