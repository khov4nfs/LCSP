import {
  LEGACY_ASSESSMENT_DISPOSITIONS,
  type LEGACY_MIGRATION_RUN_STATUSES,
  LEGACY_TERMINAL_ASSESSMENT_STATUSES,
  type LegacyArchiveSource,
  type LegacyArtifactReconciliationClass,
  type LegacyArtifactReconciliationReason,
  type LegacyMigrationPhase,
  type LegacyMigrationRunKind,
} from "@lcsp/contracts/legacy-migration";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import {
  ARCHIVE_RECORD_ID_SQL,
  closureUpdateSql,
  IN_FLIGHT_CLOSURE_RULES,
  PAYLOAD_SHA256_SQL,
  type InFlightClosureRule,
  type SqlArchiveSource,
} from "./legacy-archive-registry.js";

type Client = Prisma.TransactionClient | PrismaService;

export type CancelledOutboxMessage = {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  previousStatus: string;
};

const TERMINAL_STATUS_SQL = Object.values(LEGACY_TERMINAL_ASSESSMENT_STATUSES)
  .map((status) => `'${status}'`)
  .join(", ");

/** Single place that talks SQL for the W6 archive. Fixed literals only; values are bound. */
@Injectable()
export class LegacyArchiveRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---- run ledger -------------------------------------------------------------------------

  async createRun(input: {
    kind: LegacyMigrationRunKind;
    toolVersion: string;
    parameters: Prisma.InputJsonValue;
  }): Promise<string> {
    const run = await this.prisma.legacyMigrationRun.create({
      data: {
        kind: input.kind,
        toolVersion: input.toolVersion,
        parameters: input.parameters,
      },
      select: { id: true },
    });
    return run.id;
  }

  findRun(runId: string) {
    return this.prisma.legacyMigrationRun.findUnique({ where: { id: runId } });
  }

  /**
   * The restore point and the rollback boundary belong to the cutover as a whole, not to one run:
   * the effective point is the latest one recorded, and the boundary is closed once ANY run closed it.
   */
  async restoreState() {
    const runs = await this.prisma.legacyMigrationRun.findMany({
      select: {
        id: true,
        restorePointRef: true,
        restorePointDigest: true,
        restorePointRecordedAt: true,
        restorePointVerifiedAt: true,
        restoreBoundaryClosedAt: true,
      },
    });
    const point =
      runs
        .filter((run) => run.restorePointRecordedAt !== null)
        .sort(
          (a, b) =>
            b.restorePointRecordedAt!.getTime() -
            a.restorePointRecordedAt!.getTime(),
        )[0] ?? null;
    const boundaryClosedAt =
      runs
        .flatMap((run) =>
          run.restoreBoundaryClosedAt ? [run.restoreBoundaryClosedAt] : [],
        )
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    return { point, boundaryClosedAt };
  }

  /** Merges one phase result into the ledger so an interrupted run is inspectable and restartable. */
  async recordPhase(
    runId: string,
    phase: LegacyMigrationPhase,
    result: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "LegacyMigrationRun"
         SET "phaseResults" = jsonb_set("phaseResults", ARRAY[${phase}]::text[], ${JSON.stringify(result)}::jsonb, true)
       WHERE id = ${runId}::uuid`;
  }

  async finishRun(
    runId: string,
    status:
      | typeof LEGACY_MIGRATION_RUN_STATUSES.COMPLETED
      | typeof LEGACY_MIGRATION_RUN_STATUSES.FAILED,
  ): Promise<void> {
    await this.prisma.legacyMigrationRun.update({
      where: { id: runId },
      data: { status, completedAt: new Date() },
    });
  }

  // ---- set-based archive ------------------------------------------------------------------

  /** Copies every row of one V1 source; rows already archived are left exactly as they were. */
  async archiveSqlSource(
    client: Client,
    runId: string,
    rule: SqlArchiveSource,
  ): Promise<number> {
    const where = rule.where ? `WHERE ${rule.where}` : "";
    return client.$executeRawUnsafe(
      `INSERT INTO "LegacyArchiveRecord"
         (id, "archiveRunId", "assessmentId", "sourceTable", "sourceId", payload, "payloadSha256")
       SELECT ${ARCHIVE_RECORD_ID_SQL(rule.source, rule.idExpr)}, $1::uuid, ${rule.assessmentExpr},
              '${rule.source}'::"LegacyArchiveSource", ${rule.idExpr}, to_jsonb(t),
              ${PAYLOAD_SHA256_SQL("to_jsonb(t)")}
         FROM ${rule.from} ${where}
       ON CONFLICT ("sourceTable", "sourceId") DO NOTHING`,
      runId,
    );
  }

  /** Closes in-flight V1 work whose original is already archived. Idempotent. */
  closeInFlight(
    client: Client,
    rule: InFlightClosureRule,
    marker: string,
  ): Promise<number> {
    return client.$executeRawUnsafe(closureUpdateSql(rule, marker));
  }

  closureRules(): readonly InFlightClosureRule[] {
    return IN_FLIGHT_CLOSURE_RULES;
  }

  /**
   * Summary row for each terminal V1 assessment. Skipped when one exists, so a second run writes
   * nothing. The digest is computed in the database over this assessment's archive records.
   */
  async archiveTerminalAssessments(
    client: Client,
    runId: string,
  ): Promise<string[]> {
    const rows = await client.$queryRawUnsafe<{ assessmentId: string }[]>(
      `INSERT INTO "LegacyAssessmentArchive"
         ("assessmentId", "ownerId", disposition, "legacyStatus", "legacyCreatedAt", "legacyUpdatedAt",
          "archiveRunId", "recordCount", "payloadDigest")
       SELECT a.id, a."ownerId", '${LEGACY_ASSESSMENT_DISPOSITIONS.ARCHIVED_TERMINAL}'::"LegacyAssessmentDisposition",
              a.status, a."createdAt" AT TIME ZONE 'UTC', a."updatedAt" AT TIME ZONE 'UTC', $1::uuid,
              ${RECORD_COUNT_SQL("a.id")}, ${ASSESSMENT_DIGEST_SQL("a.id")}
         FROM "Assessment" a
        WHERE a.status::text IN (${TERMINAL_STATUS_SQL})
          AND a."lifecycleState" IS NULL
          AND NOT EXISTS (SELECT 1 FROM "LegacyAssessmentArchive" x WHERE x."assessmentId" = a.id)
       RETURNING "assessmentId"`,
      runId,
    );
    return rows.map((row) => row.assessmentId);
  }

  /** Summary row for one backfilled (non-terminal) assessment, written in the backfill transaction. */
  async archiveBackfilledAssessment(
    client: Client,
    input: {
      runId: string;
      assessmentId: string;
      v2ThreadId: string;
      v2LifecycleState: string;
    },
  ): Promise<number> {
    return client.$executeRawUnsafe(
      `INSERT INTO "LegacyAssessmentArchive"
         ("assessmentId", "ownerId", disposition, "legacyStatus", "legacyCreatedAt", "legacyUpdatedAt",
          "v2ThreadId", "v2LifecycleState", "archiveRunId", "recordCount", "payloadDigest")
       SELECT a.id, a."ownerId", '${LEGACY_ASSESSMENT_DISPOSITIONS.BACKFILLED_NON_TERMINAL}'::"LegacyAssessmentDisposition",
              a.status, a."createdAt" AT TIME ZONE 'UTC', a."updatedAt" AT TIME ZONE 'UTC',
              $3::uuid, $4::"AssessmentLifecycleState", $1::uuid,
              ${RECORD_COUNT_SQL("a.id")}, ${ASSESSMENT_DIGEST_SQL("a.id")}
         FROM "Assessment" a
        WHERE a.id = $2
          AND NOT EXISTS (SELECT 1 FROM "LegacyAssessmentArchive" x WHERE x."assessmentId" = a.id)`,
      input.runId,
      input.assessmentId,
      input.v2ThreadId,
      input.v2LifecycleState,
    );
  }

  // ---- outbox cancellation ----------------------------------------------------------------

  /**
   * Cancels one batch of undelivered legacy messages and archives each original in the SAME
   * statement, so a message can never be cancelled without its archived copy.
   */
  async cancelLegacyOutboxBatch(
    client: Client,
    input: {
      runId: string;
      eventTypes: readonly string[];
      marker: string;
      limit: number;
    },
  ): Promise<CancelledOutboxMessage[]> {
    return client.$queryRaw<CancelledOutboxMessage[]>(Prisma.sql`
      WITH target AS (
        SELECT id, status::text AS previous_status FROM "OutboxMessage"
         WHERE status IN ('PENDING', 'FAILED', 'DLQ')
           AND "eventType" = ANY(${input.eventTypes}::text[])
         ORDER BY "createdAt", id
         LIMIT ${input.limit}
           FOR UPDATE SKIP LOCKED
      ), archived AS (
        INSERT INTO "LegacyArchiveRecord"
          (id, "archiveRunId", "assessmentId", "sourceTable", "sourceId", payload, "payloadSha256")
        SELECT ${Prisma.raw(ARCHIVE_RECORD_ID_SQL("OUTBOX_MESSAGE_CANCELLED", "m.id"))}, ${input.runId}::uuid,
               (SELECT a.id FROM "Assessment" a WHERE a.id = m."aggregateId"),
               'OUTBOX_MESSAGE_CANCELLED'::"LegacyArchiveSource", m.id, to_jsonb(m),
               ${Prisma.raw(PAYLOAD_SHA256_SQL("to_jsonb(m)"))}
          FROM "OutboxMessage" m JOIN target USING (id)
        ON CONFLICT ("sourceTable", "sourceId") DO NOTHING
      )
      UPDATE "OutboxMessage" m
         SET status = 'CANCELLED', "nextAttemptAt" = NULL, "errorMessage" = ${input.marker}
        FROM target
       WHERE m.id = target.id
      RETURNING m.id, m."eventType", m."aggregateType"::text AS "aggregateType",
                m."aggregateId", target.previous_status AS "previousStatus"`);
  }

  // ---- filesystem artifact inventory ----------------------------------------------------------

  /** Inventories one operator-supplied file (cache/bundle export): path, size and real sha256. */
  async archiveFilesystemArtifact(
    client: Client,
    input: {
      runId: string;
      sourceId: string;
      payload: Record<string, unknown>;
    },
  ): Promise<number> {
    return client.$executeRawUnsafe(
      `INSERT INTO "LegacyArchiveRecord"
         (id, "archiveRunId", "assessmentId", "sourceTable", "sourceId", payload, "payloadSha256")
       SELECT ${ARCHIVE_RECORD_ID_SQL("FILESYSTEM_ARTIFACT", "$2::text")}, $1::uuid, NULL,
              'FILESYSTEM_ARTIFACT'::"LegacyArchiveSource", $2::text, $3::jsonb,
              ${PAYLOAD_SHA256_SQL("$3::jsonb")}
       ON CONFLICT ("sourceTable", "sourceId") DO NOTHING`,
      input.runId,
      input.sourceId,
      JSON.stringify(input.payload),
    );
  }

  // ---- report-related rows (reconciliation known before the insert) -------------------------

  /** Ids of report-related rows that do not yet have an archive record (restartable work list). */
  async listUnarchivedIds(
    client: Client,
    source: Extract<
      LegacyArchiveSource,
      "DOCUMENT_REQUEST" | "READINESS_EXPORT"
    >,
    limit: number,
  ): Promise<string[]> {
    const table =
      source === "DOCUMENT_REQUEST" ? `"DocumentRequest"` : `"ReadinessExport"`;
    const rows = await client.$queryRawUnsafe<{ id: string }[]>(
      `SELECT t.id FROM ${table} t
        WHERE NOT EXISTS (
          SELECT 1 FROM "LegacyArchiveRecord" lr
           WHERE lr."sourceTable" = '${source}'::"LegacyArchiveSource" AND lr."sourceId" = t.id)
        ORDER BY t.id LIMIT $1`,
      limit,
    );
    return rows.map((row) => row.id);
  }

  /** Inserts the exact row copy together with its (already determined) reconciliation outcome. */
  async insertReportRecord(
    client: Client,
    input: {
      runId: string;
      source: Extract<
        LegacyArchiveSource,
        "DOCUMENT_REQUEST" | "READINESS_EXPORT"
      >;
      sourceId: string;
      reconciliationClass: LegacyArtifactReconciliationClass;
      reconciliationReason: LegacyArtifactReconciliationReason;
    },
  ): Promise<string | null> {
    const table =
      input.source === "DOCUMENT_REQUEST"
        ? `"DocumentRequest"`
        : `"ReadinessExport"`;
    const rows = await client.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO "LegacyArchiveRecord"
         (id, "archiveRunId", "assessmentId", "sourceTable", "sourceId", payload, "payloadSha256",
          "reconciliationClass", "reconciliationReason")
       SELECT ${ARCHIVE_RECORD_ID_SQL(input.source, "t.id")}, $1::uuid, t."assessmentId",
              '${input.source}'::"LegacyArchiveSource", t.id, to_jsonb(t), ${PAYLOAD_SHA256_SQL("to_jsonb(t)")},
              $3::"LegacyArtifactReconciliationClass", $4::"LegacyArtifactReconciliationReason"
         FROM ${table} t WHERE t.id = $2
       ON CONFLICT ("sourceTable", "sourceId") DO NOTHING
       RETURNING id`,
      input.runId,
      input.sourceId,
      input.reconciliationClass,
      input.reconciliationReason,
    );
    return rows[0]?.id ?? null;
  }

  async insertBlob(
    client: Client,
    input: {
      recordId: string;
      contentSha256: string;
      sizeBytes: number;
      storageRef: string;
      mediaType: string | null;
    },
  ): Promise<void> {
    await client.legacyArchiveBlob.create({ data: input });
  }
}

const RECORD_COUNT_SQL = (assessmentExpr: string): string =>
  `(SELECT count(*)::int FROM "LegacyArchiveRecord" r WHERE r."assessmentId" = ${assessmentExpr})`;

/** sha256 over the ordered `(sourceTable:sourceId:payloadSha256)` lines; byte-order collation. */
const ASSESSMENT_DIGEST_SQL = (assessmentExpr: string): string =>
  `encode(sha256(convert_to(coalesce((
     SELECT string_agg(r."sourceTable"::text || ':' || r."sourceId" || ':' || r."payloadSha256", E'\\n'
                       ORDER BY r."sourceTable"::text COLLATE "C", r."sourceId" COLLATE "C")
       FROM "LegacyArchiveRecord" r WHERE r."assessmentId" = ${assessmentExpr}), ''), 'UTF8')), 'hex')`;
