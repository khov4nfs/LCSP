import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const FETCH_OFFICIAL_SOURCE_SNAPSHOT_TOOL = {
  name: "fetch_official_source_snapshot",
  version: "1.0.0",
  configHash: "sha256:fetch-v1",
  maxBytes: 25_000_000,
} as const;

const STABLE_CATALOG_SOURCE_REF = "^catalog-source:[a-z0-9:_-]{3,160}$";
const STABLE_SNAPSHOT_REF = "^snapshot:[A-Za-z0-9:_-]{8,180}$";
const STABLE_SHA = "^sha256:[a-fA-F0-9]{64}$";
const STABLE_SNAPSHOT_OBJECT_KEY =
  "^legal-source-snapshots\\/[A-Za-z0-9._-]{3,120}\\/[A-Za-z0-9._:-]{3,180}\\/[a-fA-F0-9]{64}\\/[A-Za-z0-9._-]{3,255}$";

export const FETCH_OFFICIAL_SOURCE_SNAPSHOT_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["catalogSourceRef", "expectedIdentity", "maxBytes"],
  properties: {
    catalogSourceRef: {
      type: "string",
      pattern: STABLE_CATALOG_SOURCE_REF,
    },
    expectedIdentity: {
      type: "object",
      additionalProperties: false,
      required: ["documentNumber", "issueDate"],
      properties: {
        documentNumber: { type: "string", maxLength: 64 },
        issueDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      },
    },
    maxBytes: {
      type: "integer",
      minimum: 1,
      maximum: FETCH_OFFICIAL_SOURCE_SNAPSHOT_TOOL.maxBytes,
    },
  },
} as const;

export const FETCH_OFFICIAL_SOURCE_SNAPSHOT_LIMITATION_CODES = {
  sourceUnavailable: "OFFICIAL_SOURCE_UNAVAILABLE",
  sourceRejected: "OFFICIAL_SOURCE_REJECTED",
  sizeLimitExceeded: "OFFICIAL_SOURCE_SIZE_LIMIT_EXCEEDED",
  identityMismatch: "OFFICIAL_SOURCE_IDENTITY_MISMATCH",
} as const;

export type FetchOfficialSourceSnapshotLimitationCode =
  (typeof FETCH_OFFICIAL_SOURCE_SNAPSHOT_LIMITATION_CODES)[keyof typeof FETCH_OFFICIAL_SOURCE_SNAPSHOT_LIMITATION_CODES];

export const FETCH_OFFICIAL_SOURCE_SNAPSHOT_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "snapshotRef",
    "snapshotObjectKey",
    "contentSha256",
    "contentType",
    "byteLength",
    "retrievedAt",
    "documentIdentityVerified",
  ],
  properties: {
    snapshotRef: {
      type: "string",
      pattern: STABLE_SNAPSHOT_REF,
    },
    snapshotObjectKey: {
      type: "string",
      pattern: STABLE_SNAPSHOT_OBJECT_KEY,
    },
    contentSha256: {
      type: "string",
      pattern: STABLE_SHA,
    },
    contentType: { type: "string", maxLength: 160 },
    byteLength: { type: "integer", minimum: 0 },
    retrievedAt: { type: "string", format: "date-time" },
    documentIdentityVerified: { type: "boolean" },
  },
} as const;

export type FetchOfficialSourceSnapshotInput = {
  catalogSourceRef: string;
  expectedIdentity: {
    documentNumber: string;
    issueDate: string;
  };
  maxBytes: number;
};

export type FetchOfficialSourceSnapshotResponse = {
  status: AgenticToolStatus;
  toolName: AgenticToolName;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: {
    adminCatalogVersion: string;
    snapshotId: string;
  };
  provenanceRef: string;
  coverageState: AgenticToolCoverageState;
  evidenceRefs: string[];
  limitations: Array<{
    code: FetchOfficialSourceSnapshotLimitationCode | string;
    affectedScopeRef: string | null;
    reason: string;
    retryable: boolean;
  }>;
  result: {
    snapshotRef: string;
    snapshotObjectKey: string;
    contentSha256: string;
    contentType: string;
    byteLength: number;
    retrievedAt: string;
    documentIdentityVerified: boolean;
  };
};
