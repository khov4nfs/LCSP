import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "@lcsp/contracts/evidence";

export const PROVIDER_INVOCATION_PROVIDERS = {
  openai: "OPENAI",
  google: "GOOGLE",
  anthropic: "ANTHROPIC",
  azureOpenai: "AZURE_OPENAI",
  other: "OTHER",
} as const;

export type ProviderInvocationProvider =
  (typeof PROVIDER_INVOCATION_PROVIDERS)[keyof typeof PROVIDER_INVOCATION_PROVIDERS];

export type ProviderInvocationResponse = {
  status: AgenticToolStatus;
  tool_name: AgenticToolName;
  tool_version: string;
  config_hash: string;
  correlation_id: string;
  artifact_versions: { technical_evidence_report_id: string };
  provenance_ref: string;
  coverage_state: AgenticToolCoverageState;
  evidence_refs: string[];
  limitations: string[];
  result: {
    invocations: Array<{
      invocation_ref: string;
      provider: ProviderInvocationProvider;
      framework: string | null;
      relative_location: string | null;
      symbol_ref: null;
      evidence_refs: string[];
    }>;
    declared_signals: Array<{ kind: string; ref: string }>;
    truncated: boolean;
  };
};
