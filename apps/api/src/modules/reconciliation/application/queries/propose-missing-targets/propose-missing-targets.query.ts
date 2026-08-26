import type { TargetCandidateKind } from "../../contracts/missing-target-proposal.contract.js";

export class ProposeMissingTargetsQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly wizardProfileId: string,
    public readonly evidenceReportId: string,
    public readonly candidateKinds: TargetCandidateKind[],
    public readonly seedRefs: string[],
    public readonly excludeTargetIds: string[],
    public readonly maxResults: number,
    public readonly correlationId: string,
  ) {}
}
