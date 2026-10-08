import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ARTIFACT_KINDS,
  ASSESSMENT_ROOT_COMMAND_TYPES,
} from "@lcsp/contracts/assessment-domain";
import {
  LEGACY_ASSESSMENT_DISPOSITIONS,
  LEGACY_MIGRATION_RUN_KINDS,
  LEGACY_REEVALUATION_MODES,
  type LegacyReevaluationMode,
} from "@lcsp/contracts/legacy-migration";
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { NOT_V2_ROOT_TURN } from "./legacy-archive-registry.js";
import type {
  CanaryEvidence,
  CanonicalLoad,
  ReevaluationFacts,
} from "../../domain/legacy-reevaluation.js";

const IN_FLIGHT = `'${ASSESSMENT_LIFECYCLE_STATES.ACTIVE}', '${ASSESSMENT_LIFECYCLE_STATES.FINALIZING}'`;
const MIGRATION_RUN_KINDS = `'${LEGACY_MIGRATION_RUN_KINDS.REHEARSAL}', '${LEGACY_MIGRATION_RUN_KINDS.CUTOVER}'`;
/** Migration rows are history; only rows created after the first migration run began are "new". */
const SINCE_MIGRATION = `(SELECT min("startedAt") AT TIME ZONE 'UTC' FROM "LegacyMigrationRun" WHERE kind IN (${MIGRATION_RUN_KINDS}))`;

export type CohortMember = ReevaluationFacts & {
  archivedAt: Date;
  ledger: {
    runId: string;
    mode: LegacyReevaluationMode;
    startedBy: string;
    startedAt: Date;
  } | null;
};

/** Canary evidence readable per assessment; V1-authority facts are global and added by the service. */
export type CanaryRows = Omit<CanaryEvidence, "v1Authority">;

export type ObservedRoutes = {
  policies: {
    role: string;
    provider: string;
    model: string;
    policyVersion: string;
  }[];
  usage: {
    provider: string;
    model: string;
    invocations: number;
    assessments: number;
  }[];
};

type Client = Prisma.TransactionClient | PrismaService;

/** SQL for the explicit re-evaluation phase. Fixed literals only; values are always bound. */
@Injectable()
export class LegacyReevaluationRepository {
  constructor(private readonly prisma: PrismaService) {}

  private rows<T>(client: Client, sql: string, ...params: unknown[]) {
    return client.$queryRawUnsafe<T[]>(sql, ...params);
  }

  /**
   * Every assessment the migration backfilled, in a tenant-fair order (each tenant's first assessment,
   * then each tenant's second, ...), with the facts eligibility and state derivation need.
   */
  async cohort(
    assessmentIds?: readonly string[],
    client: Client = this.prisma,
  ): Promise<CohortMember[]> {
    const rows = await this.rows<{
      id: string;
      ownerId: string;
      lifecycle: string | null;
      claimed: boolean | null;
      execution: string | null;
      pinned: boolean;
      snapshot_ok: boolean | null;
      connection_ok: boolean | null;
      coverage_ok: boolean | null;
      archivedAt: Date;
      ledger_run: string | null;
      ledger_mode: LegacyReevaluationMode | null;
      ledger_by: string | null;
      ledger_at: Date | null;
    }>(
      client,
      `SELECT s."assessmentId" AS id, s."ownerId", a."lifecycleState"::text AS lifecycle,
              (r."startedAt" IS NOT NULL) AS claimed, r."executionState"::text AS execution,
              (c."repositorySnapshotId" IS NOT NULL) AS pinned,
              (rs.id IS NOT NULL AND rs.status::text = 'READY' AND rs."commitSha" ~ '^[0-9a-fA-F]{40,64}$'
                 AND lower(rs."commitSha") = c."repositoryCommit") AS snapshot_ok,
              (rc.status::text = 'ACTIVE') AS connection_ok,
              (c."legalPortfolioVersionId" IS NOT NULL
                 AND (SELECT count(*) FROM "EngineeringRule" er WHERE er."portfolioVersionId" = c."legalPortfolioVersionId") > 0
                 AND (SELECT count(*) FROM "AssessmentDecisionCoverage" dc WHERE dc."assessmentId" = s."assessmentId")
                   = (SELECT count(*) FROM "EngineeringRule" er WHERE er."portfolioVersionId" = c."legalPortfolioVersionId")) AS coverage_ok,
              s."archivedAt", l."runId" AS ledger_run, l.mode::text AS ledger_mode,
              l."startedBy" AS ledger_by, l."startedAt" AS ledger_at
         FROM "LegacyAssessmentArchive" s
         JOIN "Assessment" a ON a.id = s."assessmentId"
         LEFT JOIN "AssessmentRuntime" r ON r."assessmentId" = a.id
         LEFT JOIN "AssessmentCase" c ON c."assessmentId" = a.id
         LEFT JOIN "RepositorySnapshot" rs ON rs.id = c."repositorySnapshotId"
         LEFT JOIN "RepositoryConnection" rc ON rc.id = rs."connectionId"
         LEFT JOIN "LegacyReevaluation" l ON l."assessmentId" = a.id
        WHERE s.disposition = '${LEGACY_ASSESSMENT_DISPOSITIONS.BACKFILLED_NON_TERMINAL}'
          ${assessmentIds ? `AND s."assessmentId" = ANY($1::text[])` : ""}
        ORDER BY row_number() OVER (PARTITION BY s."ownerId" ORDER BY s."archivedAt", s."assessmentId"),
                 s."ownerId", s."archivedAt", s."assessmentId"`,
      ...(assessmentIds ? [assessmentIds] : []),
    );
    return rows.map((row) => ({
      assessmentId: row.id,
      ownerId: row.ownerId,
      lifecycleState: row.lifecycle,
      rootClaimed: row.claimed === true,
      executionState: row.execution,
      hasSnapshotPin: row.pinned === true,
      snapshotUsable: row.snapshot_ok === true,
      connectionActive: row.connection_ok === true,
      coverageComplete: row.coverage_ok === true,
      ledgerMode: row.ledger_mode,
      archivedAt: row.archivedAt,
      ledger:
        row.ledger_run && row.ledger_mode && row.ledger_by && row.ledger_at
          ? {
              runId: row.ledger_run,
              mode: row.ledger_mode,
              startedBy: row.ledger_by,
              startedAt: row.ledger_at,
            }
          : null,
    }));
  }

  /**
   * ACTIVE/FINALIZING assessments (whatever started them: customers count against the same
   * provider limits), excluding terminal FAILED executions, and unclaimed ACTIVE ones.
   */
  async load(client: Client = this.prisma) {
    const rows = await this.rows<{
      ownerId: string;
      in_flight: number;
      queued: number;
    }>(
      client,
      `SELECT a."ownerId",
              count(*)::int AS in_flight,
              count(*) FILTER (WHERE a."lifecycleState"::text = '${ASSESSMENT_LIFECYCLE_STATES.ACTIVE}' AND r."startedAt" IS NULL)::int AS queued
         FROM "Assessment" a JOIN "AssessmentRuntime" r ON r."assessmentId" = a.id
        WHERE a."lifecycleState"::text IN (${IN_FLIGHT})
          AND r."executionState"::text IS DISTINCT FROM '${AGENT_EXECUTION_STATES.FAILED}'
        GROUP BY a."ownerId"`,
    );
    const byTenant = new Map(rows.map((row) => [row.ownerId, row.in_flight]));
    return {
      inFlight: rows.reduce((total, row) => total + Number(row.in_flight), 0),
      queued: rows.reduce((total, row) => total + Number(row.queued), 0),
      byTenant,
    };
  }

  /** The canonical load as seen by one candidate, read inside the transaction that starts it. */
  async loadForTenant(
    tx: Prisma.TransactionClient,
    ownerId: string,
  ): Promise<CanonicalLoad> {
    const load = await this.load(tx);
    return {
      inFlight: load.inFlight,
      queued: load.queued,
      inFlightForTenant: load.byTenant.get(ownerId) ?? 0,
    };
  }

  /** Serializes every start in the database: caps stay exact with concurrent operators. */
  async lockStarts(tx: Prisma.TransactionClient): Promise<void> {
    // Cast: Prisma cannot deserialize the function's `void` result.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('lcsp:legacy-reevaluation', 0))::text AS locked`;
  }

  /** Locks the assessment row; true only while it is still PREPARING (nobody started it meanwhile). */
  async lockPreparing(
    tx: Prisma.TransactionClient,
    assessmentId: string,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Assessment"
       WHERE id = ${assessmentId} AND "lifecycleState"::text = ${ASSESSMENT_LIFECYCLE_STATES.PREPARING}
         FOR UPDATE`;
    return rows.length === 1;
  }

  async pinnedSnapshotId(
    tx: Prisma.TransactionClient,
    assessmentId: string,
  ): Promise<string | null> {
    const row = await tx.assessmentCase.findUnique({
      where: { assessmentId },
      select: { repositorySnapshotId: true },
    });
    return row?.repositorySnapshotId ?? null;
  }

  /** The id of the single `:start` Root command of an assessment (deterministic from its key). */
  async rootCommandId(
    tx: Prisma.TransactionClient,
    assessmentId: string,
  ): Promise<string | null> {
    const root = ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED;
    const [row] = await this.rows<{ id: string }>(
      tx,
      `SELECT id FROM "OutboxMessage"
        WHERE "aggregateId" = $1 AND "eventType" = $2 AND payload ->> 'idempotencyKey' = $3`,
      assessmentId,
      root,
      `${assessmentId}:${root}:start`,
    );
    return row?.id ?? null;
  }

  /** The routes the model providers are known to serve: policy snapshots and recent usage. */
  async observedRoutes(): Promise<ObservedRoutes> {
    const policies = await this.rows<ObservedRoutes["policies"][number]>(
      this.prisma,
      `SELECT DISTINCT ON (role) role, provider, model, "policyVersion"
         FROM "RuntimeModelPolicySnapshot" ORDER BY role, "effectiveAt" DESC`,
    );
    const usage = await this.rows<ObservedRoutes["usage"][number]>(
      this.prisma,
      `SELECT provider, model, count(*)::int AS invocations, count(DISTINCT "assessmentId")::int AS assessments
         FROM "LlmUsageEvent"
        WHERE "assessmentId" IS NOT NULL AND "createdAt" > now() - interval '30 days'
        GROUP BY 1, 2 ORDER BY invocations DESC LIMIT 20`,
    );
    return { policies, usage };
  }

  async recordRunResult(
    runId: string,
    result: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "LegacyMigrationRun"
         SET "phaseResults" = jsonb_build_object('REEVALUATE', ${JSON.stringify(result)}::jsonb)
       WHERE id = ${runId}::uuid`;
  }

  /** Model routes the operator declared when starting any canary (kept in the run's parameters). */
  async canaryRoutes(): Promise<string[]> {
    const rows = await this.rows<{ route: string }>(
      this.prisma,
      `SELECT DISTINCT jsonb_array_elements_text(r.parameters -> 'modelRoutes') AS route
         FROM "LegacyMigrationRun" r
         JOIN "LegacyReevaluation" l ON l."runId" = r.id AND l.mode::text = '${LEGACY_REEVALUATION_MODES.CANARY}'`,
    );
    return rows.map((row) => row.route);
  }

  /** Evidence for the canary checks, read from canonical state only. */
  async canaryEvidence(assessmentId: string): Promise<CanaryRows | null> {
    const [head] = await this.rows<{
      ownerId: string;
      lifecycle: string | null;
      thread_id: string | null;
      checkpoint_id: string | null;
      thread_rows: number;
      summary_thread: string | null;
      reuses_v1: boolean;
    }>(
      this.prisma,
      `SELECT a."ownerId", a."lifecycleState"::text AS lifecycle,
              r."threadId"::text AS thread_id, r."checkpointId" AS checkpoint_id,
              (SELECT count(*)::int FROM "AssessmentRuntime" x WHERE x."threadId" = r."threadId") AS thread_rows,
              s."v2ThreadId"::text AS summary_thread,
              EXISTS (SELECT 1 FROM "AssessmentRuntimeTurn" t WHERE t."threadId" = r."threadId"::text AND ${NOT_V2_ROOT_TURN}) AS reuses_v1
         FROM "Assessment" a
         LEFT JOIN "AssessmentRuntime" r ON r."assessmentId" = a.id
         LEFT JOIN "LegacyAssessmentArchive" s ON s."assessmentId" = a.id
        WHERE a.id = $1`,
      assessmentId,
    );
    if (!head) return null;

    const [events] = await this.rows<{
      root_events: number;
      wrong_thread: number;
      contiguous: boolean;
    }>(
      this.prisma,
      `SELECT count(*) FILTER (WHERE e."actorType"::text <> 'API')::int AS root_events,
              count(*) FILTER (WHERE e."threadId" <> r."threadId")::int AS wrong_thread,
              (coalesce(max(e.sequence), 0) = count(*)) AS contiguous
         FROM "AssessmentEvent" e JOIN "AssessmentRuntime" r ON r."assessmentId" = e."assessmentId"
        WHERE e."assessmentId" = $1`,
      assessmentId,
    );
    const [usage] = await this.rows<{
      events: number;
      wrong_owner: number;
      charged: number;
      with_reservation: number;
    }>(
      this.prisma,
      `SELECT count(*)::int AS events,
              count(*) FILTER (WHERE x."userId" <> a."ownerId")::int AS wrong_owner,
              count(*) FILTER (WHERE coalesce(x."chargedCredits", 0) <> 0)::int AS charged,
              count(*) FILTER (WHERE x."reservationId" IS NOT NULL)::int AS with_reservation
         FROM "LlmUsageEvent" x JOIN "Assessment" a ON a.id = x."assessmentId"
        WHERE x."assessmentId" = $1`,
      assessmentId,
    );
    const routes = await this.rows<{ provider: string; model: string }>(
      this.prisma,
      `SELECT DISTINCT provider, model FROM "LlmUsageEvent" WHERE "assessmentId" = $1`,
      assessmentId,
    );
    const [reservations] = await this.rows<{ n: number }>(
      this.prisma,
      `SELECT count(*)::int AS n FROM "BillingReservation"
        WHERE "assessmentId" = $1 AND "createdAt" >= ${SINCE_MIGRATION}`,
      assessmentId,
    );
    const [coverage] = await this.rows<{
      total: number;
      pending: number;
      resolved_without_decision: number;
    }>(
      this.prisma,
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE "resolutionState"::text = 'PENDING')::int AS pending,
              count(*) FILTER (WHERE "resolutionState"::text = 'RESOLVED' AND "currentDecisionId" IS NULL)::int AS resolved_without_decision
         FROM "AssessmentDecisionCoverage" WHERE "assessmentId" = $1`,
      assessmentId,
    );
    const [artifacts] = await this.rows<{
      final_reports: number;
      unsealed: number;
    }>(
      this.prisma,
      `SELECT count(*) FILTER (WHERE kind::text = '${ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT}')::int AS final_reports,
              count(*) FILTER (WHERE kind::text = '${ASSESSMENT_ARTIFACT_KINDS.FINAL_REPORT}'
                AND ("contentSha256" IS NULL OR "storageRef" IS NULL OR "lifecycleState"::text <> 'ACTIVE'))::int AS unsealed
         FROM "AssessmentArtifact" WHERE "assessmentId" = $1`,
      assessmentId,
    );
    let checkpointerHasThread: boolean | null = null;
    const [checkpointer] = await this.rows<{ present: boolean }>(
      this.prisma,
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'checkpoints' AND column_name = 'thread_id') AS present`,
    );
    if (checkpointer?.present && head.thread_id) {
      const [row] = await this.rows<{ n: number }>(
        this.prisma,
        `SELECT count(*)::int AS n FROM public.checkpoints WHERE thread_id = $1`,
        head.thread_id,
      );
      checkpointerHasThread = Number(row?.n ?? 0) > 0;
    }

    return {
      assessmentId,
      ownerId: head.ownerId,
      lifecycleState: head.lifecycle,
      runtime: head.thread_id
        ? {
            threadId: head.thread_id,
            threadRows: Number(head.thread_rows),
            summaryThreadId: head.summary_thread,
            reusesV1Thread: head.reuses_v1,
            checkpointId: head.checkpoint_id,
          }
        : null,
      checkpointerHasThread,
      events: {
        rootEvents: Number(events?.root_events ?? 0),
        contiguous: events?.contiguous ?? true,
        wrongThread: Number(events?.wrong_thread ?? 0),
      },
      usage: {
        events: Number(usage?.events ?? 0),
        routes,
        wrongOwner: Number(usage?.wrong_owner ?? 0),
        charged: Number(usage?.charged ?? 0),
        withReservation: Number(usage?.with_reservation ?? 0),
      },
      reservations: Number(reservations?.n ?? 0),
      coverage: {
        total: Number(coverage?.total ?? 0),
        pending: Number(coverage?.pending ?? 0),
        resolvedWithoutDecision: Number(
          coverage?.resolved_without_decision ?? 0,
        ),
      },
      artifacts: {
        finalReports: Number(artifacts?.final_reports ?? 0),
        unsealed: Number(artifacts?.unsealed ?? 0),
      },
    };
  }
}
