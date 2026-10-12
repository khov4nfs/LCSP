import type { RootActivityRequest } from "@lcsp/contracts/assessment-domain";
import { Command } from "@nestjs/cqrs";

export type RecordRootActivityResult = { eventId: string; sequence: number };

export class RecordRootActivityCommand extends Command<RecordRootActivityResult> {
  constructor(
    public readonly assessmentId: string,
    public readonly leaseToken: string,
    public readonly request: RootActivityRequest,
    public readonly correlationId: string,
  ) {
    super();
  }
}
