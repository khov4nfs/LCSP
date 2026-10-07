import type { OpenHumanResolutionRequest } from "@lcsp/contracts/assessment";
import { Command } from "@nestjs/cqrs";

export type OpenHumanRequestResult = {
  requestId: string;
  caseRevision: number;
};

export class OpenHumanRequestCommand extends Command<OpenHumanRequestResult> {
  constructor(
    public readonly assessmentId: string,
    public readonly leaseToken: string,
    public readonly request: OpenHumanResolutionRequest,
    public readonly correlationId: string,
  ) {
    super();
  }
}
