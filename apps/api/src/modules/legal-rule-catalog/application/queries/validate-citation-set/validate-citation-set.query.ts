import type { ValidateCitationSetInput } from "@lcsp/contracts/evidence";

export class ValidateCitationSetQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly input: ValidateCitationSetInput,
    public readonly actorId: string,
    public readonly correlationId: string,
  ) {}
}
