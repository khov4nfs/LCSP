export type RetrieveVerifiedAgentEpisodesInput = {
  ownerAgent?: unknown;
  owner_agent?: unknown;
  engineeringRuleIds?: unknown;
  engineering_rule_ids?: unknown;
  artifactVersions?: unknown;
  artifact_versions?: unknown;
  limit?: unknown;
};

export class RetrieveVerifiedAgentEpisodesQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly input: RetrieveVerifiedAgentEpisodesInput,
    public readonly userId: string,
    public readonly correlationId: string,
  ) {}
}
