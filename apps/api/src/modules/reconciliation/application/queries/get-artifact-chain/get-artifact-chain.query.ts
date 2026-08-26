import type { ArtifactChainStage } from "@lcsp/contracts/evidence";

export class GetArtifactChainQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly correlationId: string,
    public readonly artifactRef: string | null = null,
    public readonly requiredStages: ArtifactChainStage[] = [],
    public readonly exactVersions = false,
  ) {}
}
