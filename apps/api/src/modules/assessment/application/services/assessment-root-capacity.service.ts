import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { Injectable, HttpStatus } from "@nestjs/common";
import {
  Prisma,
  type AssessmentRootCapacity,
  type AssessmentRootExecutionSlot,
} from "@prisma/client";
import {
  AGENT_EXECUTION_STATES as Executions,
  ASSESSMENT_LIFECYCLE_STATES as Lifecycles,
  BLOCKER_REASONS,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
} from "@lcsp/contracts/assessment";
import { ASSESSMENT_RUNTIME_CONTROL_STATES as Controls } from "@lcsp/contracts/evidence";
import { OUTBOX_STATUSES } from "@lcsp/contracts/outbox";
import {
  ROOT_CAPACITY_ID,
  ROOT_CAPACITY_REASONS as Reasons,
  ROOT_CAPACITY_ERROR_CODES as Codes,
  ROOT_CAPACITY_METRIC_SOURCES as Sources,
  ASSESSMENT_ROOT_COMMAND_TYPES,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  rootCapacityPolicySchema,
  rootCapacityRuntimeMetricsSchema,
  type RootCapacityDatabaseMetrics,
  type RootCapacityRuntimeMetrics,
  type RootCapacityReason,
  type rootCapacityControlSchema,
  type rootCapacityRegisterSchema,
  type rootCapacityReleaseSchema,
  type rootCapacityReportSchema,
  type rootCapacityReserveSchema,
} from "@lcsp/contracts/assessment-domain";
import type { z } from "zod";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { decideRootCapacity } from "./root-capacity-policy.js";

type Server = z.infer<typeof rootCapacityRegisterSchema>;
interface WaitingRoot {
  assessmentId: string;
  requestedAt: Date;
  commandId: string;
  commandKey: string;
}

/** API/PostgreSQL owns physical admission; lease expiry never releases a slot. */
@Injectable()
export class AssessmentRootCapacityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Business purpose: Serialize Root admission and controller decisions across all API replicas.
   * Business rules:
   * - One permanent singleton row is the lock authority; environment policy seeds it only once.
   * Execution flow:
   * 1. Create the control row if absent and lock the committed row for this transaction.
   * Failure cases:
   * - Invalid initial policy or database errors abort the transaction without admitting work.
   * Side effects:
   * - May initialize controller state; holds a PostgreSQL row lock until transaction completion.
   */
  private async lock(
    tx: Prisma.TransactionClient,
  ): Promise<AssessmentRootCapacity> {
    const exists = await tx.assessmentRootCapacity.findUnique({
      where: { id: ROOT_CAPACITY_ID },
    });
    if (!exists) {
      const policy = rootCapacityPolicySchema.parse(
        JSON.parse(process.env.LCSP_ROOT_CAPACITY_POLICY ?? "{}"),
      );
      await tx.assessmentRootCapacity.upsert({
        where: { id: ROOT_CAPACITY_ID },
        update: {},
        create: {
          id: ROOT_CAPACITY_ID,
          desired: policy.initial,
          effective: 0,
          policy: policy,
          reason: Reasons.initial,
        },
      });
    }
    const [row] = await tx.$queryRaw<AssessmentRootCapacity[]>`
      SELECT * FROM "AssessmentRootCapacity" WHERE "id" = ${ROOT_CAPACITY_ID} FOR UPDATE`;
    return row;
  }

  /**
   * Business purpose: Issue the durable comparison version for an exclusive server's registration handshake.
   * Business rules:
   * - Reading a version grants no execution authority; registration must atomically compare it.
   * Execution flow:
   * 1. Read the serialized current control version and pinned host/incarnation.
   * Failure cases:
   * - Database failure prevents registration and new admission.
   * Side effects:
   * - Read-only after first-use singleton initialization; exposes no customer data.
   */
  async registration() {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx);
      return {
        version: row.version,
        hostId: row.hostId,
        incarnationId: row.incarnationId,
      };
    });
  }

  /**
   * Business purpose: Fence a server operation to the registered host and live incarnation.
   * Business rules:
   * - A heartbeat timeout never authorizes another host or a stale incarnation.
   * Execution flow:
   * 1. Compare both server identities against durable controller ownership.
   * Failure cases:
   * - Mismatches return a stale-owner problem before any reservation or release.
   * Side effects:
   * - Pure validation; no database or Assessment changes.
   */
  private assertServer(
    row: AssessmentRootCapacity,
    server: Pick<Server, "hostId" | "incarnationId">,
  ): void {
    if (
      row.hostId !== server.hostId ||
      row.incarnationId !== server.incarnationId
    ) {
      throw problemException(Codes.stale, server.incarnationId, {
        status: HttpStatus.CONFLICT,
        meta: {
          reason: row.hostId !== server.hostId ? Reasons.host : Reasons.fenced,
        },
      });
    }
  }

  /**
   * Business purpose: Recover physical reservations after a proven local server restart.
   * Business rules:
   * - The caller holds the exclusive host process lock; cross-host takeover is forbidden.
   * - Persisted live runs retain their slots; only absent, now quiescent runs are released.
   * Execution flow:
   * 1. Lock the global authority and verify the pinned server host.
   * 2. Rebind retained reservations, reconcile absent runs and fence the previous incarnation.
   * Failure cases:
   * - Host mismatch or duplicate/inconsistent live IDs rejects registration atomically.
   * Side effects:
   * - Updates server ownership, physical reservations and a sanitized recovery audit receipt.
   */
  async register(input: Server) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx);
      if (row.hostId && row.hostId !== input.hostId) {
        throw problemException(Codes.stale, input.incarnationId, {
          status: HttpStatus.CONFLICT,
          meta: { reason: Reasons.host },
        });
      }
      if (row.incarnationId === input.incarnationId)
        return { version: row.version };
      if (row.version !== input.expectedVersion) {
        throw problemException(Codes.conflict, input.incarnationId, {
          status: HttpStatus.CONFLICT,
        });
      }
      const recovered = await this.reconcile(tx, input.liveRunIds);
      await tx.assessmentRootExecutionSlot.updateMany({
        where: { releasedAt: null, runId: { in: input.liveRunIds } },
        data: { incarnationId: input.incarnationId },
      });
      const next = await tx.assessmentRootCapacity.update({
        where: { id: row.id },
        data: {
          hostId: input.hostId,
          incarnationId: input.incarnationId,
          effective: 0,
          reportedAt: null,
          runtimeMetrics: Prisma.DbNull,
          reason: Reasons.initial,
          recoveredSlots: { increment: recovered },
          version: { increment: 1 },
        },
      });
      await this.receipt(tx, row, next);
      return { version: next.version };
    });
  }

  /**
   * Business purpose: Return fair eligible demand from canonical durable Root commands.
   * Business rules:
   * - A pending customer outside broker prefetch remains visible; old commands do not restart completed turns.
   * - Owners rotate by last admission, then each owner's oldest request, including supported Continue.
   * Execution flow:
   * 1. Select current eligible Root commands, excluding physically reserved Assessments.
   * 2. Order owners by their last admitted slot and requests by durable command age.
   * Failure cases:
   * - No eligible demand returns an empty list; SQL failures propagate without granting admission.
   * Side effects:
   * - Read-only query; no legal or workflow state is rewritten.
   */
  private async waiting(tx: Prisma.TransactionClient): Promise<WaitingRoot[]> {
    return tx.$queryRaw<WaitingRoot[]>(Prisma.sql`
      SELECT a."id" AS "assessmentId", demand."requestedAt", command."id" AS "commandId",
        command."payload"->>'idempotencyKey' AS "commandKey"
      FROM "AssessmentRootAdmissionRequest" demand
      JOIN "Assessment" a ON a."id" = demand."assessmentId"
      JOIN "OutboxMessage" command ON command."id" = demand."commandId"
      JOIN "AssessmentRuntime" r ON r."assessmentId" = a."id"
      LEFT JOIN "AssessmentRuntimeTurn" t ON t."id" = r."currentExecutionId"::text
      LEFT JOIN LATERAL (
        SELECT max(s."admittedAt") AS last_admitted
        FROM "AssessmentRootExecutionSlot" s JOIN "Assessment" previous ON previous."id" = s."assessmentId"
        WHERE previous."ownerId" = a."ownerId"
      ) owner_history ON true
      WHERE (a."lifecycleState"::text = ${Lifecycles.ACTIVE}
        OR (a."lifecycleState"::text = ${Lifecycles.PAUSED} AND t."state"::text = ${Controls.resumeRequested})
        OR (r."executionState"::text = ${Executions.RUNNING} AND r."leaseExpiresAt" <= (now() AT TIME ZONE 'UTC')
          AND (a."lifecycleState"::text = ${Lifecycles.WAITING_FOR_HUMAN}
            OR (a."lifecycleState"::text = ${Lifecycles.BLOCKED}
              AND a."blockerReason"::text = ${BLOCKER_REASONS.HUMAN_FACT_UNRESOLVABLE}
              AND EXISTS (SELECT 1 FROM "AssessmentHumanRequest" human
                WHERE human."assessmentId" = a."id" AND human."threadId" = r."threadId"
                  AND human."requestId"::text = a."blockerReference"->>'humanResolutionRequestId'
                  AND human."status"::text = ${HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN})))))
        AND demand."admittedRunId" IS NULL AND demand."completedAt" IS NULL
        AND (command."status"::text = ${OUTBOX_STATUSES.published} OR demand."deliveredAt" IS NOT NULL)
        AND command."status"::text NOT IN (${OUTBOX_STATUSES.dlq}, ${OUTBOX_STATUSES.cancelled})
        AND NOT EXISTS (SELECT 1 FROM "OutboxMessage" newer
          WHERE newer."aggregateId" = a."id" AND newer."eventType" = ${ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED}
            AND (newer."createdAt", newer."id") > (command."createdAt", command."id"))
        AND NOT EXISTS (SELECT 1 FROM "AssessmentRootExecutionSlot" s WHERE s."assessmentId" = a."id" AND s."releasedAt" IS NULL)
      ORDER BY owner_history.last_admitted ASC NULLS FIRST, demand."requestedAt", a."id"
      LIMIT 10000`);
  }

  /**
   * Business purpose: Reserve one globally bounded physical Root before the server submits execution.
   * Business rules:
   * - One Assessment has at most one live reservation; retries of the same run ID are idempotent.
   * - Fresh telemetry, global ceiling and owner fairness all precede admission; expired leases retain slots.
   * Execution flow:
   * 1. Lock authority, fence server identity and check an existing reservation.
   * 2. Compare physical occupancy, metric freshness and the oldest fair eligible request.
   * 3. Persist a reservation or a durable deferral count without changing Assessment lifecycle.
   * Failure cases:
   * - Capacity/fairness refusal returns admitted false; stale owners fail without any mutation.
   * Side effects:
   * - Creates one reservation, or increments the operational admission-deferral counter.
   */
  async reserve(input: z.infer<typeof rootCapacityReserveSchema>) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx);
      this.assertServer(row, input);
      const existing = await tx.assessmentRootExecutionSlot.findUnique({
        where: { runId: input.runId },
      });
      if (existing) {
        return {
          admitted:
            existing.releasedAt === null &&
            existing.assessmentId === input.assessmentId &&
            existing.incarnationId === input.incarnationId,
          obsolete: existing.releasedAt !== null,
          reason: Reasons.held,
        };
      }
      const command = await tx.outboxMessage.findFirst({
        where: {
          aggregateId: input.assessmentId,
          eventType: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      if (
        !command ||
        (command.payload as Prisma.JsonObject)?.idempotencyKey !==
          input.commandKey
      ) {
        return { admitted: false, obsolete: true, reason: Reasons.held };
      }
      // Materialize only a real delivered pre-cutover command; new commands
      // already created this bookkeeping in their canonical outbox transaction.
      await tx.assessmentRootAdmissionRequest.upsert({
        where: { commandId: command.id },
        update: {},
        create: {
          commandId: command.id,
          assessmentId: input.assessmentId,
          requestedAt: command.createdAt,
        },
      });
      await tx.assessmentRootAdmissionRequest.updateMany({
        where: { commandId: command.id, deliveredAt: null },
        data: { deliveredAt: new Date() },
      });
      const now = new Date();
      const policy = rootCapacityPolicySchema.parse(row.policy);
      const metrics = rootCapacityRuntimeMetricsSchema.safeParse(
        row.runtimeMetrics,
      );
      const active = await tx.assessmentRootExecutionSlot.count({
        where: { releasedAt: null },
      });
      const held = await tx.assessmentRootExecutionSlot.count({
        where: { assessmentId: input.assessmentId, releasedAt: null },
      });
      const queue = await this.waiting(tx);
      const target = queue.find(
        (item) => item.assessmentId === input.assessmentId,
      );
      if (!held && (!target || target.commandKey !== input.commandKey))
        return { admitted: false, obsolete: true, reason: Reasons.held };
      let reason: RootCapacityReason | null = held ? Reasons.held : null;
      if (
        !reason &&
        (!metrics.success ||
          !row.reportedAt ||
          !row.evaluatedAt ||
          now.getTime() - row.evaluatedAt.getTime() >
            policy.metricTtlSeconds * 1000 ||
          now.getTime() - Date.parse(metrics.data.sampledAt) < -5000 ||
          now.getTime() - Date.parse(metrics.data.sampledAt) >
            policy.metricTtlSeconds * 1000 ||
          now.getTime() - row.reportedAt.getTime() >
            policy.metricTtlSeconds * 1000)
      )
        reason = Reasons.stale;
      if (
        !reason &&
        (policy.emergencyDisabled ||
          metrics.data?.draining ||
          active >= row.effective)
      )
        reason = Reasons.full;
      if (!reason && queue[0]?.assessmentId !== input.assessmentId)
        reason = Reasons.fairness;
      if (reason) {
        await tx.assessmentRootCapacity.update({
          where: { id: row.id },
          data: { admissionDeferrals: { increment: 1 } },
        });
        return { admitted: false, reason };
      }
      await tx.assessmentRootExecutionSlot.create({
        data: {
          runId: input.runId,
          assessmentId: input.assessmentId,
          incarnationId: input.incarnationId,
          requestedAt: queue[0].requestedAt,
          commandId: queue[0].commandId,
        },
      });
      await tx.assessmentRootAdmissionRequest.update({
        where: { commandId: queue[0].commandId },
        data: { admittedRunId: input.runId },
      });
      await tx.assessmentRootCapacity.update({
        where: { id: row.id },
        data: { version: { increment: 1 } },
      });
      return { admitted: true, reason: row.reason };
    });
  }

  /**
   * Business purpose: Bind an API Root lease to the physical native run that reserved its capacity.
   * Business rules:
   * - No caller may bypass global admission or use another Assessment's reservation.
   * Execution flow:
   * 1. Find the live reservation bound to this exact Assessment and transport run ID.
   * 2. Mark its actual Root start while retaining its physical reservation.
   * Failure cases:
   * - Missing, released or stale-incarnation reservations reject the claim.
   * Side effects:
   * - Records the first actual Root start inside the caller's existing lease transaction.
   */
  async bindInTx(
    tx: Prisma.TransactionClient,
    assessmentId: string,
    runId: string | undefined,
    correlationId: string,
  ): Promise<void> {
    const rows = runId
      ? await tx.$queryRaw<Array<{ runId: string }>>`
      SELECT s."runId" FROM "AssessmentRootExecutionSlot" s
      JOIN "AssessmentRootCapacity" c ON c."id" = ${ROOT_CAPACITY_ID} AND c."incarnationId" = s."incarnationId"
      WHERE s."runId" = ${runId}::uuid AND s."assessmentId" = ${assessmentId} AND s."releasedAt" IS NULL
      FOR SHARE OF s`
      : [];
    if (!rows.length) {
      const held = await tx.assessmentRootExecutionSlot.count({
        where: { assessmentId, releasedAt: null },
      });
      throw problemException(
        held
          ? ASSESSMENT_DOMAIN_ERROR_CODES.EXECUTION_LEASE_HELD
          : Codes.unavailable,
        correlationId,
        { status: held ? HttpStatus.CONFLICT : HttpStatus.TOO_MANY_REQUESTS },
      );
    }
    await tx.assessmentRootExecutionSlot.updateMany({
      where: { runId, startedAt: null },
      data: { startedAt: new Date() },
    });
  }

  /**
   * Business purpose: Release capacity only after the owning native execution is quiescent.
   * Business rules:
   * - An old server incarnation cannot release a replacement's reservation; repeated receipts are harmless.
   * Execution flow:
   * 1. Lock/fence the authority and mark this incarnation's exact physical run released.
   * Failure cases:
   * - Stale ownership rejects; lost receipts retain capacity until consistent server reconciliation.
   * Side effects:
   * - Marks one reservation released; never settles usage or changes Assessment state.
   */
  async release(input: z.infer<typeof rootCapacityReleaseSchema>) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx);
      this.assertServer(row, input);
      const slot = await tx.assessmentRootExecutionSlot.findFirst({
        where: {
          runId: input.runId,
          incarnationId: input.incarnationId,
          releasedAt: null,
        },
      });
      if (slot) await this.quiesceInTx(tx, slot);
      return { count: slot ? 1 : 0 };
    });
  }

  /**
   * Business purpose: Recover capacity from lost quiescence receipts using a serialized server snapshot.
   * Business rules:
   * - The server holds its submission lock while reporting every unfinished physical run.
   * Execution flow:
   * 1. Release only reservations absent from the consistent live snapshot.
   * Failure cases:
   * - Database failure retains reservations and is retried by the next report.
   * Side effects:
   * - Marks absent physical reservations released and returns their count.
   */
  private async reconcile(
    tx: Prisma.TransactionClient,
    liveRunIds: string[],
  ): Promise<number> {
    const absent = await tx.assessmentRootExecutionSlot.findMany({
      where: { releasedAt: null, runId: { notIn: liveRunIds } },
    });
    for (const slot of absent) await this.quiesceInTx(tx, slot);
    return absent.length;
  }

  /**
   * Business purpose: Settle physical admission intent only after proven native quiescence.
   * Business rules:
   * - Settled commands, including an acknowledged failed Root outcome, are consumed; unsettled crashes retain broker retry.
   * - Database clock timestamps preserve ordering across API replicas; old receipts cannot reopen a newer reservation.
   * Execution flow:
   * 1. Release the exact live physical slot using the database clock.
   * 2. Complete a settled command, or clear its reservation for the existing durable retry after an unsettled crash.
   * Failure cases:
   * - Duplicate receipts are harmless; transaction failure retains both slot and intent for reconciliation.
   * Side effects:
   * - Updates operational slot/command bookkeeping only; legal state, checkpoints and usage remain unchanged.
   */
  private async quiesceInTx(
    tx: Prisma.TransactionClient,
    slot: AssessmentRootExecutionSlot,
  ): Promise<void> {
    const [released] = await tx.$queryRaw<Array<{ releasedAt: Date }>>`
      UPDATE "AssessmentRootExecutionSlot" SET "releasedAt" = clock_timestamp()
      WHERE "runId" = ${slot.runId}::uuid AND "releasedAt" IS NULL RETURNING "releasedAt"`;
    if (!released) return;
    await tx.assessmentRootCapacity.update({
      where: { id: ROOT_CAPACITY_ID },
      data: { version: { increment: 1 } },
    });
    const runtime = await tx.assessmentRuntime.findUnique({
      where: { assessmentId: slot.assessmentId },
      select: { executionState: true },
    });
    const consumed =
      slot.startedAt !== null &&
      runtime !== null &&
      (
        [
          Executions.SUCCEEDED,
          Executions.FAILED,
          Executions.INTERRUPTED,
          Executions.PAUSED,
          Executions.CANCELLED,
        ] as readonly string[]
      ).includes(runtime.executionState);
    await tx.assessmentRootAdmissionRequest.updateMany({
      where: { commandId: slot.commandId, admittedRunId: slot.runId },
      data: consumed
        ? { completedAt: released.releasedAt }
        : { admittedRunId: null },
    });
  }

  /**
   * Business purpose: Measure demand, DB headroom and governed provider exposure from durable authority.
   * Business rules:
   * - Missing token/cost usage stays unknown; operational output contains aggregate values only.
   * Execution flow:
   * 1. Read fair demand and measured DB query latency/connection utilization.
   * 2. Aggregate physical runs, usage attempts, queue latency and reservation balances.
   * Failure cases:
   * - SQL failures prevent an evaluation; prior work retains its reservations and stale admission fails closed.
   * Side effects:
   * - Read-only database measurements; does not admit model calls, change budgets or settle money.
   */
  private async measurements(
    tx: Prisma.TransactionClient,
    runtime: RootCapacityRuntimeMetrics,
  ): Promise<RootCapacityDatabaseMetrics> {
    const started = performance.now();
    const [connection] = await tx.$queryRaw<
      Array<{ maximum: number; used: number; roots: number }>
    >`
      SELECT current_setting('max_connections')::int AS maximum, count(*)::int AS used,
        count(*) FILTER (WHERE application_name IN ('lcsp-assessment-root-checkpoint', 'lcsp-assessment-root-thread'))::int AS roots
      FROM pg_stat_activity`;
    const dbLatencyMs = performance.now() - started;
    const queue = await this.waiting(tx);
    const rootThreads = await tx.$queryRaw<Array<{ threadId: string }>>`
      SELECT r."threadId"::text FROM "AssessmentRootExecutionSlot" s
      JOIN "AssessmentRuntime" r ON r."assessmentId" = s."assessmentId" WHERE s."releasedAt" IS NULL`;
    const threadHashes = new Set(
      rootThreads.map((r) =>
        createHash("sha256").update(r.threadId).digest("hex").slice(0, 24),
      ),
    );
    const activeSandboxMemoryBytes =
      runtime.sandboxSamples
        ?.filter((s) => s.threadHash && threadHashes.has(s.threadHash))
        .reduce((sum, s) => sum + s.memoryBytes, 0) ?? null;
    const [usage] = await tx.$queryRaw<
      Array<{
        active: number;
        unknown: number;
        requests: number;
        tokens: string | null;
        settled: string | null;
      }>
    >`
      SELECT count(*) FILTER (WHERE "attemptStatus" = 'STARTED')::int AS active,
        count(*) FILTER (WHERE "attemptStatus" = 'OUTCOME_UNKNOWN')::int AS unknown,
        count(*) FILTER (WHERE "createdAt" >= now() - interval '1 minute')::int AS requests,
        CASE WHEN count(*) FILTER (WHERE "occurredAt" >= now() - interval '1 minute' AND "totalTokens" IS NULL) > 0
          THEN NULL ELSE COALESCE(sum("totalTokens") FILTER (WHERE "occurredAt" >= now() - interval '1 minute'), 0)::text END AS tokens,
        CASE WHEN count(*) FILTER (WHERE "attemptStatus" != 'STARTED' AND "chargedCredits" IS NULL) > 0
          THEN NULL ELSE sum("chargedCredits")::text END AS settled
      FROM "LlmUsageEvent" WHERE "createdAt" >= now() - interval '1 hour'
        OR "attemptStatus" IN ('STARTED', 'OUTCOME_UNKNOWN')`;
    const [slots] = await tx.$queryRaw<
      Array<{
        active: number;
        completed: number;
        p50: number | null;
        p95: number | null;
      }>
    >`
      SELECT count(*) FILTER (WHERE "releasedAt" IS NULL)::int AS active,
        count(*) FILTER (WHERE "releasedAt" >= now() - interval '1 minute')::int AS completed,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ("startedAt" - "requestedAt")) * 1000)
          FILTER (WHERE "startedAt" >= now() - interval '1 hour') AS p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM ("startedAt" - "requestedAt")) * 1000)
          FILTER (WHERE "startedAt" >= now() - interval '1 hour') AS p95
      FROM "AssessmentRootExecutionSlot"`;
    const [reserved] = await tx.$queryRaw<Array<{ credits: string }>>`
      SELECT COALESCE(sum("remainingCredits"), 0)::text AS credits FROM "BillingReservation" WHERE "status" = 'RESERVED'`;
    return {
      sampledAt: new Date().toISOString(),
      source: Sources.database,
      queued: queue.length,
      oldestWaitingSeconds: queue.length
        ? Math.max(
            0,
            (Date.now() -
              Math.min(...queue.map((q) => q.requestedAt.getTime()))) /
              1000,
          )
        : 0,
      activeReservations: slots.active,
      activeModelRequests: usage.active,
      unknownModelOutcomes: usage.unknown,
      providerRequestsLastMinute: usage.requests,
      providerTokensLastMinute:
        usage.tokens === null ? null : Number(usage.tokens),
      dbConnectionRatio: connection.used / connection.maximum,
      dbMaxConnections: connection.maximum,
      dbUsedConnections: connection.used,
      dbRootConnections: connection.roots,
      activeSandboxMemoryBytes,
      dbLatencyMs,
      completionsLastMinute: slots.completed,
      dispatchWaitP50Ms: slots.p50,
      dispatchWaitP95Ms: slots.p95,
      reservedCredits: reserved.credits,
      settledCredits: usage.settled,
    };
  }

  /**
   * Business purpose: Evaluate measured capacity with crash-safe replica coordination.
   * Business rules:
   * - Incarnation fencing and one row lock serialize reports, reconciliations and decisions.
   * - A comparison version rejects delayed snapshots issued before any newer reservation/release/control.
   * - Evaluation interval and cooldown state survive API/controller restart; no leader TTL grants admission.
   * Execution flow:
   * 1. Validate report ordering, reconcile quiescent work and persist fresh runtime measurements.
   * 2. When due, measure authoritative demand/resources and run the bottleneck policy.
   * 3. Commit the new ceiling and its immutable sanitized receipt together.
   * Failure cases:
   * - Stale owner/out-of-order report or DB errors reject; no live Root is cancelled or freed by a timer.
   * Side effects:
   * - Updates operational measurements/ceiling/history and releases only proven quiescent reservations.
   */
  async report(input: z.infer<typeof rootCapacityReportSchema>) {
    return this.prisma.$transaction(
      async (tx) => {
        const row = await this.lock(tx);
        this.assertServer(row, input);
        if (row.version !== input.expectedVersion) {
          throw problemException(Codes.conflict, input.incarnationId, {
            status: HttpStatus.CONFLICT,
          });
        }
        const previous = rootCapacityRuntimeMetricsSchema.safeParse(
          row.runtimeMetrics,
        );
        if (
          previous.success &&
          Date.parse(previous.data.sampledAt) >=
            Date.parse(input.metrics.sampledAt)
        ) {
          throw problemException(Codes.conflict, input.incarnationId, {
            status: HttpStatus.CONFLICT,
          });
        }
        const recovered = await this.reconcile(tx, input.liveRunIds);
        const now = new Date();
        const policy = rootCapacityPolicySchema.parse(row.policy);
        const due =
          !row.evaluatedAt ||
          now.getTime() - row.evaluatedAt.getTime() >=
            policy.evaluationSeconds * 1000;
        const database = await this.measurements(tx, input.metrics);
        const calculated = decideRootCapacity(
          policy,
          row,
          input.metrics,
          database,
          now,
        );
        // A safety reduction is immediate; only ordinary scale/hysteresis steps wait for the evaluation interval.
        const decision =
          due || calculated.effective < row.effective ? calculated : null;
        const next = await tx.assessmentRootCapacity.update({
          where: { id: row.id },
          data: {
            runtimeMetrics: input.metrics,
            reportedAt: now,
            databaseMetrics: database as unknown as Prisma.InputJsonValue,
            recoveredSlots: { increment: recovered },
            ...(decision
              ? { ...decision, evaluatedAt: now, version: { increment: 1 } }
              : {}),
          },
        });
        if (decision) await this.receipt(tx, row, next);
        return {
          version: next.version,
          desired: next.desired,
          effective: next.effective,
          reason: next.reason,
          evaluationSeconds: policy.evaluationSeconds,
        };
      },
      { timeout: 15_000 },
    );
  }

  /**
   * Business purpose: Apply an administrator's audited capacity envelope or rollback control.
   * Business rules:
   * - Optimistic versioning prevents lost operator changes; override cannot bypass resource/physical ceilings.
   * Execution flow:
   * 1. Lock and compare the expected version, then persist validated policy and invalidate the old ceiling.
   * 2. Append the actor/reason receipt; the next fresh report computes the allowed effective capacity.
   * Failure cases:
   * - A stale version returns conflict; controls never kill or prematurely release active reservations.
   * Side effects:
   * - Updates operator policy/desired capacity and audit history; temporarily stops new admissions.
   */
  async control(
    input: z.infer<typeof rootCapacityControlSchema>,
    actorId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx);
      if (row.version !== input.expectedVersion)
        throw problemException(Codes.conflict, actorId, {
          status: HttpStatus.CONFLICT,
        });
      const next = await tx.assessmentRootCapacity.update({
        where: { id: row.id },
        data: {
          policy: input.policy,
          desired: input.policy.manualOverride ?? input.policy.initial,
          effective: 0,
          evaluatedAt: null,
          healthySamples: 0,
          idleSamples: 0,
          version: { increment: 1 },
          reason: input.policy.emergencyDisabled
            ? Reasons.emergency
            : Reasons.override,
        },
      });
      await this.receipt(tx, row, next, actorId, input.reason);
      return {
        version: next.version,
        desired: next.desired,
        effective: next.effective,
      };
    });
  }

  /**
   * Business purpose: Preserve revision-bound operational reasons for every capacity evaluation/change.
   * Business rules:
   * - Receipts are append-only, aggregate-only, and commit atomically with their control version.
   * Execution flow:
   * 1. Store the old/new ceiling, measurement snapshot and any authenticated operator reason.
   * Failure cases:
   * - Audit persistence failure aborts its associated capacity mutation.
   * Side effects:
   * - Appends a controller decision without exposing Assessment content or credentials.
   */
  private async receipt(
    tx: Prisma.TransactionClient,
    before: AssessmentRootCapacity,
    after: AssessmentRootCapacity,
    actorId?: string,
    operatorReason?: string,
  ): Promise<void> {
    await tx.assessmentRootCapacityDecision.create({
      data: {
        version: after.version,
        previous: before.effective,
        desired: after.desired,
        effective: after.effective,
        reason: after.reason,
        actorId,
        operatorReason,
        snapshot: {
          policy: after.policy,
          runtime: after.runtimeMetrics,
          database: after.databaseMetrics,
          server: { hostId: after.hostId, incarnationId: after.incarnationId },
        },
      },
    });
  }

  /**
   * Business purpose: Expose sanitized capacity, freshness, drain and history for operators.
   * Business rules:
   * - A stale stored ceiling is presented as zero available admission; live slots remain counted while draining.
   * Execution flow:
   * 1. Read durable control, active reservations and bounded decision history.
   * 2. Project current admission/freshness and available/draining slots.
   * Failure cases:
   * - Database errors propagate; unknown runtime telemetry is explicitly unhealthy.
   * Side effects:
   * - Read-only except first-use singleton initialization; exposes no customer identities or reasoning.
   */
  async status() {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx);
      const policy = rootCapacityPolicySchema.parse(row.policy);
      const active = await tx.assessmentRootExecutionSlot.count({
        where: { releasedAt: null },
      });
      const metrics = rootCapacityRuntimeMetricsSchema.safeParse(
        row.runtimeMetrics,
      );
      const age = metrics.success
        ? (Date.now() - Date.parse(metrics.data.sampledAt)) / 1000
        : null;
      const fresh =
        age !== null &&
        age >= -5 &&
        age <= policy.metricTtlSeconds &&
        row.reportedAt !== null &&
        Date.now() - row.reportedAt.getTime() <=
          policy.metricTtlSeconds * 1000 &&
        row.evaluatedAt !== null &&
        Date.now() - row.evaluatedAt.getTime() <=
          policy.metricTtlSeconds * 1000;
      const effective = fresh ? row.effective : 0;
      return {
        ...row,
        effective,
        storedEffective: row.effective,
        policy,
        active,
        available: Math.max(0, effective - active),
        drainingSlots: Math.max(0, active - effective),
        metricAgeSeconds: age,
        controllerHealthy: fresh,
        history: await tx.assessmentRootCapacityDecision.findMany({
          orderBy: { version: "desc" },
          take: 100,
        }),
      };
    });
  }
}
