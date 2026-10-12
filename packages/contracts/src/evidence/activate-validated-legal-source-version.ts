import { LEGAL_SOURCE_LIFECYCLE_STATUSES } from "../legal-source/statuses.ts";
import type {
  AgenticToolCoverageState,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const ACTIVATE_VALIDATED_LEGAL_SOURCE_VERSION_TOOL = {
  name: "activate_validated_legal_source_version",
  version: "1.0.0",
  configHash: "sha256:activation-v1",
} as const;

export const ACTIVATE_VALIDATED_LEGAL_SOURCE_VERSION_LIMITATION_CODES = {
  legalSourceVersionNotFound: "LEGAL_SOURCE_VERSION_NOT_FOUND",
  legalSourceVersionNotDraft: "LEGAL_SOURCE_VERSION_NOT_DRAFT",
  integrityManifestInvalid: "INTEGRITY_MANIFEST_INVALID",
  retrievalValidationMissing: "RETRIEVAL_VALIDATION_MISSING",
  retrievalValidationMismatch: "RETRIEVAL_VALIDATION_MISMATCH",
  retrievalIndexNotValid: "RETRIEVAL_INDEX_NOT_VALID",
  activationReplayConflict: "ACTIVATION_REPLAY_CONFLICT",
} as const;

export type ActivateValidatedLegalSourceVersionLimitationCode =
  (typeof ACTIVATE_VALIDATED_LEGAL_SOURCE_VERSION_LIMITATION_CODES)[keyof typeof ACTIVATE_VALIDATED_LEGAL_SOURCE_VERSION_LIMITATION_CODES];

const STABLE_LEGAL_SOURCE_VERSION_REF = "^legal-source-version:[A-Za-z0-9:_-]{3,220}$";
const STABLE_INTEGRITY_REF = "^integrity-manifest:[A-Za-z0-9:_-]{3,220}$";
const STABLE_RETRIEVAL_REF = "^retrieval-validation:[A-Za-z0-9:_-]{3,220}$";

export const ACTIVATE_VALIDATED_LEGAL_SOURCE_VERSION_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    legalSourceVersionRef: { type: "string", pattern: STABLE_LEGAL_SOURCE_VERSION_REF },
    integrityManifestRef: { type: "string", pattern: STABLE_INTEGRITY_REF },
    retrievalValidationRef: { type: "string", pattern: STABLE_RETRIEVAL_REF },
    idempotencyKey: { type: "string", format: "uuid" },
    scopeDescription: { type: "string", minLength: 1, maxLength: 500 },
    comments: { type: ["string", "null"], maxLength: 2_000 },
  },
  required: [
    "legalSourceVersionRef",
    "integrityManifestRef",
    "retrievalValidationRef",
    "idempotencyKey",
  ],
} as const;

export type ActivateValidatedLegalSourceVersionRequest = {
  legalSourceVersionRef: string;
  integrityManifestRef: string;
  retrievalValidationRef: string;
  idempotencyKey: string;
  scopeDescription?: string;
  comments?: string | null;
};

export type ActivateValidatedLegalSourceVersionLimitation = {
  code: ActivateValidatedLegalSourceVersionLimitationCode | string;
  affectedScopeRef: string | null;
  reason: string;
  retryable: boolean;
};

export type ActivateValidatedLegalSourceVersionResponse = {
  status: AgenticToolStatus;
  toolName: typeof ACTIVATE_VALIDATED_LEGAL_SOURCE_VERSION_TOOL.name;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: {
    legalSourceVersionId: string;
  };
  provenanceRef: string;
  coverageState: AgenticToolCoverageState;
  evidenceRefs: string[];
  limitations: ActivateValidatedLegalSourceVersionLimitation[];
  result: {
    activeLegalSourceVersionRef: string;
    lifecycleStatus: typeof LEGAL_SOURCE_LIFECYCLE_STATUSES.active;
    activationRecordRef: string;
    outboxEventRef: string;
    systemActor: string;
    manualApprovalRequired: false;
  };
};
