import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const ACTIVATE_VALIDATED_CORPUS_VERSION_TOOL = {
  name: "activate_validated_corpus_version",
  version: "1.0.0",
  configHash: "sha256:activation-v1",
} as const;

export const ACTIVATE_VALIDATED_CORPUS_VERSION_LIMITATION_CODES = {
  corpusVersionNotFound: "CORPUS_VERSION_NOT_FOUND",
  corpusVersionNotDraft: "CORPUS_VERSION_NOT_DRAFT",
  integrityManifestInvalid: "INTEGRITY_MANIFEST_INVALID",
  retrievalValidationMissing: "RETRIEVAL_VALIDATION_MISSING",
  retrievalValidationMismatch: "RETRIEVAL_VALIDATION_MISMATCH",
  retrievalIndexNotValid: "RETRIEVAL_INDEX_NOT_VALID",
  activationReplayConflict: "ACTIVATION_REPLAY_CONFLICT",
} as const;

export type ActivateValidatedCorpusVersionLimitationCode =
  (typeof ACTIVATE_VALIDATED_CORPUS_VERSION_LIMITATION_CODES)[keyof typeof ACTIVATE_VALIDATED_CORPUS_VERSION_LIMITATION_CODES];

const STABLE_CORPUS_VERSION_REF = "^corpus-version:[A-Za-z0-9:_-]{3,220}$";
const STABLE_INTEGRITY_REF = "^integrity-manifest:[A-Za-z0-9:_-]{3,220}$";
const STABLE_RETRIEVAL_REF = "^retrieval-validation:[A-Za-z0-9:_-]{3,220}$";

export const ACTIVATE_VALIDATED_CORPUS_VERSION_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    corpusVersionRef: { type: "string", pattern: STABLE_CORPUS_VERSION_REF },
    integrityManifestRef: { type: "string", pattern: STABLE_INTEGRITY_REF },
    retrievalValidationRef: { type: "string", pattern: STABLE_RETRIEVAL_REF },
    idempotencyKey: { type: "string", format: "uuid" },
    scopeDescription: { type: "string", minLength: 1, maxLength: 500 },
    comments: { type: ["string", "null"], maxLength: 2_000 },
  },
  required: [
    "corpusVersionRef",
    "integrityManifestRef",
    "retrievalValidationRef",
    "idempotencyKey",
  ],
} as const;

export type ActivateValidatedCorpusVersionRequest = {
  corpusVersionRef: string;
  integrityManifestRef: string;
  retrievalValidationRef: string;
  idempotencyKey: string;
  scopeDescription?: string;
  comments?: string | null;
};

export type ActivateValidatedCorpusVersionLimitation = {
  code: ActivateValidatedCorpusVersionLimitationCode | string;
  affectedScopeRef: string | null;
  reason: string;
  retryable: boolean;
};

export type ActivateValidatedCorpusVersionResponse = {
  status: AgenticToolStatus;
  toolName: AgenticToolName;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: {
    corpusVersionId: string;
  };
  provenanceRef: string;
  coverageState: AgenticToolCoverageState;
  evidenceRefs: string[];
  limitations: ActivateValidatedCorpusVersionLimitation[];
  result: {
    activeCorpusVersionRef: string;
    lifecycleStatus: "APPROVED";
    activationRecordRef: string;
    outboxEventRef: string;
    systemActor: string;
    manualApprovalRequired: false;
  };
};
