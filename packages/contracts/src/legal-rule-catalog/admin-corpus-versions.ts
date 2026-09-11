import type { LegalRuleLifecycleStatus } from "./statuses.ts";

export const CORPUS_VERSION_READINESS_STATES = {
  ready: "READY",
  pending: "PENDING",
  failed: "FAILED",
  unavailable: "UNAVAILABLE",
} as const;

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
  sourceCount: number;
  ruleCount: number | null;
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
  currentPublished: AdminCorpusVersionSummary | null;
  versions: AdminCorpusVersionSummary[];
  canCreate: false;
};

export type AdminPublishCorpusVersionInput = {
  idempotencyKey: string;
};
