import type { LegalRuleLifecycleStatus } from "./statuses.ts";

export const CORPUS_VERSION_READINESS_STATES = {
  ready: "READY",
  passed: "PASSED",
  pending: "PENDING",
  failed: "FAILED",
  blocked: "BLOCKED",
  unavailable: "UNAVAILABLE",
} as const;

export const CORPUS_PREPARATION_STATUSES = {
  requested: "REQUESTED",
  running: "RUNNING",
  completed: "COMPLETED",
  failed: "FAILED",
  blocked: "BLOCKED",
} as const;
export type CorpusPreparationStatus =
  (typeof CORPUS_PREPARATION_STATUSES)[keyof typeof CORPUS_PREPARATION_STATUSES];

export const CORPUS_PREPARATION_TERMINAL_STATUSES = {
  completed: CORPUS_PREPARATION_STATUSES.completed,
  failed: CORPUS_PREPARATION_STATUSES.failed,
  blocked: CORPUS_PREPARATION_STATUSES.blocked,
} as const;
export type CorpusPreparationTerminalStatus =
  (typeof CORPUS_PREPARATION_TERMINAL_STATUSES)[keyof typeof CORPUS_PREPARATION_TERMINAL_STATUSES];

export const CORPUS_VERSION_PRESENTATION_STATUSES = {
  draft: "DRAFT",
  published: "PUBLISHED",
  archived: "ARCHIVED",
  unavailable: "UNAVAILABLE",
} as const;
export type CorpusVersionPresentationStatus =
  (typeof CORPUS_VERSION_PRESENTATION_STATUSES)[keyof typeof CORPUS_VERSION_PRESENTATION_STATUSES];

export const CORPUS_VERSION_PUBLICATION_STATES = {
  notReady: "NOT_READY",
  ready: "READY",
  published: "PUBLISHED",
  blocked: "BLOCKED",
} as const;
export type CorpusVersionPublicationState =
  (typeof CORPUS_VERSION_PUBLICATION_STATES)[keyof typeof CORPUS_VERSION_PUBLICATION_STATES];

export type CorpusVersionReadinessState =
  (typeof CORPUS_VERSION_READINESS_STATES)[keyof typeof CORPUS_VERSION_READINESS_STATES];

export const CORPUS_VERSION_READINESS_CHECKS = {
  sourceParsing: "SOURCE_PARSING",
  retrievalValidation: "RETRIEVAL_VALIDATION",
  integrityManifest: "INTEGRITY_MANIFEST",
  ruleSnapshot: "RULE_SNAPSHOT",
  diffReview: "DIFF_REVIEW",
} as const;

export type CorpusVersionReadinessCheck =
  (typeof CORPUS_VERSION_READINESS_CHECKS)[keyof typeof CORPUS_VERSION_READINESS_CHECKS];

export const CORPUS_VERSION_SNAPSHOT_CATEGORIES = {
  sourceDocuments: "SOURCE_DOCUMENTS",
  corpusChunks: "CORPUS_CHUNKS",
  legalRules: "LEGAL_RULES",
  engineeringRules: "ENGINEERING_RULES",
} as const;

export type CorpusVersionSnapshotCategory =
  (typeof CORPUS_VERSION_SNAPSHOT_CATEGORIES)[keyof typeof CORPUS_VERSION_SNAPSHOT_CATEGORIES];

export type AdminCorpusVersionSummary = {
  id: string;
  version: string;
  status: LegalRuleLifecycleStatus;
  presentationStatus: CorpusVersionPresentationStatus;
  isCurrentActive: boolean;
  sourceCount: number;
  legalRuleCount: number | null;
  engineeringRuleCount: number | null;
  createdAt: string;
  publishedAt: string | null;
};

export type AdminCorpusVersionReadinessItem = {
  check: CorpusVersionReadinessCheck;
  state: CorpusVersionReadinessState;
};

export type AdminCorpusVersionSnapshotChange = {
  added: number;
  removed: number;
  updated: number;
};

export type AdminCorpusVersionDetail = AdminCorpusVersionSummary & {
  baseVersion: string | null;
  createdBy: string | null;
  sourcesAdded: number | null;
  sourcesRemoved: number | null;
  sourcesUpdated: number | null;
  legalRulesChanged: number | null;
  engineeringRulesChanged: number | null;
  unresolvedConflicts: number | null;
  readiness: CorpusVersionReadinessState;
  publicationState: CorpusVersionPublicationState;
  readinessItems: AdminCorpusVersionReadinessItem[];
  snapshot: Array<{
    category: CorpusVersionSnapshotCategory;
    count: number | null;
    change: AdminCorpusVersionSnapshotChange | null;
    validation: CorpusVersionReadinessState;
  }>;
  actions: {
    canPublish: boolean;
    canDiscard: boolean;
  };
};

export type AdminCorpusVersionsListResponse = {
  currentActive: AdminCorpusVersionSummary | null;
  items: AdminCorpusVersionSummary[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    hasNext: boolean;
  };
  canCreate: boolean;
  createUnavailableReason?:
    "CORPUS_PREPARATION_IN_PROGRESS" | "PREPARATION_WORKFLOW_UNAVAILABLE";
};

export type AdminPublishCorpusVersionInput = {
  idempotencyKey: string;
};

export type AdminDiscardCorpusVersionInput = {
  idempotencyKey: string;
};
