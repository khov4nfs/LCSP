import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_LIFECYCLE_STATES,
  ARTIFACT_LIFECYCLE_STATES,
  AGENT_EXECUTION_STATES,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ROOT_BOUNDARY,
  ASSESSMENT_ROOT_COMMAND_TYPES,
  ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES,
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_BUDGET_REASONS,
} from "@lcsp/contracts/assessment-domain";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
  buildAuditEventInput,
} from "@lcsp/contracts/audit";
import {
  ASSESSMENT_BUDGET_EXTENSION_SOURCES,
  ASSESSMENT_RUNTIME_CONTROL_ACTIONS as Actions,
  isAssessmentRuntimeControlState,
  ASSESSMENT_RUNTIME_CONTROL_PROBLEM_CODES as Problems,
  ASSESSMENT_RUNTIME_CONTROL_STATES as States,
  type AssessmentBudgetExtensionInput,
  type AssessmentRuntimeControlAction,
  type AssessmentRuntimeControlResult,
  type AssessmentRuntimeControlState,
} from "@lcsp/contracts/evidence";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import { BILLING_ERROR_CODES } from "@lcsp/contracts/billing";
import { resolveResponseLanguage } from "@lcsp/contracts/shared/locale";
import { HttpStatus, Injectable, Optional } from "@nestjs/common";
import {
  AssessmentRuntimeControlState as DbState,
  Prisma,
} from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { AuditSanitizer } from "../audit/audit-sanitizer.js";
import { AuditWriterService } from "../audit/audit-writer.service.js";
import { problemException } from "../http/filters/error.factory.js";
import { OutboxRepository } from "../outbox/outbox.repository.js";
import {
  toPrismaAuditResourceType,
  toPrismaAuthDecision,
} from "../../infrastructure/prisma/prisma-enum-mappers.js";
import type { RbacRequestContext } from "../rbac/interfaces/rbac-request.interface.js";
import { AssessmentLifecycleCoordinator } from "../../modules/assessment/application/services/assessment-lifecycle-coordinator.service.js";

// Explicit persistence boundary; controllers never return Prisma values.
function toDb(state: AssessmentRuntimeControlState): DbState {
  return DbState[state];
}
function result(row: {
  id: string;
  state: string;
  requestId: string | null;
}): AssessmentRuntimeControlResult {
  if (!isAssessmentRuntimeControlState(row.state))
    throw new Error("Invalid persisted runtime control state");
  return { state: row.state, targetRunId: row.id, requestId: row.requestId };
}

/**
 * Business purpose: Compute a deterministic SHA-256 fingerprint of an admin budget extension request for idempotency verification.
 *
 * Business rules:
 * - Retries carrying the same `idempotencyKey` and identical semantic request parameters must replay safely.
 * - Retries carrying the same `idempotencyKey` with any altered actor, target, quota, reason, source, or expectedVersion must be rejected as `IDEMPOTENCY_CONFLICT`.
 *
 * Execution flow:
 * 1. Normalize optional fields (`source`, `targetRunId`, token/call deltas, `expectedVersion`) to canonical defaults.
 * 2. Hash the deterministic JSON representation with SHA-256.
 *
 * Failure cases:
 * - Pure function; does not throw on valid contract inputs.
 *
 * Side effects:
 * - Pure read-only calculation; performs no persistence or I/O.
 */
function computeBudgetExtensionRequestDigest(params: {
  assessmentId: string;
  actorId: string;
  targetRunId?: string;
  budgetExtension: AssessmentBudgetExtensionInput;
  expectedVersion?: number;
}): string {
  // Why: Normalize optional fields so equivalent requests produce an identical digest
  // while any quota, reason, source, target, actor, or expectedVersion change diverges.
  const canonicalPayload = {
    assessmentId: params.assessmentId,
    actorId: params.actorId,
    targetRunId: params.targetRunId ?? null,
    version: params.budgetExtension.version,
    source:
      params.budgetExtension.source ??
      ASSESSMENT_BUDGET_EXTENSION_SOURCES.adminOverride,
    auditReason: params.budgetExtension.auditReason,
    additionalModelCalls: params.budgetExtension.additionalModelCalls ?? null,
    additionalInputTokens: params.budgetExtension.additionalInputTokens ?? null,
    additionalOutputTokens:
      params.budgetExtension.additionalOutputTokens ?? null,
    additionalTotalTokens: params.budgetExtension.additionalTotalTokens ?? null,
    expectedVersion: params.expectedVersion ?? null,
  };
  return createHash("sha256")
    .update(JSON.stringify(canonicalPayload))
    .digest("hex");
}

/**
 * Business purpose: Check whether an admin budget extension `idempotencyKey` has already been applied on the assessment and whether the request fingerprint matches.
 *
 * Business rules:
 * - Both the current active `budgetExtension` and historical `budgetExtensionHistory` entries on `blockerReference` are inspected.
 * - A matching `idempotencyKey` with a matching fingerprint triggers idempotent replay; a differing fingerprint signals `IDEMPOTENCY_CONFLICT`.
 *
 * Execution flow:
 * 1. Collect existing active and historical budget extension records from `blockerReference`.
 * 2. Search for a record matching `idempotencyKey`.
 * 3. Compare stored `requestDigest` (or normalized legacy fields if `requestDigest` is absent) against the incoming request.
 *
 * Failure cases:
 * - Returns `{ matched: false }` when `blockerReference` is absent or no prior extension carries the `idempotencyKey`.
 *
 * Side effects:
 * - Pure read-only inspection of persisted `blockerReference` JSON; performs no mutations.
 */
function findBudgetExtensionIdempotencyMatch(params: {
  blockerRef: Record<string, unknown> | null;
  idempotencyKey: string;
  requestDigest: string;
  actorId: string;
  budgetExtension: AssessmentBudgetExtensionInput;
}): { matched: false } | { matched: true; sameFingerprint: boolean } {
  const candidates: Array<Record<string, unknown>> = [];
  if (
    params.blockerRef?.budgetExtension &&
    typeof params.blockerRef.budgetExtension === "object"
  ) {
    candidates.push(
      params.blockerRef.budgetExtension as Record<string, unknown>,
    );
  }
  if (Array.isArray(params.blockerRef?.budgetExtensionHistory)) {
    for (const item of params.blockerRef.budgetExtensionHistory) {
      if (item && typeof item === "object") {
        candidates.push(item as Record<string, unknown>);
      }
    }
  }

  const hit = candidates.find(
    (entry) => entry.idempotencyKey === params.idempotencyKey,
  );
  if (!hit) {
    return { matched: false };
  }

  if (typeof hit.requestDigest === "string") {
    return {
      matched: true,
      sameFingerprint: hit.requestDigest === params.requestDigest,
    };
  }

  // Fallback comparison for pre-seeded fixtures carrying `idempotencyKey` without `requestDigest`.
  const resolvedSource =
    params.budgetExtension.source ??
    ASSESSMENT_BUDGET_EXTENSION_SOURCES.adminOverride;
  const sameFingerprint =
    hit.version === params.budgetExtension.version &&
    (hit.source ?? ASSESSMENT_BUDGET_EXTENSION_SOURCES.adminOverride) ===
      resolvedSource &&
    hit.auditReason === params.budgetExtension.auditReason &&
    (hit.additionalModelCalls ?? null) ===
      (params.budgetExtension.additionalModelCalls ?? null) &&
    (hit.additionalInputTokens ?? null) ===
      (params.budgetExtension.additionalInputTokens ?? null) &&
    (hit.additionalOutputTokens ?? null) ===
      (params.budgetExtension.additionalOutputTokens ?? null) &&
    (hit.additionalTotalTokens ?? null) ===
      (params.budgetExtension.additionalTotalTokens ?? null) &&
    (hit.authorizedBy === undefined || hit.authorizedBy === params.actorId);

  return { matched: true, sameFingerprint };
}

@Injectable()
export class AssessmentRuntimeControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxRepository,
    private readonly lifecycle: AssessmentLifecycleCoordinator,
    // Why: Optional 4th dependency preserves 3-arg unit test instantiation while enabling
    // Nest DI to supply canonical `AuditWriterService` in runtime modules (`AuditModule` is @Global).
    @Optional() private readonly auditWriter?: AuditWriterService,
  ) {}

  async current(
    assessmentId: string,
  ): Promise<AssessmentRuntimeControlResult | null> {
    const runtime = await this.prisma.assessmentRuntime.findUnique({
      where: { assessmentId },
      select: {
        assessmentId: true,
        threadId: true,
        checkpointNamespace: true,
        currentExecutionId: true,
      },
    });
    if (!runtime || !runtime.currentExecutionId) return null;
    const row = await this.prisma.assessmentRuntimeTurn.findUnique({
      where: { id: runtime.currentExecutionId },
    });
    if (
      !row ||
      runtime.checkpointNamespace !== assessmentId ||
      row.assessmentId !== assessmentId ||
      row.threadId !== runtime.threadId
    ) {
      throw problemException(Problems.staleTarget, assessmentId, {
        status: HttpStatus.CONFLICT,
      });
    }
    return result(row);
  }

  /**
   * Business purpose: Request a cooperative stop or resume of an Assessment Root execution turn on its server-owned thread, including idempotent and version-fenced admin budget overrides.
   *
   * Business rules:
   * - Stop is accepted only when the current execution turn is running, and will pause at the next native checkpoint boundary.
   * - Resume is accepted only when the current execution is stopped and paused with valid snapshot and pins; every repository pinned to the assessment must still have its exact assessment-owned snapshot.
   * - A PAYMENT_REQUIRED pause can resume only after the owner-bound shared wallet has spendable balance in its authoritative accounting unit; payment itself never resumes work.
   * - Only `ADMIN` actors may supply `budgetExtension`; non-admins are rejected with `403 Forbidden`.
   * - Admin overrides carrying `idempotencyKey` replay cleanly on matching request fingerprints and fail with `409 IDEMPOTENCY_CONFLICT` on mutated fingerprints.
   * - If `expectedVersion` is supplied, it must match the current extension version (0 when none exists) or fail with `409 Conflict`; repeated extensions must have strictly increasing version numbers and append historical extensions to an immutable lineage array.
   * - Every committed admin budget override writes a canonical redacted `BUDGET_OVERRIDE_AUTHORIZED` `AuditEvent` atomically inside the same database transaction.
   *
   * Execution flow:
   * 1. Authorize the caller and load the canonical target runtime and current execution turn under pessimistic transaction lock.
   * 2. Enforce admin role for `budgetExtension` and evaluate `idempotencyKey` replay/conflict before turn-state short-circuits.
   * 3. Verify target run identity, turn state, boundary invariants, checkpoint/pin prerequisites, wallet solvency for payment pauses, `expectedVersion`, and strictly monotonic version progression.
   * 4. Persist the canonical `BUDGET_OVERRIDE_AUTHORIZED` `AuditEvent`, update `blockerReference`, transition turn state, and enqueue the `ROOT_REQUESTED` outbox command atomically.
   *
   * Failure cases:
   * - Non-admin `budgetExtension` throws `403 Forbidden`.
   * - Reused `idempotencyKey` with differing payload throws `409 ASSESSMENT_IDEMPOTENCY_CONFLICT`.
   * - Stale `expectedVersion`, stale extension version, stale target runs, invalid states, mismatched pins, open human blockers, or unextended budget exhaustion reject with `409 Conflict`.
   * - A missing or empty wallet on a PAYMENT_REQUIRED pause rejects Continue with `402 PAYMENT_REQUIRED` before an outbox command is created.
   *
   * Side effects:
   * - Atomically updates turn state, persists `blockerReference` extension lineage, writes canonical `AuditEvent`, and enqueues transactional outbox messages.
   */
  async request(input: {
    assessmentId: string;
    actor: RbacRequestContext;
    correlationId: string;
    action: AssessmentRuntimeControlAction;
    targetRunId?: string;
    responseLanguage?: string | null;
    budgetExtension?: AssessmentBudgetExtensionInput;
    idempotencyKey?: string;
    expectedVersion?: number;
  }): Promise<AssessmentRuntimeControlResult> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const { runtime, row } = await this.loadCanonicalTarget(
        tx,
        input.assessmentId,
        input.correlationId,
        input.actor,
      );

      // Why: Enforce admin authority immediately after target locking when `budgetExtension`
      // is present so non-admin callers cannot probe admin idempotency keys or state.
      // How: Rejects non-ADMIN roles with 403 Forbidden before loading or checking override history.
      // Invariants: Only `AUTH_USER_ROLES.admin` may submit budget overrides.
      if (input.budgetExtension && input.actor.role !== AUTH_USER_ROLES.admin) {
        throw problemException(
          SHARED_ERROR_CODES.forbidden,
          input.correlationId,
          { status: HttpStatus.FORBIDDEN },
        );
      }

      /**
       * Business purpose: Load locked assessment with attached runtime and ruleSet pins for execution control.
       * Business rules:
       * - Assessment must exist in database or throw not found.
       * - Includes domainCase and ruleSet relation pins for deterministic runtime orchestration.
       * Execution flow:
       * 1. Query assessment by id with runtime and domainCase.ruleSet relations.
       * 2. Return the attached assessment record.
       * Failure cases:
       * - Throws entity not found error if assessment does not exist.
       * Side effects:
       * - Read-only query within active database transaction.
       */
      const loadAssessmentWithPins = () =>
        tx.assessment.findUniqueOrThrow({
          where: { id: input.assessmentId },
          include: {
            runtime: true,
            domainCase: { include: { ruleSet: true } },
          },
        });
      let preloadedAssessment: Awaited<
        ReturnType<typeof loadAssessmentWithPins>
      > | null = null;
      let budgetRequestDigest: string | null = null;

      // Why: Idempotency replay/conflict for admin budget extensions MUST run before
      // turn-state short-circuits so retries return the original outcome even after the
      // turn has transitioned to RESUME_REQUESTED or completed, and conflicting payloads
      // always fail with 409 IDEMPOTENCY_CONFLICT rather than silently returning changed=false.
      // How: Computes a deterministic request digest, checks active and historical extensions
      // on `blockerReference`, and either replays or throws IDEMPOTENCY_CONFLICT.
      // Invariants: Replays perform zero writes (`AuditEvent`, `assessment`, `turn`, `outbox`).
      if (input.budgetExtension) {
        budgetRequestDigest = computeBudgetExtensionRequestDigest({
          assessmentId: input.assessmentId,
          actorId: input.actor.userId,
          targetRunId: input.targetRunId,
          budgetExtension: input.budgetExtension,
          expectedVersion: input.expectedVersion,
        });

        if (input.idempotencyKey) {
          preloadedAssessment = await loadAssessmentWithPins();
          const preloadedBlockerRef = (preloadedAssessment.blockerReference ??
            null) as Record<string, unknown> | null;
          const idempotencyMatch = findBudgetExtensionIdempotencyMatch({
            blockerRef: preloadedBlockerRef,
            idempotencyKey: input.idempotencyKey,
            requestDigest: budgetRequestDigest,
            actorId: input.actor.userId,
            budgetExtension: input.budgetExtension,
          });
          if (idempotencyMatch.matched) {
            if (!idempotencyMatch.sameFingerprint) {
              throw problemException(
                ASSESSMENT_DOMAIN_ERROR_CODES.IDEMPOTENCY_CONFLICT,
                input.correlationId,
                { status: HttpStatus.CONFLICT },
              );
            }
            if (input.targetRunId && input.targetRunId !== row.id) {
              const target = await tx.assessmentRuntimeTurn.findUnique({
                where: { id: input.targetRunId },
              });
              if (
                target?.assessmentId === input.assessmentId &&
                target.threadId === runtime.threadId
              ) {
                return { control: result(target), changed: false };
              }
            }
            return { control: result(row), changed: false };
          }
        }
      }

      if (input.targetRunId && input.targetRunId !== row.id) {
        const target = await tx.assessmentRuntimeTurn.findUnique({
          where: { id: input.targetRunId },
        });
        if (
          target?.assessmentId === input.assessmentId &&
          target.threadId === runtime.threadId
        ) {
          // Completion wins a late Stop. A duplicate Continue (without a fresh budgetExtension)
          // may arrive after its new native generation has already registered or completed.
          if (
            input.action === Actions.stop &&
            target.state === toDb(States.completed)
          )
            return { control: result(target), changed: false };
          if (
            !input.budgetExtension &&
            input.action === Actions.resume &&
            target.state === toDb(States.resumeRequested) &&
            target.logicalRunId === row.logicalRunId
          )
            return { control: result(row), changed: false };
        }
        throw problemException(Problems.staleTarget, input.correlationId, {
          status: HttpStatus.CONFLICT,
        });
      }
      const stop = input.action === Actions.stop;
      const expected = stop ? States.running : States.stopped;
      const requested = stop ? States.stopRequested : States.resumeRequested;
      // Why: Only non-override duplicate stop/continue calls may short-circuit on turn state;
      // an admin override with an unseen idempotencyKey must not silently report success on a non-stopped turn.
      if (
        !input.budgetExtension &&
        (row.state === toDb(requested) ||
          (stop && row.state === toDb(States.stopped)) ||
          row.state === toDb(States.completed))
      ) {
        return { control: result(row), changed: false };
      }
      if (row.state !== toDb(expected)) {
        throw problemException(Problems.notStopped, input.correlationId, {
          status: HttpStatus.CONFLICT,
        });
      }
      if (row.boundary !== ASSESSMENT_ROOT_BOUNDARY) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }

      const requestId = randomUUID();

      if (!stop) {
        const assessment =
          preloadedAssessment ?? (await loadAssessmentWithPins());
        if (
          (assessment.blockerReference as Record<string, unknown> | null)
            ?.reason === ASSESSMENT_BUDGET_REASONS.PAYMENT_REQUIRED
        ) {
          // Why: A top-up alone does not restart Assessment work, and whole-credit projections omit positive fractional microcredits.
          // How: Read the owner-bound wallet and apply its authoritative accounting unit before changing the turn or enqueueing work.
          // Invariant: Version 1 uses legacy credits, version 2 uses signed microcredits, and later admission still row-locks and rechecks.
          const wallet = await tx.billingWallet.findUnique({
            where: { userId: assessment.ownerId },
            select: {
              availableCredits: true,
              balanceMicrocredits: true,
              accountingUnitVersion: true,
            },
          });
          const hasSpendableBalance =
            wallet?.accountingUnitVersion === 2
              ? wallet.balanceMicrocredits > 0n
              : wallet?.accountingUnitVersion === 1
                ? wallet.availableCredits > 0n
                : false;
          if (!hasSpendableBalance) {
            throw problemException(
              BILLING_ERROR_CODES.paymentRequired,
              input.correlationId,
              { status: HttpStatus.PAYMENT_REQUIRED },
            );
          }
        }
        const pins = assessment.domainCase;
        const snapshot = pins?.repositorySnapshotId
          ? await tx.repositorySnapshot.findUnique({
              where: { id: pins.repositorySnapshotId },
            })
          : null;
        // Resume is allowed only when every pinned repository still has its exact, assessment-owned snapshot.
        const pinnedRepositories = pins
          ? await tx.assessmentCaseRepository.findMany({
              where: { assessmentId: input.assessmentId },
              select: { repositorySnapshotId: true, repositoryCommit: true },
            })
          : [];
        const otherPins = pinnedRepositories.filter(
          (pin) => pin.repositorySnapshotId !== pins?.repositorySnapshotId,
        );
        const otherSnapshots = otherPins.length
          ? await tx.repositorySnapshot.findMany({
              where: { id: { in: otherPins.map((pin) => pin.repositorySnapshotId) } },
            })
          : [];
        const otherPinsValid =
          otherSnapshots.length === otherPins.length &&
          otherPins.every((pin) => {
            const found = otherSnapshots.find(
              (item) => item.id === pin.repositorySnapshotId,
            );
            return (
              found?.assessmentId === input.assessmentId &&
              found.commitSha.toLowerCase() === pin.repositoryCommit.toLowerCase()
            );
          });
        if (
          assessment.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.PAUSED ||
          assessment.runtime?.executionState !==
            AGENT_EXECUTION_STATES.PAUSED ||
          !assessment.runtime.checkpointId ||
          !row.checkpointJson ||
          !pins?.ruleSetVersionId ||
          !pins.repositoryScanJobId ||
          !snapshot ||
          snapshot.assessmentId !== input.assessmentId ||
          snapshot.commitSha !== pins.repositoryCommit ||
          !otherPinsValid ||
          !pins.ruleSet ||
          ![
            ARTIFACT_LIFECYCLE_STATES.ACTIVE,
            ARTIFACT_LIFECYCLE_STATES.SUPERSEDED,
          ].some((state) => state === pins.ruleSet?.lifecycleState) ||
          (await tx.assessmentHumanRequest.count({
            where: {
              assessmentId: input.assessmentId,
              status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
            },
          }))
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.CHECKPOINT_INVALID,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }

        const blockerRef = (assessment.blockerReference ?? null) as Record<
          string,
          unknown
        > | null;

        const isBudgetExhausted =
          blockerRef &&
          (blockerRef.reason ===
            ASSESSMENT_BUDGET_REASONS.AGENT_BUDGET_REACHED ||
            blockerRef.reason === ASSESSMENT_BUDGET_REASONS.BUDGET_EXHAUSTED ||
            blockerRef.reason ===
              ASSESSMENT_BUDGET_REASONS.CALL_LIMIT_EXCEEDED ||
            blockerRef.reason ===
              ASSESSMENT_BUDGET_REASONS.TOKEN_LIMIT_EXCEEDED);

        const existingExtension =
          blockerRef?.budgetExtension &&
          typeof blockerRef.budgetExtension === "object"
            ? (blockerRef.budgetExtension as Record<string, unknown>)
            : null;

        const existingHistory = Array.isArray(
          blockerRef?.budgetExtensionHistory,
        )
          ? (blockerRef.budgetExtensionHistory as Array<
              Record<string, unknown>
            >)
          : existingExtension
            ? [existingExtension]
            : [];

        let activeExtension: Record<string, unknown> | null = null;
        let updatedHistory = existingHistory;

        if (input.budgetExtension) {
          const currentVersion =
            existingExtension && existingExtension.version !== undefined
              ? Number(existingExtension.version)
              : 0;
          // Why: Optimistic version fencing prevents concurrent admins from overwriting
          // or racing on budget overrides without observing the latest extension version.
          // How: Compares optional `expectedVersion` against `currentVersion` (0 if none exists).
          // Invariants: Rejects mismatch with 409 Conflict before any audit or state write.
          if (
            input.expectedVersion !== undefined &&
            input.expectedVersion !== currentVersion
          ) {
            throw problemException(
              ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
              input.correlationId,
              { status: HttpStatus.CONFLICT },
            );
          }

          if (existingExtension && existingExtension.version !== undefined) {
            const existingVersion = Number(existingExtension.version);
            if (input.budgetExtension.version <= existingVersion) {
              throw problemException(
                ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
                input.correlationId,
                { status: HttpStatus.CONFLICT },
              );
            }
          }
          // Why: Record explicit authority source (`ADMIN_OVERRIDE` default or `SYSTEM_COMPENSATION`)
          // without `overrideNoProgress` (retired per R2: NO_PROGRESS_LIMIT_EXCEEDED is not a blocker).
          // How: Derives `authorizedBy` and `authorizedAt` server-side from the authenticated actor,
          //      and retains `idempotencyKey` + `requestDigest` for replay/conflict detection.
          // Invariants: `PAYMENT` is never permitted as an extension source.
          const resolvedSource =
            input.budgetExtension.source ??
            ASSESSMENT_BUDGET_EXTENSION_SOURCES.adminOverride;
          activeExtension = {
            version: input.budgetExtension.version,
            source: resolvedSource,
            authorizedBy: input.actor.userId,
            authorizedAt: new Date().toISOString(),
            previousVersion: existingExtension
              ? (existingExtension.version ?? null)
              : null,
            auditReason: input.budgetExtension.auditReason,
            additionalModelCalls:
              input.budgetExtension.additionalModelCalls ?? null,
            additionalInputTokens:
              input.budgetExtension.additionalInputTokens ?? null,
            additionalOutputTokens:
              input.budgetExtension.additionalOutputTokens ?? null,
            additionalTotalTokens:
              input.budgetExtension.additionalTotalTokens ?? null,
            ...(input.idempotencyKey
              ? {
                  idempotencyKey: input.idempotencyKey,
                  requestDigest: budgetRequestDigest,
                }
              : {}),
          };
          if (
            existingExtension &&
            !existingHistory.some(
              (h) => h.version === existingExtension.version,
            )
          ) {
            updatedHistory = [...existingHistory, existingExtension];
          }
        } else if (existingExtension) {
          activeExtension = existingExtension;
        }

        if (
          isBudgetExhausted &&
          !activeExtension &&
          !blockerRef?.budgetExtended
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.BUDGET_EXHAUSTED,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }

        // Why: WP8 Contract 32 (`ASM-BUDGET-05`) mandates an atomic canonical AuditEvent
        // whenever an admin runtime budget override is committed.
        // How: Builds a canonical redacted event via `buildAuditEventInput` and persists via
        // `AuditWriterService.writeInTx` (or sanitized tx fallback in 3-arg unit tests) inside `$transaction`.
        // Invariants: Audit and blocker mutation commit or roll back atomically; payload is sanitized/redacted.
        if (input.budgetExtension && activeExtension) {
          await this.writeBudgetOverrideAuditInTx(tx, {
            assessmentId: input.assessmentId,
            actor: input.actor,
            correlationId: input.correlationId,
            causationId: requestId,
            targetRunId: input.targetRunId ?? row.id,
            version: activeExtension.version as number,
            previousVersion: activeExtension.previousVersion as number | null,
            source: activeExtension.source as string,
            auditReason: activeExtension.auditReason as string,
            idempotencyKey: input.idempotencyKey,
          });
        }

        if (blockerRef || activeExtension) {
          const updatedBlocker: Prisma.InputJsonValue = {
            reason: null,
            resumedAt: new Date().toISOString(),
            ...(activeExtension
              ? { budgetExtension: activeExtension as Prisma.InputJsonObject }
              : {}),
            ...(updatedHistory.length > 0
              ? {
                  budgetExtensionHistory:
                    updatedHistory as unknown as Prisma.InputJsonValue,
                }
              : {}),
            ...(blockerRef?.budgetExtended ? { budgetExtended: true } : {}),
          };
          await tx.assessment.update({
            where: { id: input.assessmentId },
            data: {
              blockerReference: updatedBlocker,
            },
          });
        }
      }
      const claimed = await tx.assessmentRuntimeTurn.updateMany({
        where: { id: row.id, state: toDb(expected) },
        data: { state: toDb(requested), requestId },
      });
      if (claimed.count === 0) {
        const latest = await tx.assessmentRuntimeTurn.findUniqueOrThrow({
          where: { id: row.id },
        });
        return { control: result(latest), changed: false };
      }
      // Stop is observed at the Root's next native checkpoint boundary. Resume is an
      // ordinary Root command on the server-owned thread, never an Interview continuation.
      if (!stop) {
        const responseLanguage = input.responseLanguage
          ? resolveResponseLanguage(input.responseLanguage)
          : undefined;
        await this.outbox.enqueue(
          buildOutboxMessageInput({
            aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
            aggregateId: input.assessmentId,
            assessmentId: input.assessmentId,
            eventType: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
            correlationId: input.correlationId,
            causationId: requestId,
            actor: { id: input.actor.userId, type: AUDIT_ACTOR_TYPES.user },
            result: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
            redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
            idempotencyKey: `root-resume:${row.id}:${requestId}`,
            payload: {
              assessmentId: input.assessmentId,
              ...(responseLanguage ? { responseLanguage } : {}),
            },
          }),
          tx,
        );
        if (responseLanguage) {
          await tx.assessmentRuntimeTurn.updateMany({
            where: { id: row.id },
            data: {
              contextJson: {
                ...(typeof row.contextJson === "object" &&
                row.contextJson !== null
                  ? (row.contextJson as Record<string, unknown>)
                  : {}),
                responseLanguage,
              },
            },
          });
        }
      }
      return {
        control: { state: requested, targetRunId: row.id, requestId },
        changed: true,
      };
    });
    return outcome.control;
  }

  /**
   * Business purpose: Load and validate the canonical runtime target for assessment
   * control operations while enforcing tenant boundaries and preventing execution stale states.
   *
   * Business rules:
   * - Actor must own the assessment or hold an admin role. Non-admin cross-tenant attempts
   *   fail closed with a 404 NOT_FOUND response.
   * - Assessment runtime must have an active current execution registered.
   * - Runtime turn namespace and thread identifiers must strictly match the canonical assessment.
   *
   * Execution flow:
   * 1. Acquire pessimistic row locks on assessment and assessment runtime records.
   * 2. Verify actor ownership if actor does not possess administrative privileges.
   * 3. Confirm active currentExecutionId exists on the canonical runtime record.
   * 4. Query and validate that runtime turn belongs to this assessment thread and namespace.
   * 5. Return validated runtime and turn row records to caller.
   *
   * Failure cases:
   * - Missing assessment or runtime throws 409 CONFLICT (staleTarget).
   * - Ownership violation throws 404 NOT_FOUND (ASSESSMENT_ERROR_CODES.notFound).
   * - Missing or mismatched runtime turn throws 409 CONFLICT (staleTarget).
   *
   * Side effects:
   * - Read-only query execution within caller's transactional lock boundary; no state mutations.
   */
  private async loadCanonicalTarget(
    tx: Prisma.TransactionClient,
    assessmentId: string,
    correlationId: string,
    actor: RbacRequestContext,
  ) {
    const { assessment, runtime } =
      await this.lockCanonicalAssessmentAndRuntime(
        tx,
        assessmentId,
        correlationId,
        actor,
      );
    if (
      actor.role !== AUTH_USER_ROLES.admin &&
      assessment.ownerId !== actor.userId
    ) {
      throw problemException(ASSESSMENT_ERROR_CODES.notFound, correlationId, {
        status: HttpStatus.NOT_FOUND,
      });
    }
    if (!runtime.currentExecutionId) {
      throw problemException(Problems.staleTarget, correlationId, {
        status: HttpStatus.CONFLICT,
      });
    }
    const row = await tx.assessmentRuntimeTurn.findUnique({
      where: { id: runtime.currentExecutionId },
    });
    if (
      !row ||
      runtime.checkpointNamespace !== assessmentId ||
      row.assessmentId !== assessmentId ||
      row.threadId !== runtime.threadId
    ) {
      throw problemException(Problems.staleTarget, correlationId, {
        status: HttpStatus.CONFLICT,
      });
    }
    return { runtime, row };
  }

  /**
   * Business purpose: Acquire pessimistic row-level locks on the assessment and runtime records
   * while enforcing tenant-scoped row locks to prevent cross-tenant Row-Lock DoS vulnerabilities.
   *
   * Business rules:
   * - Non-admin actors must only lock assessment rows matching their own userId.
   * - Admin actors are permitted to lock assessment rows across any tenant boundary.
   * - The target assessment and runtime rows must both exist; missing records reject the transaction.
   *
   * Execution flow:
   * 1. Construct tenant-filtering SQL clause based on caller role.
   * 2. Execute raw SELECT ... FOR UPDATE query on Assessment table.
   * 3. If no row matches, reject immediately before taking locks on downstream records.
   * 4. Execute raw SELECT ... FOR UPDATE query on AssessmentRuntime table.
   * 5. Fetch canonical AssessmentRuntime record and return both records.
   *
   * Failure cases:
   * - Non-existent assessment or cross-tenant target throws 409 CONFLICT (staleTarget).
   * - Non-existent runtime row throws 409 CONFLICT (staleTarget).
   *
   * Side effects:
   * - Acquires exclusive pessimistic row locks (FOR UPDATE) within the current transaction.
   */
  private async lockCanonicalAssessmentAndRuntime(
    tx: Prisma.TransactionClient,
    assessmentId: string,
    correlationId: string,
    actor: RbacRequestContext,
  ) {
    // 1. Inspect assessment existence and ownership without row lock first.
    // This allows returning 404 Not Found for cross-tenant calls while completely preventing
    // cross-tenant Row-Lock Denial of Service (attacker cannot lock victim's row).
    const unreservedRows = await tx.$queryRaw<
      Array<{ id: string; ownerId: string }>
    >(
      Prisma.sql`SELECT "id", "ownerId" FROM "Assessment" WHERE "id" = ${assessmentId}`,
    );
    if (!unreservedRows[0]) {
      // Stale or deleted target returns 409 Conflict per canonical runtime control contract.
      throw problemException(Problems.staleTarget, correlationId, {
        status: HttpStatus.CONFLICT,
      });
    }
    if (
      actor.role !== AUTH_USER_ROLES.admin &&
      unreservedRows[0].ownerId !== actor.userId
    ) {
      // Cross-tenant access fails closed with 404 Not Found without holding any row locks.
      throw problemException(ASSESSMENT_ERROR_CODES.notFound, correlationId, {
        status: HttpStatus.NOT_FOUND,
      });
    }

    // 2. Once tenant ownership is verified, acquire pessimistic row locks on Assessment and AssessmentRuntime.
    const assessmentRows = await tx.$queryRaw<
      Array<{ id: string; ownerId: string }>
    >(
      Prisma.sql`SELECT "id", "ownerId" FROM "Assessment"
        WHERE "id" = ${assessmentId} FOR UPDATE`,
    );
    if (!assessmentRows[0]) {
      throw problemException(Problems.staleTarget, correlationId, {
        status: HttpStatus.CONFLICT,
      });
    }
    const runtimeRows = await tx.$queryRaw<Array<{ assessmentId: string }>>(
      Prisma.sql`SELECT "assessmentId" FROM "AssessmentRuntime"
        WHERE "assessmentId" = ${assessmentId} FOR UPDATE`,
    );
    if (!runtimeRows[0]) {
      throw problemException(Problems.staleTarget, correlationId, {
        status: HttpStatus.CONFLICT,
      });
    }
    const runtime = await tx.assessmentRuntime.findUnique({
      where: { assessmentId },
      select: {
        assessmentId: true,
        threadId: true,
        checkpointNamespace: true,
        currentExecutionId: true,
      },
    });
    if (!runtime) {
      throw problemException(Problems.staleTarget, correlationId, {
        status: HttpStatus.CONFLICT,
      });
    }
    return { assessment: assessmentRows[0], runtime };
  }

  /**
   * Business purpose: Persist a canonical, redacted `BUDGET_OVERRIDE_AUTHORIZED` audit event atomically inside the caller's database transaction.
   *
   * Business rules:
   * - Every admin budget override must record actor, assessment resource, authority source (`reasonCode`), `auditReason`, version lineage, `schemaVersion: "audit.event.v1"`, and `redactionStatus: REDACTED`.
   * - When an `idempotencyKey` is provided, the deterministic audit key `budget-override:<assessmentId>:<idempotencyKey>` prevents duplicate audit rows across retries.
   *
   * Execution flow:
   * 1. Construct the canonical `AuditEventInput` envelope using `buildAuditEventInput`.
   * 2. If `AuditWriterService` is injected, delegate to `auditWriter.writeInTx(auditInput, tx)`.
   * 3. Otherwise (3-arg unit-test instantiation), sanitize the payload with `AuditSanitizer.sanitize`, derive deterministic `id` when `idempotencyKey` is present, and persist via `tx.auditEvent.upsert` (if available) or `tx.auditEvent.create`.
   *
   * Failure cases:
   * - Persistence errors propagate directly so the enclosing `$transaction` rolls back both the audit write and the budget extension mutation.
   *
   * Side effects:
   * - Inserts or idempotently upserts one canonical `AuditEvent` row within `tx`.
   */
  private async writeBudgetOverrideAuditInTx(
    tx: Prisma.TransactionClient,
    params: {
      assessmentId: string;
      actor: RbacRequestContext;
      correlationId: string;
      causationId: string;
      targetRunId: string;
      version: number;
      previousVersion: number | null;
      source: string;
      auditReason: string;
      idempotencyKey?: string;
    },
  ): Promise<void> {
    const auditInput = buildAuditEventInput({
      ...(params.idempotencyKey
        ? {
            idempotencyKey: `budget-override:${params.assessmentId}:${params.idempotencyKey}`,
          }
        : {}),
      eventType: ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES.BUDGET_OVERRIDE_AUTHORIZED,
      actorId: params.actor.userId,
      sessionId: params.actor.sessionId ?? null,
      assessmentId: params.assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.assessment,
      resourceId: params.assessmentId,
      correlationId: params.correlationId,
      causationId: params.causationId,
      decision: AUDIT_DECISIONS.allow,
      reasonCode: params.source,
      result: params.source,
      redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
      actor: {
        id: params.actor.userId,
        type: AUDIT_ACTOR_TYPES.user,
      },
      payload: {
        assessmentId: params.assessmentId,
        targetRunId: params.targetRunId,
        version: params.version,
        previousVersion: params.previousVersion,
        source: params.source,
        auditReason: params.auditReason,
        ...(params.idempotencyKey
          ? { idempotencyKey: params.idempotencyKey }
          : {}),
      },
    });

    if (this.auditWriter) {
      await this.auditWriter.writeInTx(auditInput, tx);
      return;
    }

    // Fallback for 3-arg unit test instantiation where AuditWriterService is omitted.
    const { payload: sanitizedPayload } = AuditSanitizer.sanitize(
      auditInput.payload,
    );
    const id = auditInput.idempotencyKey
      ? `audit:${createHash("sha256").update(auditInput.idempotencyKey).digest("hex")}`
      : randomUUID();
    const auditData = {
      id,
      eventType: auditInput.eventType,
      actorId: auditInput.actorId,
      sessionId: auditInput.sessionId ?? null,
      correlationId: auditInput.correlationId,
      resourceType: auditInput.resourceType
        ? toPrismaAuditResourceType(auditInput.resourceType)
        : null,
      resourceId: auditInput.resourceId ?? null,
      decision: auditInput.decision
        ? toPrismaAuthDecision(auditInput.decision)
        : null,
      reasonCode: auditInput.reasonCode ?? null,
      payload: (sanitizedPayload ??
        auditInput.payload ??
        {}) as unknown as Prisma.InputJsonValue,
    };

    if (
      auditInput.idempotencyKey &&
      typeof tx.auditEvent?.upsert === "function"
    ) {
      await tx.auditEvent.upsert({
        where: { id },
        update: {},
        create: auditData,
      });
    } else {
      await tx.auditEvent.create({ data: auditData });
    }
  }
}
