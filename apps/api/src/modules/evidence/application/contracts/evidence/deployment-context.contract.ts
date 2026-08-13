import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "@lcsp/contracts/evidence";
export const DEPLOYMENT_MANIFEST_KINDS = {
  container: "CONTAINER",
  kubernetes: "KUBERNETES",
  cicd: "CI_CD",
  infrastructure: "INFRASTRUCTURE",
  runtimeMetadata: "RUNTIME_METADATA",
} as const;
export type DeploymentManifestKind =
  (typeof DEPLOYMENT_MANIFEST_KINDS)[keyof typeof DEPLOYMENT_MANIFEST_KINDS];
export const DEPLOYMENT_ENVIRONMENTS = {
  development: "DEVELOPMENT",
  test: "TEST",
  staging: "STAGING",
  production: "PRODUCTION",
  unknown: "UNKNOWN",
} as const;
export type DeploymentEnvironment =
  (typeof DEPLOYMENT_ENVIRONMENTS)[keyof typeof DEPLOYMENT_ENVIRONMENTS];
export type DeploymentContextResponse = {
  status: AgenticToolStatus;
  tool_name: AgenticToolName;
  tool_version: string;
  config_hash: string;
  correlationId: string;
  artifact_versions: { technical_evidence_report_id: string };
  provenance_ref: string;
  coverage_state: AgenticToolCoverageState;
  evidence_refs: string[];
  limitations: string[];
  result: {
    contexts: Array<{
      context_ref: string;
      manifest_kind: DeploymentManifestKind;
      environment: DeploymentEnvironment;
      relative_location: string;
      categories: string[];
      evidence_refs: string[];
    }>;
    next_cursor: string | null;
    truncated: boolean;
  };
};
