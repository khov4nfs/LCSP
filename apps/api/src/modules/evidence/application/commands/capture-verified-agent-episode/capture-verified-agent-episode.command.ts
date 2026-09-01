export type CaptureVerifiedAgentEpisodeInput = {
  record_id?: unknown;
  recordId?: unknown;
  owner_agent?: unknown;
  ownerAgent?: unknown;
  workflow_run_id?: unknown;
  workflowRunId?: unknown;
  assessment_id?: unknown;
  assessmentId?: unknown;
  engineering_rule_ids?: unknown;
  engineeringRuleIds?: unknown;
  artifact_versions?: unknown;
  artifactVersions?: unknown;
  trust_level?: unknown;
  trustLevel?: unknown;
  validation_status?: unknown;
  validationStatus?: unknown;
  schema_version?: unknown;
  schemaVersion?: unknown;
  content_hash?: unknown;
  contentHash?: unknown;
  domain_key?: unknown;
  domainKey?: unknown;
  input_signature?: unknown;
  inputSignature?: unknown;
  successful_strategy_summary?: unknown;
  successfulStrategySummary?: unknown;
  evidence_refs?: unknown;
  evidenceRefs?: unknown;
  prompt_version?: unknown;
  promptVersion?: unknown;
  model_id?: unknown;
  modelId?: unknown;
  summary?: unknown;
  handoff?: unknown;
  handoffJson?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
  expires_at?: unknown;
  expiresAt?: unknown;
  status?: unknown;
};

export class CaptureVerifiedAgentEpisodeCommand {
  constructor(
    public readonly assessmentId: string,
    public readonly input: CaptureVerifiedAgentEpisodeInput,
    public readonly userId: string,
    public readonly correlationId: string,
  ) {}
}
