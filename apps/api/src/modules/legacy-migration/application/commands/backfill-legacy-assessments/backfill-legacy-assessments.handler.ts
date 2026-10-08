import {
  AGENTIC_RUNTIME_TRANSITION_GUARDS,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import { AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  LEGACY_MIGRATION_PHASES,
  LEGACY_MIGRATION_AUDIT_EVENT_TYPES,
  LEGACY_MIGRATION_ERROR_CODES,
  type LegacyBackfillReason,
} from "@lcsp/contracts/legacy-migration";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import type { Prisma } from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { AssessmentLifecycleCoordinator } from "../../../../assessment/application/services/assessment-lifecycle-coordinator.service.js";
import {
  AssessmentRuntimePreparation,
  PIN_RESULTS,
} from "../../../../assessment/application/services/assessment-runtime-preparation.service.js";
import {
  legacyBackfillLifecycle,
  planLegacyBackfill,
} from "../../../domain/legacy-backfill-plan.js";
import { LegacyArchiveRepository } from "../../../infrastructure/persistence/legacy-archive.repository.js";
import { LegacyValidationRepository } from "../../../infrastructure/persistence/legacy-validation.repository.js";
import { LegacyMigrationError } from "../../legacy-migration.error.js";
import {
  LEGACY_MIGRATION_ACTOR,
  legacyAuditEvent,
} from "../../services/legacy-audit.js";
import {
  BackfillLegacyAssessmentsCommand,
  type BackfillLegacyAssessmentsResult,
} from "./backfill-legacy-assessments.command.js";

const OUTCOMES = {
  SKIPPED: "SKIPPED",
  BACKFILLED: "BACKFILLED",
  RECONCILED: "RECONCILED",
} as const;
type Outcome =
  | { kind: typeof OUTCOMES.SKIPPED }
  | {
      kind: typeof OUTCOMES.BACKFILLED | typeof OUTCOMES.RECONCILED;
      reason: LegacyBackfillReason;
      pinned: boolean;
    };

@CommandHandler(BackfillLegacyAssessmentsCommand)
export class BackfillLegacyAssessmentsHandler implements ICommandHandler<BackfillLegacyAssessmentsCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly archive: LegacyArchiveRepository,
    private readonly validation: LegacyValidationRepository,
    private readonly coordinator: AssessmentLifecycleCoordinator,
    private readonly preparation: AssessmentRuntimePreparation,
    private readonly audit: AuditWriterService,
  ) {}

  async execute(
    command: BackfillLegacyAssessmentsCommand,
  ): Promise<BackfillLegacyAssessmentsResult> {
    const portfolio = await this.validation.activePortfolio();
    if (portfolio.activeCount !== 1 || portfolio.engineeringRuleCount === 0)
      throw new LegacyMigrationError(
        LEGACY_MIGRATION_ERROR_CODES.NO_ACTIVE_LEGAL_PORTFOLIO,
        `expected exactly one ACTIVE portfolio with rules, found ${portfolio.activeCount}`,
      );

    const result: BackfillLegacyAssessmentsResult = {
      backfilled: 0,
      reconciled: 0,
      pinnedSnapshot: 0,
      byReason: {},
      skipped: 0,
    };
    const seen = new Set<string>();
    for (;;) {
      const candidates = (
        await this.validation.nextBackfillCandidates(command.batchSize)
      ).filter((candidate) => !seen.has(candidate.id));
      if (candidates.length === 0) break;
      for (const candidate of candidates) {
        seen.add(candidate.id);
        const outcome = await this.prisma.$transaction(
          (tx) =>
            this.backfillOne(tx, command, candidate.id, candidate.ownerId),
          { timeout: 60_000, maxWait: 10_000 },
        );
        if (outcome.kind === OUTCOMES.SKIPPED) {
          result.skipped += 1;
          continue;
        }
        if (outcome.kind === OUTCOMES.BACKFILLED) result.backfilled += 1;
        else result.reconciled += 1;
        if (outcome.pinned) result.pinnedSnapshot += 1;
        result.byReason[outcome.reason] =
          (result.byReason[outcome.reason] ?? 0) + 1;
      }
    }
    await this.archive.recordPhase(
      command.runId,
      LEGACY_MIGRATION_PHASES.BACKFILL,
      result,
    );
    return result;
  }

  private async backfillOne(
    tx: Prisma.TransactionClient,
    command: BackfillLegacyAssessmentsCommand,
    assessmentId: string,
    ownerId: string,
  ): Promise<Outcome> {
    // Re-check under a row lock: a concurrent writer or an earlier run may have set the state.
    const [locked] = await tx.$queryRaw<
      {
        id: string;
        ownerId: string;
        lifecycleState: string | null;
        lifecycleRevision: number | null;
      }[]
    >`
      SELECT id, "ownerId", "lifecycleState"::text, "lifecycleRevision" FROM "Assessment"
       WHERE id = ${assessmentId} FOR UPDATE`;
    if (!locked || locked.ownerId !== ownerId)
      throw new LegacyMigrationError(
        LEGACY_MIGRATION_ERROR_CODES.PREFLIGHT_BLOCKED,
        `assessment ownership changed: ${assessmentId}`,
      );
    const existing = locked.lifecycleState !== null;
    let threadId: string;
    if (existing) {
      const runtime = await tx.assessmentRuntime.findUnique({
        where: { assessmentId },
      });
      const assessmentCase = await tx.assessmentCase.findUnique({
        where: { assessmentId },
      });
      const summary = await tx.legacyAssessmentArchive.findUnique({
        where: { assessmentId },
      });
      const started = await this.validation.hasRootStart(tx, assessmentId);
      if (
        locked.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.PREPARING ||
        !runtime ||
        runtime.startedAt !== null ||
        runtime.currentExecutionId !== null ||
        runtime.leaseToken !== null ||
        started ||
        !assessmentCase ||
        assessmentCase.repositorySnapshotId !== null
      )
        return { kind: OUTCOMES.SKIPPED };
      if (
        !summary ||
        locked.lifecycleRevision === null ||
        summary.v2ThreadId !== runtime.threadId ||
        summary.ownerId !== ownerId
      )
        throw new LegacyMigrationError(
          LEGACY_MIGRATION_ERROR_CODES.PREFLIGHT_BLOCKED,
          `invalid existing backfill mapping: ${assessmentId}`,
        );
      threadId = runtime.threadId;
    }
    const archived = await tx.legacyArchiveRecord.count({
      where: { sourceTable: "ASSESSMENT", sourceId: assessmentId },
    });
    if (archived === 0)
      throw new LegacyMigrationError(
        LEGACY_MIGRATION_ERROR_CODES.PREFLIGHT_BLOCKED,
        `assessment ${assessmentId} must be archived before it is backfilled`,
      );

    const snapshots = await this.validation.snapshotsForBackfill(
      tx,
      assessmentId,
      ownerId,
    );
    const plan = planLegacyBackfill(snapshots);

    if (!existing) {
      const initialized = await this.coordinator.initializeInTx(
        {
          assessmentId,
          ownerId,
          rootAgentVersion: "assessment-root-v2",
          checkpointNamespace: assessmentId,
          correlationId: command.correlationId,
        },
        tx,
      );
      threadId = initialized.threadId;
      const { legalPortfolioVersionId } = await this.preparation.createCaseInTx(
        tx,
        assessmentId,
      );
      if (!legalPortfolioVersionId)
        throw new LegacyMigrationError(
          LEGACY_MIGRATION_ERROR_CODES.NO_ACTIVE_LEGAL_PORTFOLIO,
          `no ACTIVE portfolio to pin for ${assessmentId}`,
        );
      await this.coordinator.transitionVerifiedInTx(
        {
          assessmentId,
          expectedRevision: 0,
          toState: ASSESSMENT_LIFECYCLE_STATES.PREPARING,
          correlationId: command.correlationId,
          actorId: LEGACY_MIGRATION_ACTOR.id,
        },
        tx,
        [],
        LEGACY_MIGRATION_ACTOR,
      );
    }
    if (plan.pinSnapshotId) {
      const pinned = await this.preparation.pinRuntimeInputsInTx(tx, {
        assessmentId,
        snapshotId: plan.pinSnapshotId,
        correlationId: command.correlationId,
      });
      if (pinned.result !== PIN_RESULTS.PINNED)
        throw new LegacyMigrationError(
          LEGACY_MIGRATION_ERROR_CODES.NO_ACTIVE_LEGAL_PORTFOLIO,
          `portfolio has no EngineeringRule to cover for ${assessmentId}`,
        );
    }

    const lifecycleState = legacyBackfillLifecycle(plan);
    if (
      lifecycleState === ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT
    )
      await this.coordinator.transitionVerifiedInTx(
        {
          assessmentId,
          expectedRevision: existing ? locked.lifecycleRevision! : 1,
          toState: lifecycleState,
          correlationId: command.correlationId,
          actorId: LEGACY_MIGRATION_ACTOR.id,
        },
        tx,
        [AGENTIC_RUNTIME_TRANSITION_GUARDS.OUTSTANDING_REQUIRED_INPUT],
        LEGACY_MIGRATION_ACTOR,
      );

    if (!existing)
      await this.archive.archiveBackfilledAssessment(tx, {
        runId: command.runId,
        assessmentId,
        v2ThreadId: threadId!,
        v2LifecycleState: lifecycleState,
      });
    await this.audit.writeInTx(
      legacyAuditEvent({
        eventType:
          LEGACY_MIGRATION_AUDIT_EVENT_TYPES.LEGACY_ASSESSMENT_BACKFILLED,
        correlationId: command.correlationId,
        resourceType: AUDIT_RESOURCE_TYPES.assessment,
        resourceId: assessmentId,
        assessmentId,
        payload: {
          runId: command.runId,
          threadId: threadId!,
          lifecycleState,
          pinnedSnapshotId: plan.pinSnapshotId,
          reason: plan.reason,
          reconciledExistingCase: existing,
          examinedSnapshotIds: snapshots.map((snapshot) => snapshot.id),
          // Explicit: nothing semantic is carried over from V1.
          promotedDecisions: 0,
          promotedFacts: 0,
          promotedEvidence: 0,
        },
      }),
      tx,
    );
    return {
      kind: existing ? OUTCOMES.RECONCILED : OUTCOMES.BACKFILLED,
      reason: plan.reason,
      pinned: plan.pinSnapshotId !== null,
    };
  }
}
