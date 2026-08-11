import type { GetGapEvidenceTraceInput } from "@lcsp/contracts/evidence";

export class GetGapEvidenceTraceQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly input: GetGapEvidenceTraceInput,
    public readonly actorId: string,
    public readonly correlationId: string,
  ) {}
}
