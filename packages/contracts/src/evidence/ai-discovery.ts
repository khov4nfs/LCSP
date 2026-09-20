export const AI_DISCOVERY_EVIDENCE_STATES = {
  confirmedAiCall: "CONFIRMED_AI_CALL",
  possibleAiCall: "POSSIBLE_AI_CALL",
  aiProviderReference: "AI_PROVIDER_REFERENCE",
  noAiSignal: "NO_AI_SIGNAL",
  unresolvedDynamic: "UNRESOLVED_DYNAMIC",
} as const;

export type AiDiscoveryEvidenceState =
  (typeof AI_DISCOVERY_EVIDENCE_STATES)[keyof typeof AI_DISCOVERY_EVIDENCE_STATES];

export const AI_DISCOVERY_GATES = {
  confirmed: "AI_CONFIRMED",
  absentConfirmed: "AI_ABSENT_CONFIRMED",
  unknown: "AI_UNKNOWN",
} as const;

export type AiDiscoveryGate =
  (typeof AI_DISCOVERY_GATES)[keyof typeof AI_DISCOVERY_GATES];

export const AI_DISCOVERY_CLARIFICATION_KINDS = {
  purposeFeatureMapping: "AI_PURPOSE_FEATURE_MAPPING",
  runtimeReachability: "AI_RUNTIME_REACHABILITY",
  outboundAiConfirmation: "OUTBOUND_AI_CONFIRMATION",
  targetedTechnicalReanalysis: "TARGETED_TECHNICAL_REANALYSIS",
} as const;

export type AiDiscoveryClarificationKind =
  (typeof AI_DISCOVERY_CLARIFICATION_KINDS)[keyof typeof AI_DISCOVERY_CLARIFICATION_KINDS];

export type AiDiscoveryClarificationOwner = "CUSTOMER" | "TECHNICAL";
export type AiDiscoveryResolutionState =
  | "OBSERVED"
  | "CORROBORATED"
  | "INFERRED"
  | "UNRESOLVED";

/**
 * Reference used by the UI to request source later from the exact pinned snapshot.
 * Raw source is intentionally not part of Scanner/PGE persistence.
 */
export type AiDiscoverySnippetRef = {
  snapshot_id: string;
  commit_sha: string;
  file_path: string;
  symbol?: string;
  start_line: number;
  end_line: number;
  evidence_hash: string;
  snippet_policy: "PINNED_SNAPSHOT_BOUNDED_REDACTED_V1";
};

export type AiDiscoveryFinding = {
  evidence_id: string;
  state: AiDiscoveryEvidenceState;
  resolution_state: AiDiscoveryResolutionState;
  kind:
    | "SDK_INVOCATION"
    | "OUTBOUND_API"
    | "PROVIDER_REFERENCE"
    | "DYNAMIC_TARGET";
  provider?: string;
  host?: string;
  path?: string;
  method?: string;
  endpoint_source?: string;
  payload_hints?: string[];
  runtime_guard?: string;
  clarification_owner?: AiDiscoveryClarificationOwner;
  clarification_kind?: AiDiscoveryClarificationKind;
  evidence_refs: string[];
  snippet_ref?: AiDiscoverySnippetRef;
};

export type AiDiscoverySummary = {
  schema_version: "1.0.0";
  gate: AiDiscoveryGate;
  coverage_state: "READY" | "PARTIAL" | "UNAVAILABLE";
  findings: AiDiscoveryFinding[];
  material_unresolved_frontiers: string[];
};
