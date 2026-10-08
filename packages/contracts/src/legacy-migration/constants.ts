import { ASSESSMENT_STATUS_CODES } from "../assessment/statuses.ts";

/**
 * W6 forward-migration contract. Every closed set here is a constant source; derived types follow.
 * Values are SCREAMING_SNAKE_CASE and are mirrored by Prisma enums where they are persisted.
 */

export const LEGACY_MIGRATION_TOOL_VERSION = "w6.2" as const;

/** Correlation-id prefixes that make the origin of a Root command provable from its outbox payload. */
export const LEGACY_CORRELATION_PREFIXES = {
  MIGRATION: "legacy-migration-",
  REEVALUATION: "legacy-reevaluation-",
} as const;

export const LEGACY_MIGRATION_RUN_KINDS = {
  REHEARSAL: "REHEARSAL",
  CUTOVER: "CUTOVER",
  /** An explicit, bounded start of AI re-evaluation. Never part of a cutover run. */
  REEVALUATION: "REEVALUATION",
} as const;
export type LegacyMigrationRunKind =
  (typeof LEGACY_MIGRATION_RUN_KINDS)[keyof typeof LEGACY_MIGRATION_RUN_KINDS];

export const LEGACY_MIGRATION_RUN_STATUSES = {
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;
export type LegacyMigrationRunStatus =
  (typeof LEGACY_MIGRATION_RUN_STATUSES)[keyof typeof LEGACY_MIGRATION_RUN_STATUSES];

export const LEGACY_MIGRATION_PHASES = {
  PREFLIGHT: "PREFLIGHT",
  QUIESCE: "QUIESCE",
  ARCHIVE: "ARCHIVE",
  BACKFILL: "BACKFILL",
  VALIDATE: "VALIDATE",
} as const;
export type LegacyMigrationPhase =
  (typeof LEGACY_MIGRATION_PHASES)[keyof typeof LEGACY_MIGRATION_PHASES];

/** How one V1 assessment was handled. Terminal V1 assessments never receive V2 lifecycle state. */
export const LEGACY_ASSESSMENT_DISPOSITIONS = {
  ARCHIVED_TERMINAL: "ARCHIVED_TERMINAL",
  BACKFILLED_NON_TERMINAL: "BACKFILLED_NON_TERMINAL",
} as const;
export type LegacyAssessmentDisposition =
  (typeof LEGACY_ASSESSMENT_DISPOSITIONS)[keyof typeof LEGACY_ASSESSMENT_DISPOSITIONS];

/**
 * V1 statuses at which the old pipeline had finished. They are archived read-only and are never
 * translated into a V2 lifecycle or completion. Every other V1 status is non-terminal.
 */
export const LEGACY_TERMINAL_ASSESSMENT_STATUSES = {
  READY_FOR_REVIEW: ASSESSMENT_STATUS_CODES.readyForReview,
  AI_NOT_DETECTED: ASSESSMENT_STATUS_CODES.aiNotDetected,
} as const;

/**
 * V1 tables copied (set-based, byte-exact `to_jsonb`) into `LegacyArchiveRecord`.
 * RepositoryConnection/RepositorySnapshot/billing/audit stay live and are NOT archived.
 */
export const LEGACY_ARCHIVE_SOURCES = {
  ASSESSMENT: "ASSESSMENT",
  ASSESSMENT_INTERVIEW_THREAD: "ASSESSMENT_INTERVIEW_THREAD",
  ENGINEERING_RULE_ASSESSMENT: "ENGINEERING_RULE_ASSESSMENT",
  ASSESSMENT_RUNTIME_TURN: "ASSESSMENT_RUNTIME_TURN",
  ASSESSMENT_RUNTIME_EVENT: "ASSESSMENT_RUNTIME_EVENT",
  PIPELINE_RECONCILIATION: "PIPELINE_RECONCILIATION",
  REPOSITORY_SCAN_JOB: "REPOSITORY_SCAN_JOB",
  TECHNICAL_EVIDENCE_REPORT: "TECHNICAL_EVIDENCE_REPORT",
  TECHNICAL_PROFILE: "TECHNICAL_PROFILE",
  AI_USAGE_FLOW: "AI_USAGE_FLOW",
  CONFLICT_RECORD: "CONFLICT_RECORD",
  TARGETED_REANALYSIS_REQUEST: "TARGETED_REANALYSIS_REQUEST",
  TARGETED_REANALYSIS_CHECKPOINT: "TARGETED_REANALYSIS_CHECKPOINT",
  VERIFIED_AGENT_EPISODE: "VERIFIED_AGENT_EPISODE",
  VERIFIED_PROFILE: "VERIFIED_PROFILE",
  CLASSIFICATION_RESULT: "CLASSIFICATION_RESULT",
  CLASSIFICATION_REVIEW_REQUEST: "CLASSIFICATION_REVIEW_REQUEST",
  LEGAL_RULE_MATCH: "LEGAL_RULE_MATCH",
  DOCUMENT_REQUEST: "DOCUMENT_REQUEST",
  READINESS_EXPORT: "READINESS_EXPORT",
  DECISION_MODEL_DECISION: "DECISION_MODEL_DECISION",
  DECISION_MODEL_EVENT: "DECISION_MODEL_EVENT",
  LEGAL_RULE_CATALOG_VERSION: "LEGAL_RULE_CATALOG_VERSION",
  LEGAL_RULE: "LEGAL_RULE",
  RULE_APPROVAL_RECORD: "RULE_APPROVAL_RECORD",
  CORPUS_APPROVAL_RECORD: "CORPUS_APPROVAL_RECORD",
  CORPUS_DISCARD_RECEIPT: "CORPUS_DISCARD_RECEIPT",
  CORPUS_PREPARATION: "CORPUS_PREPARATION",
  OUTBOX_MESSAGE_CANCELLED: "OUTBOX_MESSAGE_CANCELLED",
  FILESYSTEM_ARTIFACT: "FILESYSTEM_ARTIFACT",
} as const;
export type LegacyArchiveSource =
  (typeof LEGACY_ARCHIVE_SOURCES)[keyof typeof LEGACY_ARCHIVE_SOURCES];

/**
 * Reconciliation of every V1 report-related record. The V1 uploader was a placeholder, so absence of
 * bytes is a normal, explicitly accounted outcome; presence is only claimed for bytes that were read.
 */
export const LEGACY_ARTIFACT_RECONCILIATION_CLASSES = {
  ARTIFACT_PRESENT_AND_COPIED: "ARTIFACT_PRESENT_AND_COPIED",
  ARTIFACT_PRESENT_BUT_COPY_FAILED: "ARTIFACT_PRESENT_BUT_COPY_FAILED",
  NO_LEGACY_ARTIFACT_PRESENT: "NO_LEGACY_ARTIFACT_PRESENT",
  METADATA_ONLY_LEGACY_RECORD: "METADATA_ONLY_LEGACY_RECORD",
  INVALID_OR_ORPHANED_LEGACY_REFERENCE: "INVALID_OR_ORPHANED_LEGACY_REFERENCE",
} as const;
export type LegacyArtifactReconciliationClass =
  (typeof LEGACY_ARTIFACT_RECONCILIATION_CLASSES)[keyof typeof LEGACY_ARTIFACT_RECONCILIATION_CLASSES];

export const LEGACY_ARTIFACT_RECONCILIATION_REASONS = {
  /** Bytes were read from the source and re-read from the archive; sha256 and size are identical. */
  COPIED_AND_VERIFIED: "COPIED_AND_VERIFIED",
  /** Inline persisted content (ReadinessExport.contentJson) archived verbatim from the database row. */
  INLINE_CONTENT_ARCHIVED: "INLINE_CONTENT_ARCHIVED",
  /** The V1 uploader never persisted bytes; the reference host is a known non-persisting placeholder. */
  PLACEHOLDER_UPLOADER_NEVER_PERSISTED: "PLACEHOLDER_UPLOADER_NEVER_PERSISTED",
  /** An operator attested that the reference host never held retained bytes. */
  OPERATOR_ATTESTED_NON_PERSISTING: "OPERATOR_ATTESTED_NON_PERSISTING",
  /** The request has no artifact reference at all (queued, generating, failed or blocked). */
  NO_ARTIFACT_REFERENCE: "NO_ARTIFACT_REFERENCE",
  /** The request is READY but carries no reference. */
  READY_WITHOUT_REFERENCE: "READY_WITHOUT_REFERENCE",
  /** The inline content column is empty (for example a blocked readiness export). */
  NO_INLINE_CONTENT: "NO_INLINE_CONTENT",
  MALFORMED_REFERENCE: "MALFORMED_REFERENCE",
  UNSUPPORTED_REFERENCE_SCHEME: "UNSUPPORTED_REFERENCE_SCHEME",
  REFERENCE_OUTSIDE_ALLOWED_ROOT: "REFERENCE_OUTSIDE_ALLOWED_ROOT",
  REFERENCE_TARGET_MISSING: "REFERENCE_TARGET_MISSING",
  /** A real-looking location nobody configured the archive to read; operator must configure or attest. */
  LOCATION_NOT_CONFIGURED: "LOCATION_NOT_CONFIGURED",
  COPY_IO_ERROR: "COPY_IO_ERROR",
  COPY_SIZE_LIMIT_EXCEEDED: "COPY_SIZE_LIMIT_EXCEEDED",
  COPY_VERIFICATION_MISMATCH: "COPY_VERIFICATION_MISMATCH",
} as const;
export type LegacyArtifactReconciliationReason =
  (typeof LEGACY_ARTIFACT_RECONCILIATION_REASONS)[keyof typeof LEGACY_ARTIFACT_RECONCILIATION_REASONS];

/** Hosts whose V1 reference proves nothing was persisted (see LEGACY_REPORT_UPLOADER_EVIDENCE). */
export const LEGACY_PLACEHOLDER_STORAGE_HOSTS = ["mock-storage.local"] as const;

/**
 * Source-inspection evidence for the placeholder uploader. The hash is of the file at the V1 baseline
 * and at the W6 branch point; a test recomputes it from git so the claim cannot silently drift.
 */
export const LEGACY_REPORT_UPLOADER_EVIDENCE = {
  sourcePath:
    "deepagents/tools/common/capabilities/reporting/report/delivery/storage_uploader.py",
  baselineCommit: "87ae8c4eb358c17318e71a53c3125d75975b9d98",
  sha256: "e3789784a7101ab16f1b552a27ff70420a2c38e41a6661e382076f8362eaf842",
  behavior: "PLACEHOLDER_RETURNS_MOCK_URL_WITHOUT_PERSISTING",
  callers: [
    "deepagents/tools/common/capabilities/reporting/gap/gap_analysis_boundary.py",
    "deepagents/tools/common/capabilities/reporting/report/final_report/final_report_boundary.py",
  ],
} as const;

/**
 * V1 outbox event types whose consumers/handlers are retired. Undelivered rows of these types are
 * cancelled at quiescence. Retained events (V2 worker boundaries, billing, acquisition, canonical
 * assessment events) are NEVER in this set; unknown types are reported, not guessed.
 */
export const LEGACY_OUTBOX_EVENT_TYPES = {
  SCAN_REQUESTED: "command.scan.requested.v1",
  SCAN_TARGETED_REANALYSIS: "command.scan.targeted-reanalysis.v1",
  INTERVIEW_PAUSE_AGENT: "command.assessment-interview.pause-agent.v1",
  INTERVIEW_RESUME_AGENT: "command.assessment-interview.resume-agent.v1",
  LEGAL_MATCHING_REQUESTED: "command.legal-matching.requested.v1",
  TECHNICAL_EVIDENCE_ACCEPTED: "event.technical-evidence.accepted.v1",
  TECHNICAL_PROFILE_READY: "event.technical-profile.ready.v1",
  AI_USAGE_FLOW_READY: "event.ai-usage-flow.ready.v1",
  CLASSIFICATION_RESULT_READY: "event.classification-result.ready.v1",
  RECONCILIATION_ALL_CONFLICTS_RESOLVED:
    "event.reconciliation.all-conflicts-resolved.v1",
  DOCUMENT_FINAL_REPORT_REQUESTED: "document.final-report-requested",
  DOCUMENT_GAP_ANALYSIS_REQUESTED: "document.gap-analysis-requested",
} as const;
export type LegacyOutboxEventType =
  (typeof LEGACY_OUTBOX_EVENT_TYPES)[keyof typeof LEGACY_OUTBOX_EVENT_TYPES];

/** Events the V2 worker binds queues for (invocation boundary manifest after W6). */
const RETIRED_OUTBOX_EVENT_TYPE_SET: ReadonlySet<string> = new Set(
  Object.values(LEGACY_OUTBOX_EVENT_TYPES),
);

/** True for a V1 command/event type that no producer or consumer may use after the W6 cutover. */
export const isRetiredOutboxEventType = (eventType: string): boolean =>
  RETIRED_OUTBOX_EVENT_TYPE_SET.has(eventType);

export const V2_WORKER_BOUND_EVENT_TYPES = {
  LEGAL_CHANGE_DETECTION: "cron.legal-catalog.check-updates.v1",
  ASSESSMENT_ROOT_REQUESTED: "command.assessment.root.requested.v1",
  LEGAL_PORTFOLIO_PREPARATION_REQUESTED:
    "command.legal-portfolio.preparation.requested.v1",
  LEGAL_CORPUS_RECOVERY_REQUESTED: "command.legal-corpus.recovery.requested.v1",
  LEGAL_SOURCE_INGEST: "command.legal-source.ingest.v1",
  OFFICIAL_TEXT_EXTRACT: "command.official-text.extract.v1",
  OCR_FALLBACK_RUN: "command.ocr-fallback.run.v1",
  OCR_QUALITY_EVALUATE: "command.ocr-quality.evaluate.v1",
  REVIEWED_CORPUS_INPUT_BUILD: "command.reviewed-corpus-input.build.v1",
  LEGAL_CHUNKS_BUILD: "command.legal-chunks.build.v1",
  VBPL_EFFECTED_CHUNK_SET_BUILD: "command.vbpl-effected-chunk-set.build.v1",
  CHUNK_INTEGRITY_VALIDATE: "command.chunk-integrity.validate.v1",
  LEGAL_RETRIEVAL_INDEX_BUILD: "command.legal-retrieval-index.build.v1",
  AUDIT_EXPORT_REQUESTED: "audit.export-requested",
  AGENT_RUNTIME_HEALTH: "internal.agent-runtime.health.v1",
} as const;

/**
 * Outbox events that stay deliverable after cutover but are not worker boundaries: the canonical
 * assessment envelope, billing reconciliation and legal acquisition/activation notifications.
 */
export const RETAINED_OUTBOX_EVENT_TYPES = {
  ASSESSMENT_CREATED: "event.assessment.created.v1",
  ASSESSMENT_EVENT_RECORDED: "event.assessment.event-recorded.v1",
  ASSESSMENT_LIFECYCLE_CHANGED: "event.assessment.lifecycle-changed.v1",
  LEGAL_CORPUS_ACTIVATED: "event.legal-corpus.activated.v1",
  REPOSITORY_SNAPSHOT_CREATED: "event.repository-snapshot.created.v1",
  BILLING_SEPAY_RECONCILE: "command.billing.sepay-reconcile.v1",
} as const;

/** What quiescence does with one undelivered outbox message. Unknown types are reported, never guessed. */
export const LEGACY_OUTBOX_DISPOSITIONS = {
  CANCEL: "CANCEL",
  RETAIN: "RETAIN",
  UNCLASSIFIED: "UNCLASSIFIED",
} as const;
export type LegacyOutboxDisposition =
  (typeof LEGACY_OUTBOX_DISPOSITIONS)[keyof typeof LEGACY_OUTBOX_DISPOSITIONS];

/** Why a non-terminal V1 assessment ended the backfill with (or without) a pinned snapshot. */
export const LEGACY_BACKFILL_REASONS = {
  PINNED_LATEST_READY_SNAPSHOT: "PINNED_LATEST_READY_SNAPSHOT",
  NO_SNAPSHOT: "NO_SNAPSHOT",
  NO_USABLE_SNAPSHOT: "NO_USABLE_SNAPSHOT",
} as const;
export type LegacyBackfillReason =
  (typeof LEGACY_BACKFILL_REASONS)[keyof typeof LEGACY_BACKFILL_REASONS];

/** Markers written into V1 rows closed at quiescence (the original is archived first). */
export const LEGACY_CLOSURE_MARKERS = {
  CUTOVER_CANCELLED: "LEGACY_CUTOVER_CANCELLED",
  OUTBOX_CANCELLED: "LEGACY_V1_COMMAND_CANCELLED_AT_QUIESCENCE",
} as const;

/** Stable audit identity for every write performed by the migration tooling. */
export const LEGACY_MIGRATION_ACTOR_ID = "legacy-migration" as const;

export const LEGACY_MIGRATION_AUDIT_EVENT_TYPES = {
  OUTBOX_LEGACY_CANCELLED: "OUTBOX_LEGACY_CANCELLED",
  LEGACY_ASSESSMENT_ARCHIVED: "LEGACY_ASSESSMENT_ARCHIVED",
  LEGACY_ASSESSMENT_BACKFILLED: "LEGACY_ASSESSMENT_BACKFILLED",
  LEGACY_MIGRATION_RUN_COMPLETED: "LEGACY_MIGRATION_RUN_COMPLETED",
  LEGACY_ARCHIVE_REPORT_DOWNLOADED: "LEGACY_ARCHIVE_REPORT_DOWNLOADED",
  LEGACY_REEVALUATION_STARTED: "LEGACY_REEVALUATION_STARTED",
  LEGACY_REEVALUATION_START_FAILED: "LEGACY_REEVALUATION_START_FAILED",
} as const;

export const LEGACY_MIGRATION_ERROR_CODES = {
  NO_ACTIVE_LEGAL_PORTFOLIO: "LEGACY_MIGRATION_NO_ACTIVE_LEGAL_PORTFOLIO",
  PREFLIGHT_BLOCKED: "LEGACY_MIGRATION_PREFLIGHT_BLOCKED",
  RUN_NOT_FOUND: "LEGACY_MIGRATION_RUN_NOT_FOUND",
  ARCHIVE_NOT_FOUND: "LEGACY_ARCHIVE_NOT_FOUND",
  ARCHIVE_ARTIFACT_NOT_AVAILABLE: "LEGACY_ARCHIVE_ARTIFACT_NOT_AVAILABLE",
  ARCHIVE_ARTIFACT_INTEGRITY_FAILED: "LEGACY_ARCHIVE_ARTIFACT_INTEGRITY_FAILED",
  REQUEST_INVALID: "LEGACY_MIGRATION_REQUEST_INVALID",
  ARCHIVE_INCOMPLETE: "LEGACY_MIGRATION_ARCHIVE_INCOMPLETE",
  VALIDATION_FAILED: "LEGACY_MIGRATION_VALIDATION_FAILED",
  REEVALUATION_CUTOVER_NOT_VALIDATED: "LEGACY_REEVALUATION_CUTOVER_NOT_VALIDATED",
  REEVALUATION_NOT_AUTHORIZED: "LEGACY_REEVALUATION_NOT_AUTHORIZED",
  REEVALUATION_SELECTION_INVALID: "LEGACY_REEVALUATION_SELECTION_INVALID",
  REEVALUATION_CANARY_REQUIRED: "LEGACY_REEVALUATION_CANARY_REQUIRED",
  REEVALUATION_BULK_NOT_CONFIRMED: "LEGACY_REEVALUATION_BULK_NOT_CONFIRMED",
  REEVALUATION_RESTORE_BOUNDARY_OPEN: "LEGACY_REEVALUATION_RESTORE_BOUNDARY_OPEN",
  REEVALUATION_MODEL_ROUTE_REQUIRED: "LEGACY_REEVALUATION_MODEL_ROUTE_REQUIRED",
} as const;

/** Result vocabulary of one validation check. */
export const LEGACY_VALIDATION_STATUSES = {
  PASS: "PASS",
  FAIL: "FAIL",
  WARN: "WARN",
} as const;
export type LegacyValidationStatus =
  (typeof LEGACY_VALIDATION_STATUSES)[keyof typeof LEGACY_VALIDATION_STATUSES];

/** Customer-visible availability of one archived report-related record. */
export const LEGACY_ARTIFACT_AVAILABILITIES = {
  DOWNLOADABLE: "DOWNLOADABLE",
  NOT_RETAINED: "NOT_RETAINED",
  METADATA_ONLY: "METADATA_ONLY",
  UNAVAILABLE: "UNAVAILABLE",
} as const;
export type LegacyArtifactAvailability =
  (typeof LEGACY_ARTIFACT_AVAILABILITIES)[keyof typeof LEGACY_ARTIFACT_AVAILABILITIES];

/** Carried verbatim into the W6 reconciliation report and the W7 release evidence. */
export const LEGACY_REPORT_LIMITATION =
  "The V1 report uploader was a placeholder that returned a mock URL without persisting bytes. " +
  "Historical V1 reports are therefore archived as metadata and classified; no historical artifact " +
  "was regenerated, fabricated, or given a synthetic hash or storage reference.";

// ---------------------------------------------------------------------------------------------
// Re-evaluation: the SEPARATE, explicit phase that starts the Assessment Root for migrated
// assessments. Migration never starts one; the scheduler only coordinates starts (the Root
// remains the semantic authority) and derives everything else from canonical state.
// ---------------------------------------------------------------------------------------------

export const LEGACY_REEVALUATION_MODES = {
  CANARY: "CANARY",
  BATCH: "BATCH",
} as const;
export type LegacyReevaluationMode =
  (typeof LEGACY_REEVALUATION_MODES)[keyof typeof LEGACY_REEVALUATION_MODES];

/** Conservative defaults. A batch must still be given an explicit `--max-total`. */
export const LEGACY_REEVALUATION_DEFAULTS = {
  GLOBAL_CONCURRENCY: 2,
  TENANT_CONCURRENCY: 1,
  /** Undelivered Root commands tolerated before the scheduler stops starting more (backpressure). */
  MAX_BACKLOG: 2,
  MIN_START_INTERVAL_MS: 5_000,
  /** Failed re-evaluations tolerated in one batch before the scheduler halts (no mass retries). */
  MAX_FAILURES: 3,
  /** A canary is a handful of explicitly chosen assessments, never a fraction of the population. */
  MAX_CANARY_SIZE: 5,
  WATCH_INTERVAL_SECONDS: 30,
} as const;

/** What an assessment of the migrated cohort looks like, derived only from canonical state. */
export const LEGACY_REEVALUATION_STATES = {
  /** Migrated, but no usable repository snapshot is pinned (the customer must finish setup). */
  NOT_READY: "NOT_READY",
  /** Prepared and pinned; nobody has started it. The default end state of the migration. */
  READY_NOT_STARTED: "READY_NOT_STARTED",
  /** Started: ACTIVE and the Root has not claimed its lease yet. */
  STARTED_QUEUED: "STARTED_QUEUED",
  RUNNING: "RUNNING",
  /**
   * The Root's last execution FAILED while the lifecycle is still ACTIVE (canonical failure policy).
   * The scheduler never restarts it; a retry is a separate, explicit decision.
   */
  RETRYABLE_FAILURE: "RETRYABLE_FAILURE",
  WAITING: "WAITING",
  PAUSED: "PAUSED",
  COMPLETE: "COMPLETE",
  FAILED: "FAILED",
  BLOCKED: "BLOCKED",
  CANCELLED: "CANCELLED",
} as const;
export type LegacyReevaluationState =
  (typeof LEGACY_REEVALUATION_STATES)[keyof typeof LEGACY_REEVALUATION_STATES];

/** Why a migrated assessment is excluded from a start. */
export const LEGACY_REEVALUATION_EXCLUSIONS = {
  /** The id is not an assessment the migration backfilled. */
  NOT_MIGRATED: "NOT_MIGRATED",
  NO_PINNED_SNAPSHOT: "NO_PINNED_SNAPSHOT",
  CONNECTION_NOT_ACTIVE: "CONNECTION_NOT_ACTIVE",
  COVERAGE_INCOMPLETE: "COVERAGE_INCOMPLETE",
  /** Lifecycle moved on its own (for example the customer started it). */
  NOT_PREPARING: "NOT_PREPARING",
  ALREADY_STARTED: "ALREADY_STARTED",
} as const;
export type LegacyReevaluationExclusion =
  (typeof LEGACY_REEVALUATION_EXCLUSIONS)[keyof typeof LEGACY_REEVALUATION_EXCLUSIONS];

/** Why a scheduling pass stopped starting assessments. */
export const LEGACY_REEVALUATION_STOP_REASONS = {
  NO_ELIGIBLE_ASSESSMENT: "NO_ELIGIBLE_ASSESSMENT",
  MAX_TOTAL_REACHED: "MAX_TOTAL_REACHED",
  GLOBAL_CAP_REACHED: "GLOBAL_CAP_REACHED",
  TENANT_CAP_REACHED: "TENANT_CAP_REACHED",
  BACKPRESSURE: "BACKPRESSURE",
  FAILURE_BUDGET_EXCEEDED: "FAILURE_BUDGET_EXCEEDED",
} as const;
export type LegacyReevaluationStopReason =
  (typeof LEGACY_REEVALUATION_STOP_REASONS)[keyof typeof LEGACY_REEVALUATION_STOP_REASONS];

/** What a canary must demonstrate on real canonical state before any bulk start. */
export const LEGACY_REEVALUATION_CANARY_CHECKS = {
  THREAD_UNIQUE: "THREAD_UNIQUE",
  CHECKPOINT_RECORDED: "CHECKPOINT_RECORDED",
  EVENTS_RECORDED: "EVENTS_RECORDED",
  MODEL_USAGE_RECORDED: "MODEL_USAGE_RECORDED",
  ACCOUNTING_CONSISTENT: "ACCOUNTING_CONSISTENT",
  DECISIONS_RECORDED: "DECISIONS_RECORDED",
  ARTIFACT_FLOW: "ARTIFACT_FLOW",
  NO_V1_AUTHORITY: "NO_V1_AUTHORITY",
} as const;
export type LegacyReevaluationCanaryCheck =
  (typeof LEGACY_REEVALUATION_CANARY_CHECKS)[keyof typeof LEGACY_REEVALUATION_CANARY_CHECKS];

/** Result of one canary check. UNOBSERVABLE = the evidence lives outside the API database. */
export const LEGACY_REEVALUATION_CHECK_STATUSES = {
  PASS: "PASS",
  FAIL: "FAIL",
  /** The execution has not reached the point where this evidence can exist yet. */
  PENDING: "PENDING",
  UNOBSERVABLE: "UNOBSERVABLE",
} as const;
export type LegacyReevaluationCheckStatus =
  (typeof LEGACY_REEVALUATION_CHECK_STATUSES)[keyof typeof LEGACY_REEVALUATION_CHECK_STATUSES];

/** Cap on the exponential back-off after a failed start. */
export const LEGACY_REEVALUATION_MAX_BACKOFF_MS = 60_000;

/** Billing posture, read from the usage kernel: usage is provider telemetry only. */
export const LEGACY_REEVALUATION_USAGE_POLICY =
  "Provider token usage is recorded as telemetry (LlmUsageEvent, idempotent per invocation); a model invocation never reserves or debits wallet credits." as const;
