import type { RetrieveLegalBasisInput } from "@lcsp/contracts/evidence";

export class RetrieveLegalBasisQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly input: RetrieveLegalBasisInput,
    public readonly actorId: string,
    public readonly correlationId: string,
  ) {}
}
