import type {
  AgenticToolCoverageState,
  AgenticToolName,
  AgenticToolStatus,
} from "./agentic-tool.ts";

export const ADMIN_SOURCE_CATALOG_IDS = {
  vbpl: "catalog_vbpl_vn",
  vanbanChinhPhu: "catalog_vanban_chinhphu_vn",
} as const;

export type AdminSourceCatalogId =
  (typeof ADMIN_SOURCE_CATALOG_IDS)[keyof typeof ADMIN_SOURCE_CATALOG_IDS];

export const ADMIN_SOURCE_DOCUMENT_TYPES = {
  law: "LAW",
  decree: "DECREE",
  circular: "CIRCULAR",
  decision: "DECISION",
  resolution: "RESOLUTION",
} as const;

export type AdminSourceDocumentType =
  (typeof ADMIN_SOURCE_DOCUMENT_TYPES)[keyof typeof ADMIN_SOURCE_DOCUMENT_TYPES];

export const ADMIN_SOURCE_HIERARCHIES = {
  primary: "PRIMARY",
  supplementary: "SUPPLEMENTARY",
} as const;

export type AdminSourceHierarchy =
  (typeof ADMIN_SOURCE_HIERARCHIES)[keyof typeof ADMIN_SOURCE_HIERARCHIES];

export const ADMIN_SOURCE_PATH_POLICIES = {
  officialDocument: "OFFICIAL_DOCUMENT",
} as const;

export type AdminSourcePathPolicy =
  (typeof ADMIN_SOURCE_PATH_POLICIES)[keyof typeof ADMIN_SOURCE_PATH_POLICIES];

export const ADMIN_SOURCE_CATALOG_LIMITATION_CODES = {
  catalogEntryUnavailable: "CATALOG_ENTRY_UNAVAILABLE",
  catalogLookupAmbiguous: "CATALOG_LOOKUP_AMBIGUOUS",
  catalogProjectionUnavailable: "CATALOG_PROJECTION_UNAVAILABLE",
} as const;

export type AdminSourceCatalogLimitationCode =
  (typeof ADMIN_SOURCE_CATALOG_LIMITATION_CODES)[keyof typeof ADMIN_SOURCE_CATALOG_LIMITATION_CODES];

export const GET_ADMIN_SOURCE_CATALOG_TOOL = {
  name: "get_admin_source_catalog",
  version: "1.0.0",
  configHash: "sha256:admin-source-catalog-v1",
} as const;

export const GET_ADMIN_SOURCE_CATALOG_INPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    catalogId: {
      type: "string",
      enum: Object.values(ADMIN_SOURCE_CATALOG_IDS),
    },
    documentIdentity: {
      type: "object",
      additionalProperties: false,
      properties: {
        documentType: { enum: Object.values(ADMIN_SOURCE_DOCUMENT_TYPES) },
        documentNumber: { type: "string", maxLength: 64 },
        issuingAuthority: { type: "string", maxLength: 160 },
        issueDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      },
      required: [
        "documentType",
        "documentNumber",
        "issuingAuthority",
        "issueDate",
      ],
    },
  },
  oneOf: [{ required: ["catalogId"] }, { required: ["documentIdentity"] }],
} as const;

export const GET_ADMIN_SOURCE_CATALOG_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "catalogSourceRef",
    "documentIdentity",
    "allowedHost",
    "pathPolicy",
    "sourceHierarchy",
    "catalogVersion",
  ],
  properties: {
    catalogSourceRef: { type: "string" },
    documentIdentity: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            documentType: { enum: Object.values(ADMIN_SOURCE_DOCUMENT_TYPES) },
            documentNumber: { type: "string" },
            issuingAuthority: { type: "string" },
            issueDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          },
          required: [
            "documentType",
            "documentNumber",
            "issuingAuthority",
            "issueDate",
          ],
        },
      ],
    },
    allowedHost: { type: "string" },
    pathPolicy: { enum: Object.values(ADMIN_SOURCE_PATH_POLICIES) },
    sourceHierarchy: { enum: Object.values(ADMIN_SOURCE_HIERARCHIES) },
    catalogVersion: { type: "string" },
  },
} as const;

export type GetAdminSourceCatalogInput = {
  catalogId?: AdminSourceCatalogId;
  documentIdentity?: {
    documentType: AdminSourceDocumentType;
    documentNumber: string;
    issuingAuthority: string;
    issueDate: string;
  };
};

export type AdminSourceCatalogLimitation = {
  code: AdminSourceCatalogLimitationCode;
  affectedScopeRef: string | null;
  reason: string;
  retryable: boolean;
};

export type GetAdminSourceCatalogResponse = {
  status: AgenticToolStatus;
  toolName: AgenticToolName;
  toolVersion: string;
  configHash: string;
  correlationId: string;
  artifactVersions: {
    adminCatalogVersion: string;
  };
  provenanceRef: string;
  coverageState: AgenticToolCoverageState;
  evidenceRefs: string[];
  limitations: AdminSourceCatalogLimitation[];
  result: {
    catalogSourceRef: string | null;
    documentIdentity: GetAdminSourceCatalogInput["documentIdentity"] | null;
    allowedHost: string | null;
    pathPolicy: AdminSourcePathPolicy | null;
    sourceHierarchy: AdminSourceHierarchy | null;
    catalogVersion: string;
  };
};
