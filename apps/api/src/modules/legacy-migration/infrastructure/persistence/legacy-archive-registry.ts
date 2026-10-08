import { ASSESSMENT_ROOT_BOUNDARY } from "@lcsp/contracts/assessment-domain";
import { ASSESSMENT_RUNTIME_CONTROL_STATES as RUNTIME } from "@lcsp/contracts/evidence";
import { DOCUMENT_REQUEST_STATUSES as DOCUMENT } from "@lcsp/contracts/document";
import { REPOSITORY_SCAN_JOB_STATUSES as SCAN } from "@lcsp/contracts/github-integration";
import {
  TARGETED_REANALYSIS_CHECKPOINT_STATES as CHECKPOINT,
  TARGETED_REANALYSIS_REQUEST_STATES as REQUEST,
} from "@lcsp/contracts/scan";
import {
  LEGACY_ARCHIVE_SOURCES as SOURCE,
  type LegacyArchiveSource,
} from "@lcsp/contracts/legacy-migration";

/**
 * A V1 table that is copied set-based (`to_jsonb`, byte-exact) into `LegacyArchiveRecord`.
 * Every expression is a fixed literal owned by this file; no caller-supplied text ever reaches SQL.
 * `alias` is always `t`.
 */
export type SqlArchiveSource = {
  source: LegacyArchiveSource;
  /** Quoted SQL relation (may be a join expression that exposes alias `t`). */
  from: string;
  idExpr: string;
  /** NULL for global catalog rows that belong to no assessment. */
  assessmentExpr: string;
  /** Extra predicate; used to exclude V2-owned rows living in a shared table. */
  where?: string;
  /**
   * Columns V2 legitimately rewrites on the live row (for example the canonical lifecycle columns
   * the backfill sets). Live-vs-archive verification compares the row WITHOUT them.
   */
  stableExclude?: readonly string[];
  /**
   * Set when LIVE (non-retired) code keeps writing this table after the cutover (legal corpus
   * acquisition). The archive is then a snapshot: only rows that existed before the first migration
   * run must be archived, and a later change to a live row is not a mismatch. `createdColumn` is
   * the quoted timestamp column (alias `t`) that tells a row's age.
   */
  liveWritable?: { createdColumn: string };
};

const global = "NULL::text";

/**
 * V1-origin assessments: no canonical lifecycle yet (not backfilled) OR already summarized by the
 * migration. A V2-native assessment (created through the lifecycle coordinator) is never V1 history,
 * so a re-run after V2 traffic starts cannot sweep it into the archive.
 */
export const V1_ORIGIN_ASSESSMENT = `(t."lifecycleState" IS NULL OR EXISTS (
  SELECT 1 FROM "LegacyAssessmentArchive" s WHERE s."assessmentId" = t.id))`;

/** V2 hydration tickets share RepositoryScanJob with V1 scans; they are V2 state, not history. */
const NOT_V2_TICKET = `t."idempotencyKey" NOT LIKE 'runtime-hydration:%'`;

/**
 * The V2 Assessment Root records each execution in AssessmentRuntimeTurn (boundary ASSESSMENT_ROOT),
 * a table V1 also used. Those rows are live V2 execution control, never V1 history, and they are
 * legitimately RUNNING while a re-evaluation executes.
 */
export const NOT_V2_ROOT_TURN = `t."boundary" <> '${ASSESSMENT_ROOT_BOUNDARY}'`;

export const SQL_ARCHIVE_SOURCES: readonly SqlArchiveSource[] = [
  {
    source: SOURCE.ASSESSMENT,
    from: `"Assessment" t`,
    idExpr: "t.id",
    assessmentExpr: "t.id",
    where: V1_ORIGIN_ASSESSMENT,
    stableExclude: [
      "lifecycleState",
      "lifecycleRevision",
      "blockerReason",
      "blockerReference",
      "updatedAt",
    ],
  },
  {
    source: SOURCE.ASSESSMENT_INTERVIEW_THREAD,
    from: `"AssessmentInterviewThread" t`,
    idExpr: "t.id",
    assessmentExpr: `t."assessmentId"`,
  },
  {
    source: SOURCE.ENGINEERING_RULE_ASSESSMENT,
    from: `"EngineeringRuleAssessment" t`,
    idExpr: "t.id",
    assessmentExpr: `t."assessmentId"`,
  },
  {
    source: SOURCE.ASSESSMENT_RUNTIME_TURN,
    from: `"AssessmentRuntimeTurn" t`,
    idExpr: "t.id",
    assessmentExpr: `t."assessmentId"`,
    where: NOT_V2_ROOT_TURN,
  },
  {
    source: SOURCE.ASSESSMENT_RUNTIME_EVENT,
    from: `"AssessmentRuntimeEvent" t`,
    idExpr: "t.id",
    assessmentExpr: `t."assessmentId"`,
  },
  {
    source: SOURCE.PIPELINE_RECONCILIATION,
    from: `"AssessmentPipelineReconciliation" t`,
    idExpr: `t."assessmentId"`,
    assessmentExpr: `t."assessmentId"`,
  },
  {
    source: SOURCE.REPOSITORY_SCAN_JOB,
    from: `"RepositoryScanJob" t`,
    idExpr: "t.id",
    assessmentExpr: `t."assessmentId"`,
    where: NOT_V2_TICKET,
  },
  {
    source: SOURCE.TECHNICAL_EVIDENCE_REPORT,
    from: `"TechnicalEvidenceReport" t`,
    idExpr: "t.id",
    assessmentExpr: `t."assessmentId"`,
  },
  {
    source: SOURCE.TECHNICAL_PROFILE,
    from: `"TechnicalProfile" t`,
    idExpr: "t.id",
    assessmentExpr: `t."assessmentId"`,
  },
  {
    source: SOURCE.AI_USAGE_FLOW,
    from: `"AIUsageFlow" t`,
    idExpr: "t.id",
    assessmentExpr: `t."assessmentId"`,
  },
  {
    source: SOURCE.CONFLICT_RECORD,
    from: `"ConflictRecord" t`,
    idExpr: "t.id",
    assessmentExpr: `t."assessmentId"`,
  },
  {
    source: SOURCE.TARGETED_REANALYSIS_REQUEST,
    from: `"TargetedReanalysisRequest" t`,
    idExpr: "t.id",
    assessmentExpr: `t."assessmentId"`,
  },
  {
    source: SOURCE.TARGETED_REANALYSIS_CHECKPOINT,
    from: `"TargetedReanalysisCheckpoint" t JOIN "TargetedReanalysisRequest" r ON r.id = t."requestId"`,
    idExpr: "t.id",
    assessmentExpr: `r."assessmentId"`,
  },
  {
    source: SOURCE.VERIFIED_AGENT_EPISODE,
    from: `"VerifiedAgentEpisode" t`,
    idExpr: "t.id",
    assessmentExpr: `t."assessmentId"`,
  },
  {
    source: SOURCE.VERIFIED_PROFILE,
    from: `"VerifiedProfile" t`,
    idExpr: "t.id",
    assessmentExpr: `t."assessmentId"`,
  },
  {
    source: SOURCE.CLASSIFICATION_RESULT,
    from: `"ClassificationResult" t`,
    idExpr: "t.id",
    assessmentExpr: `t."assessmentId"`,
  },
  {
    source: SOURCE.CLASSIFICATION_REVIEW_REQUEST,
    from: `"ClassificationReviewRequest" t`,
    idExpr: "t.id",
    assessmentExpr: `t."assessmentId"`,
  },
  {
    source: SOURCE.LEGAL_RULE_MATCH,
    from: `"LegalRuleMatch" t`,
    idExpr: "t.id",
    assessmentExpr: `t."assessmentId"`,
  },
  {
    source: SOURCE.DECISION_MODEL_DECISION,
    from: `"DecisionModelDecision" t`,
    idExpr: `t."decisionId"`,
    assessmentExpr: `(SELECT a.id FROM "Assessment" a WHERE a.id = t."assessmentId")`,
  },
  {
    source: SOURCE.DECISION_MODEL_EVENT,
    from: `"DecisionModelEvent" t`,
    idExpr: "t.id",
    assessmentExpr: `(SELECT a.id FROM "Assessment" a WHERE a.id = t."assessmentId")`,
  },
  {
    source: SOURCE.LEGAL_RULE_CATALOG_VERSION,
    from: `"LegalRuleCatalogVersion" t`,
    idExpr: "t.id",
    assessmentExpr: global,
  },
  {
    source: SOURCE.LEGAL_RULE,
    from: `"LegalRule" t`,
    idExpr: "t.id",
    assessmentExpr: global,
  },
  {
    source: SOURCE.RULE_APPROVAL_RECORD,
    from: `"RuleApprovalRecord" t`,
    idExpr: "t.id",
    assessmentExpr: global,
  },
  {
    source: SOURCE.CORPUS_APPROVAL_RECORD,
    from: `"CorpusApprovalRecord" t`,
    idExpr: "t.id",
    assessmentExpr: global,
    liveWritable: { createdColumn: `t."approvalDate"` },
  },
  {
    source: SOURCE.CORPUS_DISCARD_RECEIPT,
    from: `"CorpusDiscardReceipt" t`,
    idExpr: "t.id",
    assessmentExpr: global,
  },
  {
    source: SOURCE.CORPUS_PREPARATION,
    from: `"CorpusPreparation" t`,
    idExpr: "t.id",
    assessmentExpr: global,
    liveWritable: { createdColumn: `t."createdAt"` },
  },
] as const;

/**
 * Report-related V1 sources. They are archived by the TypeScript reconciliation (classification is
 * decided before the insert), but their rows are the same exact `to_jsonb` copies, so verification
 * and sampling treat them like any SQL source.
 */
export const REPORT_ARCHIVE_SOURCES: readonly SqlArchiveSource[] = [
  {
    source: SOURCE.DOCUMENT_REQUEST,
    from: `"DocumentRequest" t`,
    idExpr: "t.id",
    assessmentExpr: `t."assessmentId"`,
  },
  {
    source: SOURCE.READINESS_EXPORT,
    from: `"ReadinessExport" t`,
    idExpr: "t.id",
    assessmentExpr: `t."assessmentId"`,
  },
] as const;

/**
 * The only SQL-archived sources whose live rows may legitimately differ from their archived copy,
 * because quiescence closes in-flight V1 work AFTER archiving the original (see `QUIESCE_CLOSURES`).
 */
export const CLOSED_AT_QUIESCENCE_SOURCES: ReadonlySet<LegacyArchiveSource> =
  new Set([
    SOURCE.ASSESSMENT_RUNTIME_TURN,
    SOURCE.TARGETED_REANALYSIS_REQUEST,
    SOURCE.TARGETED_REANALYSIS_CHECKPOINT,
    SOURCE.REPOSITORY_SCAN_JOB,
    SOURCE.DOCUMENT_REQUEST,
  ]);

/** Deterministic, version-portable record id for one archived row. */
export const ARCHIVE_RECORD_ID_SQL = (source: string, idExpr: string): string =>
  `md5('LEGACY_ARCHIVE:' || '${source}' || ':' || ${idExpr})::uuid`;

/** Hash of the stored/generated jsonb text: identical expression at archive and at verification. */
export const PAYLOAD_SHA256_SQL = (jsonbExpr: string): string =>
  `encode(sha256(convert_to((${jsonbExpr})::text, 'UTF8')), 'hex')`;

/**
 * In-flight V1 work that quiescence closes AFTER its original row was archived. Rows are never
 * deleted; they move to a terminal state with a marker so no V1 table claims live execution.
 */
export type InFlightClosureRule = {
  source: LegacyArchiveSource;
  /** Quoted relation, alias `t`. */
  from: string;
  /** Column holding the V1 state, and the JSON key it has inside the archived payload. */
  stateColumn: string;
  payloadKey: string;
  inFlight: readonly string[];
  closedTo: string;
  /** Optional marker column written with the closure. */
  markerColumn?: string;
  /** Extra predicate on alias `t` (for example excluding V2 hydration tickets). */
  where?: string;
  /** Primary-key expression used to find the archived original. */
  idExpr: string;
};

export const IN_FLIGHT_CLOSURE_RULES: readonly InFlightClosureRule[] = [
  {
    source: SOURCE.ASSESSMENT_RUNTIME_TURN,
    from: `"AssessmentRuntimeTurn" t`,
    stateColumn: `"state"`,
    payloadKey: "state",
    inFlight: [RUNTIME.running, RUNTIME.stopRequested, RUNTIME.resumeRequested],
    closedTo: RUNTIME.stopped,
    where: NOT_V2_ROOT_TURN,
    idExpr: "t.id",
  },
  {
    source: SOURCE.TARGETED_REANALYSIS_REQUEST,
    from: `"TargetedReanalysisRequest" t`,
    stateColumn: `"state"`,
    payloadKey: "state",
    inFlight: [REQUEST.queued, REQUEST.dispatched, REQUEST.running],
    closedTo: REQUEST.failed,
    markerColumn: `"safeFailureCode"`,
    idExpr: "t.id",
  },
  {
    source: SOURCE.TARGETED_REANALYSIS_CHECKPOINT,
    from: `"TargetedReanalysisCheckpoint" t`,
    stateColumn: `"state"`,
    payloadKey: "state",
    inFlight: [
      CHECKPOINT.pendingDispatch,
      CHECKPOINT.dispatched,
      CHECKPOINT.running,
      CHECKPOINT.retryScheduled,
    ],
    closedTo: CHECKPOINT.failed,
    markerColumn: `"safeFailureCode"`,
    idExpr: "t.id",
  },
  {
    source: SOURCE.REPOSITORY_SCAN_JOB,
    from: `"RepositoryScanJob" t`,
    stateColumn: `"status"`,
    payloadKey: "status",
    inFlight: [
      SCAN.queued,
      SCAN.running,
      SCAN.pendingMapping,
      SCAN.waitingForContext,
      SCAN.waitingForCredits,
      SCAN.readyToSnapshot,
    ],
    closedTo: SCAN.failed,
    markerColumn: `"blockedReason"`,
    where: NOT_V2_TICKET,
    idExpr: "t.id",
  },
  {
    source: SOURCE.DOCUMENT_REQUEST,
    from: `"DocumentRequest" t`,
    stateColumn: `"status"`,
    payloadKey: "status",
    inFlight: [DOCUMENT.queued, DOCUMENT.generating],
    closedTo: DOCUMENT.failed,
    markerColumn: `"blockedReason"`,
    idExpr: "t.id",
  },
] as const;

const sqlList = (values: readonly string[]): string =>
  values.map((value) => `'${value}'`).join(", ");

/**
 * UPDATE that closes in-flight rows. The `EXISTS` guard makes it impossible to close a row whose
 * original has not been archived, independent of the order the caller runs things in.
 */
export const closureUpdateSql = (
  rule: InFlightClosureRule,
  marker: string,
): string => `
  UPDATE ${rule.from.replace(/ t$/u, "")} AS t
     SET ${rule.stateColumn} = '${rule.closedTo}',
         ${rule.markerColumn ? `${rule.markerColumn} = '${marker}',` : ""}
         "updatedAt" = now()
   WHERE ${rule.stateColumn}::text IN (${sqlList(rule.inFlight)})
     ${rule.where ? `AND ${rule.where}` : ""}
     AND EXISTS (
       SELECT 1 FROM "LegacyArchiveRecord" lr
        WHERE lr."sourceTable" = '${rule.source}'::"LegacyArchiveSource"
          AND lr."sourceId" = ${rule.idExpr}
          AND lr.payload ->> '${rule.payloadKey}' IN (${sqlList(rule.inFlight)})
     )`;
