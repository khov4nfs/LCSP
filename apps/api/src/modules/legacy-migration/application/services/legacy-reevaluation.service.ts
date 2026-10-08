import { setTimeout as sleep } from "node:timers/promises";

import { ASSESSMENT_LIFECYCLE_STATES as LIFECYCLE } from "@lcsp/contracts/assessment";
import { AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  LEGACY_CORRELATION_PREFIXES,
  LEGACY_MIGRATION_AUDIT_EVENT_TYPES,
  LEGACY_MIGRATION_ERROR_CODES,
  LEGACY_MIGRATION_RUN_KINDS,
  LEGACY_MIGRATION_RUN_STATUSES,
  LEGACY_MIGRATION_TOOL_VERSION,
  LEGACY_REEVALUATION_DEFAULTS,
  LEGACY_REEVALUATION_EXCLUSIONS,
  LEGACY_REEVALUATION_MAX_BACKOFF_MS,
  LEGACY_REEVALUATION_MODES,
  LEGACY_REEVALUATION_STATES,
  LEGACY_REEVALUATION_STOP_REASONS,
  LEGACY_REEVALUATION_USAGE_POLICY,
  LEGACY_VALIDATION_STATUSES,
  type LegacyReevaluationExclusion,
  type LegacyReevaluationState,
  type LegacyReevaluationStopReason,
} from "@lcsp/contracts/legacy-migration";
import { Injectable } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import {
  AssessmentRuntimePreparation,
  PREPARATION_RESULTS,
} from "../../../assessment/application/services/assessment-runtime-preparation.service.js";
import {
  admitStart,
  canaryVerified,
  deriveReevaluationState,
  evaluateCanary,
  exclusionsOf,
  nextDelayMs,
  type PassLimits,
} from "../../domain/legacy-reevaluation.js";
import { LEGACY_OUTBOX_EVENT_TYPE_LIST } from "../../domain/legacy-outbox-classification.js";
import { IN_FLIGHT_CLOSURE_RULES } from "../../infrastructure/persistence/legacy-archive-registry.js";
import { LegacyArchiveRepository } from "../../infrastructure/persistence/legacy-archive.repository.js";
import {
  LegacyReevaluationRepository,
  type CohortMember,
} from "../../infrastructure/persistence/legacy-reevaluation.repository.js";
import { LegacyValidationRepository } from "../../infrastructure/persistence/legacy-validation.repository.js";
import { LegacyMigrationError } from "../legacy-migration.error.js";
import type {
  CanaryVerification,
  ReevaluationPreflight,
  ReevaluationPreflightOptions,
  ReevaluationStartOptions,
  ReevaluationStartResult,
  ReevaluationStatus,
} from "../legacy-reevaluation.types.js";
import { ValidateLegacyMigrationQuery } from "../queries/validate-legacy-migration/validate-legacy-migration.query.js";
import { legacyAuditEvent } from "./legacy-audit.js";

const ERROR = LEGACY_MIGRATION_ERROR_CODES;
const EXCLUDED = LEGACY_REEVALUATION_EXCLUSIONS;
const STOP = LEGACY_REEVALUATION_STOP_REASONS;
const ATTEMPT_TIMEOUT = { timeout: 60_000, maxWait: 10_000 } as const;

type StartOutcome =
  | { kind: "STARTED" }
  | { kind: "ALREADY_STARTED" }
  | { kind: "NOT_READY"; reasons: LegacyReevaluationExclusion[] }
  | {
      kind: "DEFERRED";
      scope: "PASS" | "TENANT";
      reason: LegacyReevaluationStopReason;
    };

const tally = <K extends string>(
  keys: readonly K[],
): Partial<Record<K, number>> => {
  const counts: Partial<Record<K, number>> = {};
  for (const key of keys) counts[key] = (counts[key] ?? 0) + 1;
  return counts;
};

/** A stable, non-sensitive code for a failed start; never the message. */
function failureCode(error: unknown): string {
  if (error instanceof LegacyMigrationError) return error.code;
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  const problem = (response as { problem?: { code?: unknown } } | undefined)
    ?.problem;
  if (typeof problem?.code === "string") return problem.code;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "START_FAILED";
}

const IDLE_STATES: ReadonlySet<LegacyReevaluationState> = new Set([
  LEGACY_REEVALUATION_STATES.READY_NOT_STARTED,
  LEGACY_REEVALUATION_STATES.NOT_READY,
  LEGACY_REEVALUATION_STATES.WAITING,
  LEGACY_REEVALUATION_STATES.BLOCKED,
]);

/** The cohort as the operator reasons about it: nobody-has-started vs started (by whom). */
function summarizeCohort(members: readonly CohortMember[]) {
  const states = members.map(deriveReevaluationState);
  const started = members.filter(
    (member, index) =>
      member.ledger !== null ||
      member.rootClaimed ||
      !IDLE_STATES.has(states[index]),
  );
  return {
    states,
    byState: tally<LegacyReevaluationState>(states),
    startedByOperator: members.filter((member) => member.ledger).length,
    startedOtherwise: started.filter((member) => !member.ledger).length,
    alreadyScheduledOrFinished: started.length,
    notReady: members.filter(
      (member, index) =>
        member.ledger === null &&
        !member.rootClaimed &&
        IDLE_STATES.has(states[index]) &&
        states[index] !== LEGACY_REEVALUATION_STATES.READY_NOT_STARTED,
    ).length,
  };
}

/**
 * The SEPARATE, explicit re-evaluation phase. Migration prepares a V2 assessment and stops; only an
 * operator-run `start` here moves one from PREPARING to ACTIVE, and only through
 * `AssessmentRuntimePreparation` (the same path a customer's repository-setup completion takes).
 * The service coordinates STARTS: whether an execution succeeds, fails or blocks stays canonical state
 * owned by the Assessment Root and its lifecycle policy. It is never wired into API start-up.
 */
@Injectable()
export class LegacyReevaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: LegacyReevaluationRepository,
    private readonly archive: LegacyArchiveRepository,
    private readonly validation: LegacyValidationRepository,
    private readonly queries: QueryBus,
    private readonly preparation: AssessmentRuntimePreparation,
    private readonly audit: AuditWriterService,
  ) {}

  // ---- gates ---------------------------------------------------------------------------------

  /** Migration must be complete, reconciled and past its rollback boundary before anything starts. */
  private async gates(runId: string, sampleSize: number) {
    const run = await this.archive.findRun(runId);
    if (!run || run.kind === LEGACY_MIGRATION_RUN_KINDS.REEVALUATION)
      throw new LegacyMigrationError(ERROR.RUN_NOT_FOUND, runId);
    const report = await this.queries.execute(
      new ValidateLegacyMigrationQuery(runId, sampleSize),
    );
    const { boundaryClosedAt } = await this.archive.restoreState();
    return {
      blockingFailures: report.summary.blockingFailures,
      failingChecks: report.checks
        .filter(
          (entry) =>
            entry.blocking && entry.status === LEGACY_VALIDATION_STATUSES.FAIL,
        )
        .map((entry) => entry.id),
      restoreBoundaryClosed: boundaryClosedAt !== null,
    };
  }

  // ---- read models ---------------------------------------------------------------------------

  async preflight(
    options: ReevaluationPreflightOptions,
  ): Promise<ReevaluationPreflight> {
    const gates = await this.gates(options.cutoverRunId, options.sampleSize);
    const members = await this.repo.cohort();
    const load = await this.repo.load();
    const observed = await this.repo.observedRoutes();
    const canary = await this.verifyCanary(options.attestedChecks);

    const cohort = summarizeCohort(members);
    const excluded = tally(
      members
        .filter(
          (member) =>
            !member.ledger && member.lifecycleState === LIFECYCLE.PREPARING,
        )
        .flatMap((member) => exclusionsOf(member)),
    );
    const eligible = members.filter(
      (member) => exclusionsOf(member).length === 0,
    );
    const perTenant = new Map<string, number>();
    for (const member of eligible)
      perTenant.set(member.ownerId, (perTenant.get(member.ownerId) ?? 0) + 1);

    const declared = options.modelRoutes.map((route) => route.toLowerCase());
    const usageRoutes = observed.usage.map((row) => ({
      route: `${row.provider}/${row.model}`.toLowerCase(),
      invocations: Number(row.invocations),
      assessments: Number(row.assessments),
    }));
    const invocations = usageRoutes.reduce(
      (sum, row) => sum + row.invocations,
      0,
    );
    const assessments = usageRoutes.reduce(
      (sum, row) => sum + row.assessments,
      0,
    );
    const blockers = [
      ...(gates.blockingFailures > 0 ? ["CUTOVER_NOT_VALIDATED"] : []),
      ...(gates.restoreBoundaryClosed ? [] : ["RESTORE_BOUNDARY_OPEN"]),
      ...(declared.length === 0 ? ["MODEL_ROUTE_NOT_DECLARED"] : []),
    ];

    return {
      generatedAt: new Date().toISOString(),
      cutoverRunId: options.cutoverRunId,
      gates: {
        cutoverValidated: gates.blockingFailures === 0,
        blockingFailures: gates.blockingFailures,
        failingChecks: gates.failingChecks,
        restoreBoundaryClosed: gates.restoreBoundaryClosed,
        modelRouteDeclared: declared.length > 0,
      },
      cohort: {
        migrated: members.length,
        byState: cohort.byState,
        eligible: eligible.length,
        notReady: cohort.notReady,
        excluded,
        alreadyScheduledOrFinished: cohort.alreadyScheduledOrFinished,
        startedByOperator: cohort.startedByOperator,
        startedOtherwise: cohort.startedOtherwise,
      },
      perTenant: {
        tenantsTotal: perTenant.size,
        top: [...perTenant.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 25)
          .map(([ownerId, count]) => ({
            ownerId,
            eligible: count,
            inFlight: load.byTenant.get(ownerId) ?? 0,
          })),
      },
      concurrency: { ...options.limits, maxTotal: options.maxTotal },
      currentLoad: { inFlight: load.inFlight, queued: load.queued },
      modelRoute: {
        declared,
        observedPolicies: observed.policies.map((policy) => ({
          role: policy.role,
          route: `${policy.provider}/${policy.model}`.toLowerCase(),
          policyVersion: policy.policyVersion,
        })),
        observedUsage: usageRoutes,
        undeclaredObservedRoutes:
          declared.length === 0
            ? []
            : usageRoutes
                .map((row) => row.route)
                .filter((route) => !declared.includes(route)),
      },
      budget: {
        policy: LEGACY_REEVALUATION_USAGE_POLICY,
        walletConsultedByExecution: false,
        upperBoundRootExecutions: Math.min(
          eligible.length,
          options.maxTotal ?? eligible.length,
        ),
        modelInvocationsPerRoot: null,
        observedInvocationsPerAssessment:
          assessments > 0
            ? Math.round((invocations / assessments) * 10) / 10
            : null,
        note: "Each started assessment is one Root execution. The number of model calls inside it is not estimated: it depends on the repository and the legal portfolio.",
      },
      canary: {
        canaryAssessments: canary.canaryAssessments,
        verified: canary.verified,
        attestedChecks: canary.attestedChecks,
      },
      blockers,
    };
  }

  async status(assessmentIds?: readonly string[]): Promise<ReevaluationStatus> {
    const members = await this.repo.cohort();
    const load = await this.repo.load();
    const runs = new Map<string, ReevaluationStatus["runs"][number]>();
    for (const member of members) {
      if (!member.ledger) continue;
      const entry = runs.get(member.ledger.runId);
      if (entry) {
        entry.started += 1;
        if (member.ledger.startedAt.toISOString() < entry.firstStartedAt)
          entry.firstStartedAt = member.ledger.startedAt.toISOString();
      } else
        runs.set(member.ledger.runId, {
          runId: member.ledger.runId,
          mode: member.ledger.mode,
          startedBy: member.ledger.startedBy,
          started: 1,
          firstStartedAt: member.ledger.startedAt.toISOString(),
        });
    }
    const cohort = summarizeCohort(members);
    return {
      generatedAt: new Date().toISOString(),
      migrated: members.length,
      byState: cohort.byState,
      startedByOperator: cohort.startedByOperator,
      startedOtherwise: cohort.startedOtherwise,
      load: { inFlight: load.inFlight, queued: load.queued },
      runs: [...runs.values()].sort((a, b) =>
        a.firstStartedAt.localeCompare(b.firstStartedAt),
      ),
      ...(assessmentIds
        ? {
            assessments: members.flatMap((member, index) => {
              if (!assessmentIds.includes(member.assessmentId)) return [];
              const state = cohort.states[index];
              return [
                {
                  assessmentId: member.assessmentId,
                  state,
                  lifecycleState: member.lifecycleState,
                  startedVia: member.ledger
                    ? ("OPERATOR_REEVALUATION" as const)
                    : IDLE_STATES.has(state)
                      ? null
                      : ("OTHER" as const),
                },
              ];
            }),
          }
        : {}),
    };
  }

  /** V1 authority is global: any in-flight V1 row or deliverable retired command is old authority. */
  private async v1Authority() {
    let inFlightRows = 0;
    for (const rule of IN_FLIGHT_CLOSURE_RULES)
      inFlightRows += await this.validation.inFlightCount(rule);
    return {
      inFlightRows,
      undeliveredRetiredCommands: await this.validation.undeliveredLegacyOutbox(
        LEGACY_OUTBOX_EVENT_TYPE_LIST,
      ),
    };
  }

  /** Verifies every canary the operator started; bulk is allowed only when all of them pass. */
  async verifyCanary(
    attestedChecks: readonly string[],
  ): Promise<CanaryVerification> {
    const canaries = (await this.repo.cohort()).filter(
      (member) => member.ledger?.mode === LEGACY_REEVALUATION_MODES.CANARY,
    );
    const declared = await this.repo.canaryRoutes();
    const v1Authority = await this.v1Authority();
    const assessments: CanaryVerification["assessments"] = [];
    for (const member of canaries) {
      const rows = await this.repo.canaryEvidence(member.assessmentId);
      assessments.push({
        assessmentId: member.assessmentId,
        lifecycleState: member.lifecycleState,
        results: rows ? evaluateCanary({ ...rows, v1Authority }, declared) : [],
      });
    }
    return {
      generatedAt: new Date().toISOString(),
      canaryAssessments: canaries.length,
      verified: canaryVerified(assessments, attestedChecks),
      attestedChecks: [...attestedChecks],
      assessments,
    };
  }

  // ---- start ---------------------------------------------------------------------------------

  /**
   * One bounded scheduling pass. It starts at most `maxTotal` assessments, one at a time, and every
   * start re-reads the canonical load inside its own transaction so the caps are exact even with
   * concurrent operators. A failure is isolated to its assessment and counted against a failure
   * budget; nothing is retried in the same pass and no failure rolls back an earlier start.
   */
  async start(
    options: ReevaluationStartOptions,
  ): Promise<ReevaluationStartResult> {
    this.assertRequest(options);
    const gates = await this.gates(options.cutoverRunId, options.sampleSize);
    if (gates.blockingFailures > 0)
      throw new LegacyMigrationError(
        ERROR.REEVALUATION_CUTOVER_NOT_VALIDATED,
        gates.failingChecks.join(","),
      );
    if (!gates.restoreBoundaryClosed)
      throw new LegacyMigrationError(
        ERROR.REEVALUATION_RESTORE_BOUNDARY_OPEN,
        "close the rollback boundary before the first assessment is started: a Root start is an accepted V2 write",
      );
    const bulk = options.mode === LEGACY_REEVALUATION_MODES.BATCH;
    if (bulk) {
      const canary = await this.verifyCanary(options.attestedChecks);
      if (!canary.verified)
        throw new LegacyMigrationError(
          ERROR.REEVALUATION_CANARY_REQUIRED,
          `${canary.canaryAssessments} canary assessment(s); a canary must be started, finished and verified first`,
        );
    }

    const members = await this.repo.cohort(
      bulk ? undefined : options.assessmentIds,
    );
    const queue = bulk
      ? members.filter((member) => exclusionsOf(member).length === 0)
      : this.canarySelection(options.assessmentIds, members);
    const maxTotal = bulk ? options.maxTotal : options.assessmentIds.length;
    const limits: PassLimits = { ...options.limits, maxTotal };

    const runId = await this.archive.createRun({
      kind: LEGACY_MIGRATION_RUN_KINDS.REEVALUATION,
      toolVersion: LEGACY_MIGRATION_TOOL_VERSION,
      parameters: {
        mode: options.mode,
        cutoverRunId: options.cutoverRunId,
        authorizedBy: options.authorizedBy,
        modelRoutes: [...options.modelRoutes],
        limits: { ...options.limits, maxTotal },
        assessmentIds: [...options.assessmentIds],
      },
    });
    const correlationId = `${LEGACY_CORRELATION_PREFIXES.REEVALUATION}${runId}`;

    const result: ReevaluationStartResult = {
      runId,
      mode: options.mode,
      requested: maxTotal,
      started: [],
      // A canary id started by an earlier run is reported, never started a second time.
      alreadyStarted: bulk
        ? []
        : members
            .filter((member) => member.ledger)
            .map((member) => member.assessmentId),
      deferred: [],
      failed: [],
      notReady: [],
      stopReason: STOP.NO_ELIGIBLE_ASSESSMENT,
      remainingEligible: 0,
      load: { inFlight: 0, queued: 0 },
    };
    let stop: LegacyReevaluationStopReason | null = null;
    let tenantDeferred = false;
    let consecutiveFailures = 0;
    let pace = false;

    for (const member of queue) {
      if (pace) {
        await sleep(
          nextDelayMs(
            options.limits.minStartIntervalMs,
            consecutiveFailures,
            LEGACY_REEVALUATION_MAX_BACKOFF_MS,
          ),
        );
        pace = false;
      }
      let outcome: StartOutcome;
      try {
        outcome = await this.startOne(
          member,
          options,
          limits,
          runId,
          correlationId,
          result.started.length,
        );
      } catch (error) {
        const code = failureCode(error);
        result.failed.push({ assessmentId: member.assessmentId, code });
        consecutiveFailures += 1;
        pace = true;
        await this.audit.write(
          legacyAuditEvent({
            eventType:
              LEGACY_MIGRATION_AUDIT_EVENT_TYPES.LEGACY_REEVALUATION_START_FAILED,
            correlationId,
            resourceType: AUDIT_RESOURCE_TYPES.assessment,
            resourceId: member.assessmentId,
            assessmentId: member.assessmentId,
            payload: { runId, mode: options.mode, failure: code },
          }),
        );
        if (result.failed.length >= options.limits.maxFailures) {
          stop = STOP.FAILURE_BUDGET_EXCEEDED;
          break;
        }
        continue;
      }
      if (outcome.kind === "STARTED") {
        result.started.push(member.assessmentId);
        consecutiveFailures = 0;
        pace = true;
      } else if (outcome.kind === "ALREADY_STARTED")
        result.alreadyStarted.push(member.assessmentId);
      else if (outcome.kind === "NOT_READY")
        result.notReady.push({
          assessmentId: member.assessmentId,
          reasons: outcome.reasons,
        });
      else {
        result.deferred.push({
          assessmentId: member.assessmentId,
          reason: outcome.reason,
        });
        if (outcome.scope === "PASS") stop = outcome.reason;
        else tenantDeferred = true;
      }
      if (stop) break;
    }

    result.stopReason =
      stop ??
      (result.started.length >= maxTotal
        ? STOP.MAX_TOTAL_REACHED
        : tenantDeferred
          ? STOP.TENANT_CAP_REACHED
          : STOP.NO_ELIGIBLE_ASSESSMENT);
    const after = await this.repo.load();
    result.load = { inFlight: after.inFlight, queued: after.queued };
    result.remainingEligible = (await this.repo.cohort()).filter(
      (member) => exclusionsOf(member).length === 0,
    ).length;
    await this.repo.recordRunResult(runId, { ...result });
    await this.archive.finishRun(
      runId,
      stop === STOP.FAILURE_BUDGET_EXCEEDED
        ? LEGACY_MIGRATION_RUN_STATUSES.FAILED
        : LEGACY_MIGRATION_RUN_STATUSES.COMPLETED,
    );
    return result;
  }

  private assertRequest(options: ReevaluationStartOptions): void {
    const reject = (
      code: (typeof ERROR)[keyof typeof ERROR],
      detail: string,
    ): never => {
      throw new LegacyMigrationError(code, detail);
    };
    if (options.authorizedBy.trim().length === 0)
      reject(ERROR.REEVALUATION_NOT_AUTHORIZED, "--authorized-by is required");
    if (options.modelRoutes.length === 0)
      reject(
        ERROR.REEVALUATION_MODEL_ROUTE_REQUIRED,
        "declare the provider/model route(s) the workers will use with --model-route",
      );
    if (options.mode === LEGACY_REEVALUATION_MODES.CANARY) {
      const ids = new Set(options.assessmentIds);
      if (
        ids.size === 0 ||
        ids.size !== options.assessmentIds.length ||
        ids.size > LEGACY_REEVALUATION_DEFAULTS.MAX_CANARY_SIZE
      )
        reject(
          ERROR.REEVALUATION_SELECTION_INVALID,
          `a canary is 1 to ${LEGACY_REEVALUATION_DEFAULTS.MAX_CANARY_SIZE} distinct, explicitly named assessments`,
        );
    } else {
      if (options.assessmentIds.length > 0)
        reject(
          ERROR.REEVALUATION_SELECTION_INVALID,
          "a batch selects by eligibility, not by id",
        );
      if (!options.confirmBulk)
        reject(
          ERROR.REEVALUATION_BULK_NOT_CONFIRMED,
          "a batch spends AI budget on many customers: pass --confirm-bulk",
        );
      if (!Number.isInteger(options.maxTotal) || options.maxTotal < 1)
        reject(
          ERROR.REEVALUATION_SELECTION_INVALID,
          "--max-total must be >= 1",
        );
    }
  }

  /** Explicit ids only. Anything that is not a startable migrated assessment aborts BEFORE any start. */
  private canarySelection(
    ids: readonly string[],
    members: readonly CohortMember[],
  ): CohortMember[] {
    const byId = new Map(
      members.map((member) => [member.assessmentId, member]),
    );
    const invalid: {
      assessmentId: string;
      reasons: LegacyReevaluationExclusion[];
    }[] = [];
    const startable: CohortMember[] = [];
    for (const id of ids) {
      const member = byId.get(id);
      if (!member) {
        invalid.push({ assessmentId: id, reasons: [EXCLUDED.NOT_MIGRATED] });
        continue;
      }
      const reasons = exclusionsOf(member);
      if (reasons.length === 0) startable.push(member);
      // Already started by a previous canary: reported, never started twice.
      else if (!member.ledger) invalid.push({ assessmentId: id, reasons });
    }
    if (invalid.length > 0)
      throw new LegacyMigrationError(
        ERROR.REEVALUATION_SELECTION_INVALID,
        JSON.stringify(invalid),
      );
    return startable;
  }

  private startOne(
    member: CohortMember,
    options: ReevaluationStartOptions,
    limits: PassLimits,
    runId: string,
    correlationId: string,
    startedSoFar: number,
  ): Promise<StartOutcome> {
    const { assessmentId } = member;
    return this.prisma.$transaction(async (tx) => {
      await this.repo.lockStarts(tx);
      if (!(await this.repo.lockPreparing(tx, assessmentId)))
        return { kind: "ALREADY_STARTED" };
      const [fresh] = await this.repo.cohort([assessmentId], tx);
      if (!fresh)
        return { kind: "NOT_READY", reasons: [EXCLUDED.NOT_MIGRATED] };
      if (fresh.ledger) return { kind: "ALREADY_STARTED" };
      const reasons = exclusionsOf(fresh);
      if (reasons.length > 0) return { kind: "NOT_READY", reasons };

      const admission = admitStart(
        limits,
        await this.repo.loadForTenant(tx, fresh.ownerId),
        startedSoFar,
      );
      if (!admission.admit)
        return {
          kind: "DEFERRED",
          scope: admission.scope,
          reason: admission.reason,
        };

      const snapshotId = await this.repo.pinnedSnapshotId(tx, assessmentId);
      if (!snapshotId)
        return { kind: "NOT_READY", reasons: [EXCLUDED.NO_PINNED_SNAPSHOT] };
      const prepared = await this.preparation.prepareInTx(tx, {
        assessmentId,
        snapshotId,
        correlationId,
      });
      if (prepared.result === PREPARATION_RESULTS.ALREADY_ACTIVE)
        return { kind: "ALREADY_STARTED" };
      if (prepared.result !== PREPARATION_RESULTS.ACTIVATED)
        return { kind: "NOT_READY", reasons: [EXCLUDED.COVERAGE_INCOMPLETE] };

      const rootCommandId = await this.repo.rootCommandId(tx, assessmentId);
      if (!rootCommandId)
        throw new LegacyMigrationError(
          ERROR.REQUEST_INVALID,
          `no Root command was enqueued for ${assessmentId}`,
        );
      await tx.legacyReevaluation.create({
        data: {
          assessmentId,
          ownerId: fresh.ownerId,
          runId,
          mode: options.mode,
          startedBy: options.authorizedBy,
          rootCommandId,
        },
      });
      await this.audit.writeInTx(
        legacyAuditEvent({
          eventType:
            LEGACY_MIGRATION_AUDIT_EVENT_TYPES.LEGACY_REEVALUATION_STARTED,
          correlationId,
          resourceType: AUDIT_RESOURCE_TYPES.assessment,
          resourceId: assessmentId,
          assessmentId,
          payload: {
            runId,
            mode: options.mode,
            authorizedBy: options.authorizedBy,
            modelRoutes: [...options.modelRoutes],
            rootCommandId,
          },
        }),
        tx,
      );
      return { kind: "STARTED" };
    }, ATTEMPT_TIMEOUT);
  }
}
