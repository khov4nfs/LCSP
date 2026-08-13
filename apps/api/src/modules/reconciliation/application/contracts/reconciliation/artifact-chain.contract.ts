import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
  ArtifactChainIntegrity,
  ArtifactChainStage,
} from "@lcsp/contracts/evidence";

export type ArtifactChainLink = {
  stage: ArtifactChainStage;
  artifact_ref: string;
  version: string;
  status: string;
  provenance_ref: string;
};

export type ArtifactChainLimitation = {
  stage: ArtifactChainStage;
  reason: string;
};

export type ArtifactChainToolResponse = {
  status: AgenticToolStatus;
  tool_name: AgenticToolName;
  tool_version: string;
  config_hash: string;
  correlation_id: string;
  artifact_versions: { assessment_id: string };
  provenance_ref: string;
  coverage_state: AgenticToolCoverageState;
  evidence_refs: string[];
  limitations: ArtifactChainLimitation[];
  result: {
    anchor_artifact_ref: string | null;
    links: ArtifactChainLink[];
    missing_stages: ArtifactChainLimitation[];
    integrity: ArtifactChainIntegrity;
  };
};
