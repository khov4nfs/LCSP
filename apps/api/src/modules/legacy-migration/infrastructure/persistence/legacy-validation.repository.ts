import {
  ASSESSMENT_ROOT_BOUNDARY,
  ASSESSMENT_ROOT_COMMAND_TYPES,
} from "@lcsp/contracts/assessment-domain";
import {
  ASSESSMENT_LIFECYCLE_STATES as L,
  BLOCKER_REASONS,
} from "@lcsp/contracts/assessment";
import {
  LEGACY_ASSESSMENT_DISPOSITIONS,
  LEGACY_CORRELATION_PREFIXES,
  LEGACY_MIGRATION_RUN_KINDS,
  LEGACY_TERMINAL_ASSESSMENT_STATUSES,
  type LegacyArchiveSource,
} from "@lcsp/contracts/legacy-migration";
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import {
  PAYLOAD_SHA256_SQL,
  SQL_ARCHIVE_SOURCES,
  type InFlightClosureRule,
  type SqlArchiveSource,
} from "./legacy-archive-registry.js";

const TERMINAL = Object.values(LEGACY_TERMINAL_ASSESSMENT_STATUSES)
  .map((status) => `'${status}'`)
  .join(", ");

const list = (values: readonly string[]): string =>
  values.map((value) => `'${value}'`).join(", ");

const MIGRATION_RUN_KINDS = `'${LEGACY_MIGRATION_RUN_KINDS.REHEARSAL}', '${LEGACY_MIGRATION_RUN_KINDS.CUTOVER}'`;

export type PortfolioFacts = {
  activeCount: number;
  id: string | null;
  version: string | null;
  engineeringRuleCount: number;
};

/** Read-only SQL for preflight and validation. Fixed literals only; values are bound. */
@Injectable()
export class LegacyValidationRepository {
  constructor(private readonly prisma: PrismaService) {}

  private async rows<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    return this.prisma.$queryRawUnsafe<T[]>(sql, ...params);
  }

  private async one<T>(sql: string, ...params: unknown[]): Promise<T> {
    const [row] = await this.rows<T>(sql, ...params);
    return row;
  }

  private async count(sql: string, ...params: unknown[]): Promise<number> {
    const row = await this.one<{ n: number }>(sql, ...params);
    return Number(row?.n ?? 0);
  }

  // ---- portfolio & assessments ---------------------------------------------------------------

  async activePortfolio(): Promise<PortfolioFacts> {
    const row = await this.one<{
      n: number;
      id: string | null;
      version: string | null;
      rules: number;
    }>(`SELECT count(*)::int AS n, min(p.id) AS id, min(p.version) AS version,
               coalesce(max((SELECT count(*)::int FROM "EngineeringRule" r WHERE r."portfolioVersionId" = p.id)), 0) AS rules
          FROM "LegalPortfolioVersion" p WHERE p."lifecycleState" = 'ACTIVE'`);
    return {
      activeCount: Number(row?.n ?? 0),
      id: row?.id ?? null,
      version: row?.version ?? null,
      engineeringRuleCount: Number(row?.rules ?? 0),
    };
  }

  assessmentCounts() {
    return this.one<{
      total: number;
      terminal: number;
      non_terminal: number;
      already_v2: number;
    }>(`SELECT count(*)::int AS total,
               count(*) FILTER (WHERE status::text IN (${TERMINAL}))::int AS terminal,
               count(*) FILTER (WHERE status::text NOT IN (${TERMINAL}))::int AS non_terminal,
               count(*) FILTER (WHERE "lifecycleState" IS NOT NULL)::int AS already_v2
          FROM "Assessment"`);
  }

  assessmentsByLegacyStatus() {
    return this.rows<{ status: string; n: number }>(
      `SELECT status::text AS status, count(*)::int AS n FROM "Assessment" GROUP BY 1 ORDER BY 1`,
    );
  }

  /** New V1 backfills, plus unstarted backfills still missing their input disposition. */
  nextBackfillCandidates(limit: number) {
    return this.rows<{ id: string; ownerId: string; status: string }>(
      `SELECT a.id, a."ownerId", a.status::text AS status FROM "Assessment" a
        WHERE a.status::text NOT IN (${TERMINAL}) AND (
          a."lifecycleState" IS NULL OR (
            a."lifecycleState"::text = '${L.PREPARING}'
            AND EXISTS (SELECT 1 FROM "LegacyAssessmentArchive" s WHERE s."assessmentId" = a.id
                         AND s.disposition = '${LEGACY_ASSESSMENT_DISPOSITIONS.BACKFILLED_NON_TERMINAL}')
            AND EXISTS (SELECT 1 FROM "AssessmentCase" c WHERE c."assessmentId" = a.id AND c."repositorySnapshotId" IS NULL)
            AND EXISTS (SELECT 1 FROM "AssessmentRuntime" r WHERE r."assessmentId" = a.id AND r."startedAt" IS NULL)
            AND NOT EXISTS (SELECT 1 FROM "LegacyReevaluation" l WHERE l."assessmentId" = a.id)))
        ORDER BY a."createdAt", a.id LIMIT $1`,
      limit,
    );
  }

  /** V1 snapshot provenance scoped to its original assessment/customer; no cross-assessment reuse. */
  async snapshotsForBackfill(
    tx: Prisma.TransactionClient,
    assessmentId: string,
    ownerId: string,
  ) {
    const snapshots = await tx.repositorySnapshot.findMany({
      where: {
        assessmentId,
        actorId: ownerId,
        connection: {
          userId: ownerId,
          OR: [{ assessmentId }, { assessmentId: null }],
        },
      },
      select: {
        id: true,
        status: true,
        commitSha: true,
        repositoryId: true,
        repositoryFullName: true,
        createdAt: true,
        connection: {
          select: {
            status: true,
            repositoryId: true,
            repositoryFullName: true,
          },
        },
      },
    });
    return snapshots.map((snapshot) => ({
      id: snapshot.id,
      status: snapshot.status,
      commitSha: snapshot.commitSha,
      createdAt: snapshot.createdAt,
      repositoryId: snapshot.repositoryId,
      repositoryFullName: snapshot.repositoryFullName,
      connectionStatus: snapshot.connection?.status ?? null,
      connectionRepositoryId: snapshot.connection?.repositoryId ?? null,
      connectionRepositoryFullName:
        snapshot.connection?.repositoryFullName ?? null,
    }));
  }

  async hasRootStart(
    tx: Prisma.TransactionClient,
    assessmentId: string,
  ): Promise<boolean> {
    const ledger = await tx.legacyReevaluation.findUnique({
      where: { assessmentId },
    });
    if (ledger) return true;
    return (
      (await tx.outboxMessage.count({
        where: {
          aggregateId: assessmentId,
          eventType: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
        },
      })) > 0
    );
  }

  /** Keyset page of report references, for the read-only preflight classification. */
  documentReferences(afterId: string, limit: number) {
    return this.rows<{
      id: string;
      status: string;
      documentUrl: string | null;
    }>(
      `SELECT id, status::text AS status, "documentUrl" FROM "DocumentRequest"
        WHERE id > $1 ORDER BY id LIMIT $2`,
      afterId,
      limit,
    );
  }

  // ---- outbox --------------------------------------------------------------------------------

  undeliveredOutbox() {
    return this.rows<{ eventType: string; status: string; n: number }>(
      `SELECT "eventType", status::text AS status, count(*)::int AS n FROM "OutboxMessage"
        WHERE status IN ('PENDING', 'FAILED', 'DLQ') GROUP BY 1, 2 ORDER BY 1, 2`,
    );
  }

  undeliveredLegacyOutbox(eventTypes: readonly string[]) {
    return this.count(
      `SELECT count(*)::int AS n FROM "OutboxMessage"
        WHERE status IN ('PENDING', 'FAILED', 'DLQ') AND "eventType" = ANY($1::text[])`,
      eventTypes,
    );
  }

  cancelledOutboxFacts() {
    return this.one<{ cancelled: number; archived: number; audited: number }>(
      `SELECT (SELECT count(*)::int FROM "OutboxMessage" WHERE status = 'CANCELLED') AS cancelled,
              (SELECT count(*)::int FROM "OutboxMessage" m JOIN "LegacyArchiveRecord" lr
                 ON lr."sourceTable" = 'OUTBOX_MESSAGE_CANCELLED' AND lr."sourceId" = m.id
                WHERE m.status = 'CANCELLED') AS archived,
              (SELECT count(*)::int FROM "OutboxMessage" m JOIN "AuditEvent" ae
                 ON ae."eventType" = 'OUTBOX_LEGACY_CANCELLED' AND ae."resourceId" = m.id
                WHERE m.status = 'CANCELLED') AS audited`,
    );
  }

  // ---- in-flight work & billing --------------------------------------------------------------

  inFlightCount(rule: InFlightClosureRule): Promise<number> {
    return this.count(
      `SELECT count(*)::int AS n FROM ${rule.from}
        WHERE ${rule.stateColumn}::text IN (${list(rule.inFlight)}) ${rule.where ? `AND ${rule.where}` : ""}`,
    );
  }

  /** Reservations still open on V1-owned assessments (no canonical lifecycle). */
  unsettledV1Reservations() {
    return this.one<{ n: number; credits: string }>(
      `SELECT count(*)::int AS n, coalesce(sum(r."remainingCredits"), 0)::text AS credits
         FROM "BillingReservation" r JOIN "Assessment" a ON a.id = r."assessmentId"
        WHERE r.status = 'RESERVED' AND a."lifecycleState" IS NULL`,
    );
  }

  // ---- archive coverage & integrity ----------------------------------------------------------

  /** live vs archived rows for one SQL source; hash comparison skips rows closed after archiving. */
  archiveCoverage(rule: SqlArchiveSource, closure?: InFlightClosureRule) {
    const where = rule.where ? `WHERE ${rule.where}` : "";
    const closedFilter = closure
      ? `AND NOT (lr.payload ->> '${closure.payloadKey}' IN (${list(closure.inFlight)}))`
      : "";
    const exclude = rule.stableExclude
      ? `ARRAY[${list(rule.stableExclude)}]::text[]`
      : null;
    // Rows V2 rewrites are compared without the V2-owned columns; everything else by stored hash.
    const differs = exclude
      ? `${PAYLOAD_SHA256_SQL(`to_jsonb(t) - ${exclude}`)} <> ${PAYLOAD_SHA256_SQL(`lr.payload - ${exclude}`)}`
      : `lr."payloadSha256" <> ${PAYLOAD_SHA256_SQL("to_jsonb(t)")}`;
    // Live-writable sources: the archive is a snapshot. Only rows older than the first migration run
    // must be archived, and a live row that changed since is not a mismatch.
    const firstRun = `(SELECT min("startedAt") AT TIME ZONE 'UTC' FROM "LegacyMigrationRun" WHERE kind IN (${MIGRATION_RUN_KINDS}))`;
    const missingFilter = rule.liveWritable
      ? `AND ${rule.liveWritable.createdColumn} < ${firstRun}`
      : "";
    const mismatchedPredicate = rule.liveWritable ? "false" : differs;
    return this.one<{
      live: number;
      archived: number;
      missing: number;
      mismatched: number;
    }>(
      `SELECT count(*)::int AS live,
              count(lr.id)::int AS archived,
              count(*) FILTER (WHERE lr.id IS NULL ${missingFilter})::int AS missing,
              count(*) FILTER (WHERE lr.id IS NOT NULL ${closedFilter} AND ${mismatchedPredicate})::int AS mismatched
         FROM ${rule.from}
         LEFT JOIN "LegacyArchiveRecord" lr
           ON lr."sourceTable" = '${rule.source}'::"LegacyArchiveSource" AND lr."sourceId" = ${rule.idExpr}
         ${where}`,
    );
  }

  closureOutcome(rule: InFlightClosureRule) {
    return this.one<{ closed_ok: number; closed_bad: number }>(
      `SELECT count(*) FILTER (WHERE ${rule.stateColumn}::text = '${rule.closedTo}')::int AS closed_ok,
              count(*) FILTER (WHERE ${rule.stateColumn}::text <> '${rule.closedTo}')::int AS closed_bad
         FROM ${rule.from}
         JOIN "LegacyArchiveRecord" lr
           ON lr."sourceTable" = '${rule.source}'::"LegacyArchiveSource" AND lr."sourceId" = ${rule.idExpr}
        WHERE lr.payload ->> '${rule.payloadKey}' IN (${list(rule.inFlight)})
          ${rule.where ? `AND ${rule.where}` : ""}`,
    );
  }

  payloadIntegrityFailures() {
    return this.count(
      `SELECT count(*)::int AS n FROM "LegacyArchiveRecord"
        WHERE "payloadSha256" <> ${PAYLOAD_SHA256_SQL("payload")}`,
    );
  }

  /** Deterministic ids must equal their definition: detects hand-edited or re-keyed archive rows. */
  archiveRowIdFailures() {
    return this.count(
      `SELECT count(*)::int AS n FROM "LegacyArchiveRecord" lr
        WHERE lr.id <> md5('LEGACY_ARCHIVE:' || lr."sourceTable"::text || ':' || lr."sourceId")::uuid`,
    );
  }

  // ---- per-assessment summaries ---------------------------------------------------------------

  summaryFacts() {
    return this.one<{
      v1_assessments: number;
      summaries: number;
      terminal_ok: number;
      non_terminal_ok: number;
      owner_mismatch: number;
      digest_mismatch: number;
      count_mismatch: number;
    }>(
      `SELECT (SELECT count(*)::int FROM "LegacyArchiveRecord" WHERE "sourceTable" = 'ASSESSMENT') AS v1_assessments,
              (SELECT count(*)::int FROM "LegacyAssessmentArchive") AS summaries,
              (SELECT count(*)::int FROM "LegacyAssessmentArchive" s JOIN "Assessment" a ON a.id = s."assessmentId"
                WHERE s.disposition = '${LEGACY_ASSESSMENT_DISPOSITIONS.ARCHIVED_TERMINAL}'
                  AND a.status::text IN (${TERMINAL})) AS terminal_ok,
              (SELECT count(*)::int FROM "LegacyAssessmentArchive" s JOIN "Assessment" a ON a.id = s."assessmentId"
                WHERE s.disposition = '${LEGACY_ASSESSMENT_DISPOSITIONS.BACKFILLED_NON_TERMINAL}'
                  AND a.status::text NOT IN (${TERMINAL})) AS non_terminal_ok,
              (SELECT count(*)::int FROM "LegacyAssessmentArchive" s JOIN "Assessment" a ON a.id = s."assessmentId"
                WHERE s."ownerId" <> a."ownerId") AS owner_mismatch,
              (SELECT count(*)::int FROM "LegacyAssessmentArchive" s
                WHERE s."payloadDigest" <> encode(sha256(convert_to(coalesce((
                        SELECT string_agg(r."sourceTable"::text || ':' || r."sourceId" || ':' || r."payloadSha256", E'\\n'
                                          ORDER BY r."sourceTable"::text COLLATE "C", r."sourceId" COLLATE "C")
                          FROM "LegacyArchiveRecord" r WHERE r."assessmentId" = s."assessmentId"), ''), 'UTF8')), 'hex')) AS digest_mismatch,
              (SELECT count(*)::int FROM "LegacyAssessmentArchive" s
                WHERE s."recordCount" <> (SELECT count(*)::int FROM "LegacyArchiveRecord" r WHERE r."assessmentId" = s."assessmentId")) AS count_mismatch`,
    );
  }

  /** Terminal archived assessments must carry NO canonical state: nothing invented from V1 status. */
  terminalWithV2State() {
    return this.count(
      `SELECT count(*)::int AS n FROM "LegacyAssessmentArchive" s JOIN "Assessment" a ON a.id = s."assessmentId"
        WHERE s.disposition = '${LEGACY_ASSESSMENT_DISPOSITIONS.ARCHIVED_TERMINAL}'
          AND (a."lifecycleState" IS NOT NULL OR a."lifecycleRevision" IS NOT NULL
               OR EXISTS (SELECT 1 FROM "AssessmentRuntime" r WHERE r."assessmentId" = a.id)
               OR EXISTS (SELECT 1 FROM "AssessmentCase" c WHERE c."assessmentId" = a.id))`,
    );
  }

  backfilledFacts() {
    return this.one<{
      backfilled: number;
      missing_state: number;
      missing_runtime: number;
      thread_mismatch: number;
      missing_portfolio_pin: number;
      bad_pin: number;
      coverage_gap: number;
      promoted_records: number;
      duplicate_threads: number;
      v1_thread_reuse: number;
      repository_pinned: number;
      waiting_for_repository: number;
      blocked_repository: number;
      unexplained_unpinned: number;
      unpinned_execution: number;
    }>(
      `WITH b AS (
         SELECT s."assessmentId", s."v2ThreadId" FROM "LegacyAssessmentArchive" s
          WHERE s.disposition = '${LEGACY_ASSESSMENT_DISPOSITIONS.BACKFILLED_NON_TERMINAL}'),
       inputs AS (
         SELECT b."assessmentId", c."repositorySnapshotId", a."lifecycleState", a."blockerReason", a."blockerReference",
                (a."lifecycleState"::text = '${L.WAITING_FOR_REQUIRED_INPUT}' OR
                  (a."lifecycleState"::text = '${L.BLOCKED}' AND a."blockerReason"::text = '${BLOCKER_REASONS.REPOSITORY_SNAPSHOT_UNAVAILABLE}'
                    AND (a."blockerReference" ? 'repositorySnapshotId' OR a."blockerReference" ? 'requiredInputId'))) AS explained
           FROM b JOIN "Assessment" a ON a.id = b."assessmentId"
             LEFT JOIN "AssessmentCase" c ON c."assessmentId" = b."assessmentId")
       SELECT (SELECT count(*)::int FROM b) AS backfilled,
              (SELECT count(*)::int FROM b JOIN "Assessment" a ON a.id = b."assessmentId"
                WHERE a."lifecycleState" IS NULL OR a."lifecycleRevision" IS NULL) AS missing_state,
              (SELECT count(*)::int FROM b LEFT JOIN "AssessmentRuntime" r ON r."assessmentId" = b."assessmentId"
                WHERE r."assessmentId" IS NULL) AS missing_runtime,
              (SELECT count(*)::int FROM b JOIN "AssessmentRuntime" r ON r."assessmentId" = b."assessmentId"
                WHERE r."threadId" <> b."v2ThreadId") AS thread_mismatch,
              (SELECT count(*)::int FROM b LEFT JOIN "AssessmentCase" c ON c."assessmentId" = b."assessmentId"
                WHERE c."legalPortfolioVersionId" IS NULL) AS missing_portfolio_pin,
              (SELECT count(*)::int FROM b JOIN "AssessmentCase" c ON c."assessmentId" = b."assessmentId"
                WHERE c."repositorySnapshotId" IS NOT NULL AND NOT EXISTS (
                  SELECT 1 FROM "RepositorySnapshot" rs JOIN "RepositoryConnection" rc ON rc.id = rs."connectionId"
                    JOIN "Assessment" a ON a.id = c."assessmentId"
                   WHERE rs.id = c."repositorySnapshotId" AND rs."assessmentId" = c."assessmentId"
                     AND rs."actorId" = a."ownerId" AND rc."userId" = a."ownerId"
                     AND (rc."assessmentId" IS NULL OR rc."assessmentId" = a.id)
                     AND rs."repositoryId" = rc."repositoryId" AND rs."repositoryFullName" = rc."repositoryFullName"
                     AND length(btrim(rs."repositoryId")) > 0 AND length(btrim(rs."repositoryFullName")) > 0
                     AND rs.status::text = 'READY' AND rc.status::text = 'ACTIVE'
                     AND rs."commitSha" ~ '^[0-9a-fA-F]{40,64}$'
                     AND lower(rs."commitSha") = c."repositoryCommit")) AS bad_pin,
              (SELECT count(*)::int FROM b JOIN "AssessmentCase" c ON c."assessmentId" = b."assessmentId"
                WHERE c."repositorySnapshotId" IS NOT NULL
                  AND (SELECT count(*) FROM "AssessmentDecisionCoverage" dc WHERE dc."assessmentId" = c."assessmentId")
                      <> (SELECT count(*) FROM "EngineeringRule" er WHERE er."portfolioVersionId" = c."legalPortfolioVersionId")) AS coverage_gap,
              (SELECT count(*)::int FROM b JOIN "Assessment" a ON a.id = b."assessmentId"
                WHERE a."lifecycleState"::text IN ('${L.PREPARING}', '${L.WAITING_FOR_REQUIRED_INPUT}', '${L.BLOCKED}')
                  AND NOT EXISTS (SELECT 1 FROM "AssessmentRuntime" r WHERE r."assessmentId" = a.id AND r."startedAt" IS NOT NULL)
                  AND (
                  EXISTS (SELECT 1 FROM "AssessmentEvidence" e WHERE e."assessmentId" = a.id)
                  OR EXISTS (SELECT 1 FROM "AssessmentCaseFact" f WHERE f."assessmentId" = a.id)
                  OR EXISTS (SELECT 1 FROM "AssessmentRuleDecision" d WHERE d."assessmentId" = a.id)
                  OR EXISTS (SELECT 1 FROM "AssessmentHumanRequest" h WHERE h."assessmentId" = a.id))) AS promoted_records,
              (SELECT count(*)::int - count(DISTINCT "threadId")::int FROM "AssessmentRuntime") AS duplicate_threads,
              (SELECT count(*)::int FROM "AssessmentRuntime" r
                WHERE EXISTS (SELECT 1 FROM "AssessmentRuntimeTurn" t
                               WHERE t."threadId" = r."threadId"::text AND t."boundary" <> '${ASSESSMENT_ROOT_BOUNDARY}')) AS v1_thread_reuse,
              (SELECT count(*)::int FROM inputs WHERE "repositorySnapshotId" IS NOT NULL) AS repository_pinned,
              (SELECT count(*)::int FROM inputs WHERE "repositorySnapshotId" IS NULL AND "lifecycleState"::text = '${L.WAITING_FOR_REQUIRED_INPUT}') AS waiting_for_repository,
              (SELECT count(*)::int FROM inputs WHERE "repositorySnapshotId" IS NULL AND "lifecycleState"::text = '${L.BLOCKED}' AND explained) AS blocked_repository,
              (SELECT count(*)::int FROM inputs WHERE "repositorySnapshotId" IS NULL AND explained IS DISTINCT FROM true) AS unexplained_unpinned,
              (SELECT count(*)::int FROM inputs i WHERE i."repositorySnapshotId" IS NULL AND (
                 EXISTS (SELECT 1 FROM "AssessmentRuntime" r WHERE r."assessmentId" = i."assessmentId"
                          AND (r."startedAt" IS NOT NULL OR r."currentExecutionId" IS NOT NULL OR r."leaseToken" IS NOT NULL))
                 OR EXISTS (SELECT 1 FROM "OutboxMessage" m WHERE m."aggregateId" = i."assessmentId" AND m."eventType" = '${ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED}'))
              ) AS unpinned_execution`,
    );
  }

  // ---- the migration starts nothing and spends nothing -------------------------------------------

  /**
   * Facts that prove the migration enqueued no Root command and caused no AI/accounting effect.
   * "Unstarted" = backfilled, still PREPARING, and never started by an operator re-evaluation. A
   * customer who deliberately starts a migrated assessment through the product flow leaves PREPARING,
   * so that explicit action is never mistaken for a migration side effect. Usage and reservations
   * are counted only when created after the first migration run began (V1-era rows are history).
   */
  migrationAiEffectFacts() {
    const root = ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED;
    return this.one<{
      migration_root_commands: number;
      unstarted: number;
      unstarted_with_effect: number;
      ledger_mismatch: number;
    }>(
      `WITH first_run AS (
         SELECT min("startedAt") AS at FROM "LegacyMigrationRun"
          WHERE kind IN ('${LEGACY_MIGRATION_RUN_KINDS.REHEARSAL}', '${LEGACY_MIGRATION_RUN_KINDS.CUTOVER}')),
       unstarted AS (
         SELECT s."assessmentId" FROM "LegacyAssessmentArchive" s
           JOIN "Assessment" a ON a.id = s."assessmentId"
           LEFT JOIN "LegacyReevaluation" l ON l."assessmentId" = s."assessmentId"
          WHERE s.disposition = '${LEGACY_ASSESSMENT_DISPOSITIONS.BACKFILLED_NON_TERMINAL}'
            AND a."lifecycleState"::text IN ('${L.PREPARING}', '${L.WAITING_FOR_REQUIRED_INPUT}', '${L.BLOCKED}')
            AND l."assessmentId" IS NULL)
       SELECT (SELECT count(*)::int FROM "OutboxMessage" m
                WHERE m."eventType" = $1
                  AND m.payload ->> 'correlationId' LIKE '${LEGACY_CORRELATION_PREFIXES.MIGRATION}%') AS migration_root_commands,
              (SELECT count(*)::int FROM unstarted) AS unstarted,
              (SELECT count(*)::int FROM unstarted u
                WHERE EXISTS (SELECT 1 FROM "OutboxMessage" m WHERE m."aggregateId" = u."assessmentId" AND m."eventType" = $1)
                   OR EXISTS (SELECT 1 FROM "AssessmentRuntime" r WHERE r."assessmentId" = u."assessmentId"
                               AND (r."startedAt" IS NOT NULL OR r."currentExecutionId" IS NOT NULL OR r."leaseToken" IS NOT NULL))
                   OR EXISTS (SELECT 1 FROM "AssessmentEvent" e WHERE e."assessmentId" = u."assessmentId" AND e."actorType" <> 'API')
                   OR EXISTS (SELECT 1 FROM "LlmUsageEvent" x, first_run f WHERE x."assessmentId" = u."assessmentId" AND x."createdAt" >= f.at)
                   OR EXISTS (SELECT 1 FROM "BillingReservation" b, first_run f WHERE b."assessmentId" = u."assessmentId" AND b."createdAt" >= f.at)) AS unstarted_with_effect,
              (SELECT count(*)::int FROM "LegacyReevaluation" l
                WHERE (SELECT count(*) FROM "OutboxMessage" m
                        WHERE m."aggregateId" = l."assessmentId" AND m."eventType" = $1
                          AND m.payload ->> 'idempotencyKey' = l."assessmentId" || ':' || $1 || ':start') <> 1
                   OR NOT EXISTS (SELECT 1 FROM "OutboxMessage" m WHERE m.id = l."rootCommandId"))
              + (SELECT count(*)::int FROM "OutboxMessage" m
                  WHERE m."eventType" = $1
                    AND m.payload ->> 'correlationId' LIKE '${LEGACY_CORRELATION_PREFIXES.REEVALUATION}%'
                    AND NOT EXISTS (SELECT 1 FROM "LegacyReevaluation" l WHERE l."assessmentId" = m."aggregateId")) AS ledger_mismatch`,
      root,
    );
  }

  // ---- report reconciliation ------------------------------------------------------------------

  reportClassCounts() {
    return this.rows<{ cls: string; reason: string; n: number }>(
      `SELECT "reconciliationClass"::text AS cls, "reconciliationReason"::text AS reason, count(*)::int AS n
         FROM "LegacyArchiveRecord" WHERE "reconciliationClass" IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2`,
    );
  }

  blobFacts() {
    return this.one<{
      blobs: number;
      copied_with_blob: number;
      copied_without_blob: number;
      orphan_blobs: number;
    }>(
      `SELECT (SELECT count(*)::int FROM "LegacyArchiveBlob") AS blobs,
              (SELECT count(*)::int FROM "LegacyArchiveRecord" lr JOIN "LegacyArchiveBlob" b ON b."recordId" = lr.id
                WHERE lr."reconciliationReason" = 'COPIED_AND_VERIFIED') AS copied_with_blob,
              (SELECT count(*)::int FROM "LegacyArchiveRecord" lr LEFT JOIN "LegacyArchiveBlob" b ON b."recordId" = lr.id
                WHERE lr."reconciliationReason" = 'COPIED_AND_VERIFIED' AND b."recordId" IS NULL) AS copied_without_blob,
              (SELECT count(*)::int FROM "LegacyArchiveBlob" b LEFT JOIN "LegacyArchiveRecord" lr ON lr.id = b."recordId"
                WHERE lr.id IS NULL OR lr."reconciliationReason" IS DISTINCT FROM 'COPIED_AND_VERIFIED') AS orphan_blobs`,
    );
  }

  allBlobs() {
    return this.rows<{
      recordId: string;
      contentSha256: string;
      sizeBytes: number;
      storageRef: string;
    }>(
      `SELECT "recordId", "contentSha256", "sizeBytes", "storageRef" FROM "LegacyArchiveBlob" ORDER BY "recordId"`,
    );
  }

  /** Reports with a stored payload that is not a verbatim `to_jsonb` of a still-present live row. */
  reportPayloadMissingLive() {
    return this.count(
      `SELECT count(*)::int AS n FROM "LegacyArchiveRecord" lr
        WHERE lr."sourceTable" = 'DOCUMENT_REQUEST'
          AND NOT EXISTS (SELECT 1 FROM "DocumentRequest" t WHERE t.id = lr."sourceId")`,
    );
  }

  // ---- V2 artifacts, memory, checkpoints ------------------------------------------------------

  /** Order-independent fingerprint of every V2 AssessmentArtifact row (must not change). */
  async v2ArtifactFingerprint(): Promise<{ rows: number; digest: string }> {
    const row = await this.one<{ n: number; digest: string }>(
      `SELECT count(*)::int AS n,
              ${PAYLOAD_SHA256_SQL(`coalesce(jsonb_agg(to_jsonb(a) ORDER BY a."artifactId"), '[]'::jsonb)`)} AS digest
         FROM "AssessmentArtifact" a`,
    );
    return { rows: Number(row?.n ?? 0), digest: row?.digest ?? "" };
  }

  /** LangGraph shared-learning store (if the deployment created it) must start empty. */
  async sharedLearningStoreRows(): Promise<number | null> {
    const exists = await this.one<{ present: boolean }>(
      `SELECT to_regclass('public.store') IS NOT NULL AS present`,
    );
    if (!exists?.present) return null;
    return this.count(`SELECT count(*)::int AS n FROM public.store`);
  }

  /** Random-but-reproducible sample of archived rows for an independent deep comparison. */
  sampleArchivedIds(source: LegacyArchiveSource, seed: string, size: number) {
    return this.rows<{ sourceId: string }>(
      `SELECT "sourceId" FROM "LegacyArchiveRecord" WHERE "sourceTable" = $1::"LegacyArchiveSource"
        ORDER BY md5("sourceId" || $2) LIMIT $3`,
      source,
      seed,
      size,
    );
  }

  /** Stored jsonb text and the hash recorded for it, so an independent implementation can re-hash. */
  archivedRecord(source: LegacyArchiveSource, sourceId: string) {
    return this.one<{ text: string; sha256: string } | undefined>(
      `SELECT payload::text AS text, "payloadSha256" AS sha256 FROM "LegacyArchiveRecord"
        WHERE "sourceTable" = $1::"LegacyArchiveSource" AND "sourceId" = $2`,
      source,
      sourceId,
    );
  }

  livePayload(rule: SqlArchiveSource, sourceId: string) {
    return this.one<{ payload: unknown } | undefined>(
      `SELECT to_jsonb(t) AS payload FROM ${rule.from} WHERE ${rule.idExpr} = $1 ${rule.where ? `AND ${rule.where}` : ""}`,
      sourceId,
    );
  }

  sqlSources(): readonly SqlArchiveSource[] {
    return SQL_ARCHIVE_SOURCES;
  }

  /**
   * Accepted V2 writes since the restore point was recorded. Any non-zero value means restoring the
   * snapshot would silently discard accepted V2 work, so the rollback boundary must already be closed.
   * Backfill-created rows (PREPARING state, API-actor events) are migration writes, not V2 work.
   */
  async v2AcceptedWritesSince(since: Date) {
    const row = await this.one<Record<string, number>>(
      `SELECT (SELECT count(*)::int FROM "AssessmentRuleDecision" WHERE "createdAt" > $1) AS decisions,
              (SELECT count(*)::int FROM "AssessmentEvidence" WHERE "createdAt" > $1) AS evidence,
              (SELECT count(*)::int FROM "AssessmentCaseFact" WHERE "createdAt" > $1) AS facts,
              (SELECT count(*)::int FROM "AssessmentHumanRequest" WHERE "createdAt" > $1) AS human_requests,
              (SELECT count(*)::int FROM "AssessmentArtifact" WHERE "createdAt" > $1) AS artifacts,
              (SELECT count(*)::int FROM "AssessmentEvent" WHERE "timestamp" > $1 AND "actorType" <> 'API') AS root_events,
              (SELECT count(*)::int FROM "Assessment" a WHERE a."createdAt" > ($1::timestamptz AT TIME ZONE 'UTC')
                  AND a."lifecycleState" IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM "LegacyAssessmentArchive" s WHERE s."assessmentId" = a.id)) AS native_assessments,
              (SELECT count(*)::int FROM "OutboxMessage" WHERE "publishedAt" > $1) AS published_outbox`,
      since,
    );
    const breakdown = Object.fromEntries(
      Object.entries(row ?? {}).map(([key, value]) => [key, Number(value)]),
    );
    return {
      breakdown,
      total: Object.values(breakdown).reduce((sum, value) => sum + value, 0),
    };
  }

  tenantFkFailures() {
    return this.count(
      `SELECT count(*)::int AS n FROM "LegacyArchiveRecord" lr JOIN "Assessment" a ON a.id = lr."assessmentId"
        WHERE lr."sourceTable" = 'ASSESSMENT' AND lr."sourceId" <> a.id`,
    );
  }
}
