import { randomUUID } from "node:crypto";
import { validateFrozenInventory } from "../../domain/claim-inventory.js";
import { frozenInventoryForRun } from "./preparation-inventory.persistence.js";

import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { AGENTIC_TOOL_STATUSES } from "@lcsp/contracts/evidence";
import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  COMPLIANCE_RULE_SET_EVENT_TYPES,
  type ComplianceRuleSetPacket,
  type ComplianceRuleSetSubmitResult,
  type ComplianceRuleSetValidationFailure,
} from "@lcsp/contracts/compliance-rule-set";
import type { LegalRuleActivationResult } from "@lcsp/contracts/legal-rule-catalog";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { HttpStatus, Injectable } from "@nestjs/common";
import {
  Prisma,
  PreparationTargetActivityScope,
  ClaimPreparationPhase,
  AgentExecutionState as PrismaAgentExecutionState,
  ArtifactLifecycleState as PrismaArtifactLifecycleState,
  RuleSetPreparationFailureReason as PrismaRuleSetPreparationFailureReason,
  ComplianceRuleSetValidationOutcome as PrismaValidationOutcome,
} from "@prisma/client";

import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import {
  canonicalJson,
  sha256Hex,
  sourceClaimKey,
  type LegalSourceChunkSnapshot,
} from "../../domain/compliance-rule-set-integrity.validator.js";
import { toSubmitResult } from "./compliance-rule-set.mappers.js";
import { writeSemanticGraph } from "./semantic-graph.persistence.js";
import { LegalSourceAuthorityService } from "../../../legal-source/application/services/legal-source-authority.service.js";
import { requireApprovedDevelopmentScope } from "./approved-development-scope.js";

const RULE_SET_SERVICE = "compliance-rule-set-service";

/** Same transaction-scoped advisory lock pattern as the legalSource lifecycle lock. */
export async function acquireComplianceRuleSetActivationLock(
  tx: Prisma.TransactionClient,
): Promise<void> {
  let acquired = false;
  while (!acquired) {
    const result = await tx.$queryRaw<Array<{ acquired: boolean }>>(
      Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtext('lcsp:compliance-rule-set-activation')) AS acquired`,
    );
    acquired = result[0]?.acquired === true;
    if (!acquired) await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export interface SubmitContext {
  runId: string;
  idempotencyKey: string;
  requestDigest: string;
  ruleSetDigest: string;
  packet: ComplianceRuleSetPacket;
  failures: ComplianceRuleSetValidationFailure[];
  resolved: Map<string, LegalSourceChunkSnapshot>;
  legalSource: { id: string; version: string };
  correlationId: string;
}

export interface SelectedActivationContext {
  idempotencyKey: string;
  requestDigest: string;
  ruleSetDigest: string;
  packet: ComplianceRuleSetPacket;
  resolved: Map<string, LegalSourceChunkSnapshot>;
  legalSource: { id: string; version: string };
  selectedPreparationResults: Array<{
    ruleId: string;
    resultId: string;
    revision: number;
    inputFingerprint: string;
    outputDigest: string;
  }>;
  correlationId: string;
}

/**
 * The atomic activation transaction body: idempotent replay detection, rule set + children
 * persistence, previous-ACTIVE supersession, outbox and audit. Only the submit handler drives it.
 */
@Injectable()
export class ComplianceRuleSetActivation {
  constructor(
    private readonly outboxRepository: OutboxRepository,
    private readonly auditWriter: AuditWriterService,
    private readonly authority: LegalSourceAuthorityService = new LegalSourceAuthorityService(),
  ) {}

  async findReplay(
    client: Prisma.TransactionClient,
    idempotencyKey: string,
    runId: string,
    requestDigest: string,
    correlationId: string,
  ): Promise<ComplianceRuleSetSubmitResult | null> {
    const record = await client.complianceRuleSetActivationRecord.findUnique({
      where: { idempotencyKey },
      include: { ruleSet: true },
    });
    if (record) {
      if (
        record.preparationRunId !== runId ||
        record.requestDigest !== requestDigest
      ) {
        throw problemException(
          COMPLIANCE_RULE_SET_ERROR_CODES.idempotencyConflict,
          correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      return toSubmitResult({
        runId,
        ruleSet: record.ruleSet,
        activationRecordId: record.id,
        failures:
          record.validationFailures as unknown as ComplianceRuleSetValidationFailure[],
        previousActiveRuleSetVersionId: record.previousActiveRuleSetVersionId,
        replayed: true,
      });
    }
    const consumed = await client.complianceRuleSetVersion.findUnique({
      where: { preparationRunId: runId },
      select: { id: true },
    });
    if (consumed) {
      throw problemException(
        COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    return null;
  }

  /**
   * Business purpose: Atomically record one submitted Rule Set validation outcome and activate it only when all gates pass.
   *
   * Business rules:
   * - The Preparation row lock serializes submission with cancellation, inventory reopening, and other publication attempts.
   * - A matching activation record is replayed; the same idempotency key with different run/request digest conflicts.
   * - A clean packet must still match the frozen inventory, persisted direct draft, and SUBMISSION_READY phase after locking.
   * - New passing publications must bind the product-approved official original corpus.
   * - A failed packet is recorded as INVALID and cannot supersede the current ACTIVE version; a passing packet becomes ACTIVE and supersedes the prior version.
   *
   * Execution flow:
   * 1. Lock and load the Preparation, then return a matching committed replay if one exists.
   * 2. Require a running, unconsumed run and recheck frozen inventory, draft, and phase before publication.
   * 3. Acquire the shared activation lock, create the version and passing child records where applicable, and settle the run.
   * 4. Persist the activation record, outbox event, and audit decision in the same transaction, then return the submission result.
   *
   * Failure cases:
   * - Missing or terminal/consumed runs and conflicting replays return typed problems. Existing validation failures, including stale inventory/draft failures, are recorded as INVALID/FAILED; a clean packet that fails the post-lock inventory/draft/phase recheck is rejected as a concurrency conflict.
   * - Database, outbox, child-write, and audit failures abort the transaction so lifecycle and evidence records cannot partially commit.
   *
   * Side effects:
   * - Writes the Rule Set version, Preparation lifecycle, activation record, outbox and audit transactionally. Child records and the active-pointer change occur only for a passing submission.
   */
  async commit(
    tx: Prisma.TransactionClient,
    ctx: SubmitContext,
    actorId: string,
  ): Promise<ComplianceRuleSetSubmitResult> {
    const [preparation] = await tx.$queryRaw<
      Array<{
        executionState: PrismaAgentExecutionState;
        claimInventoryRevision: number;
        claimPhase: ClaimPreparationPhase;
        executionContract: import("@prisma/client").PreparationExecutionContract;
        targetActivityScope: import("@prisma/client").PreparationTargetActivityScope;
      }>
    >(
      Prisma.sql`SELECT "executionState", "claimInventoryRevision", "claimPhase", "executionContract", "targetActivityScope" FROM "RuleSetPreparationRun" WHERE "id" = ${ctx.runId} FOR UPDATE`,
    );
    if (!preparation) {
      throw problemException(
        COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunNotFound,
        ctx.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const replay = await this.findReplay(
      tx,
      ctx.idempotencyKey,
      ctx.runId,
      ctx.requestDigest,
      ctx.correlationId,
    );
    if (replay) return replay;

    if (preparation.executionState !== PrismaAgentExecutionState.RUNNING) {
      throw problemException(
        COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
        ctx.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    // Reopening and publication serialize on the same row; a pre-lock validation cannot publish stale claims.
    const inventoryGaps = validateFrozenInventory(
      ctx.packet,
      await frozenInventoryForRun(
        tx,
        ctx.runId,
        preparation.claimInventoryRevision,
      ),
      preparation.claimInventoryRevision,
    );
    if (
      ctx.failures.length === 0 &&
      (inventoryGaps.length ||
        !(await matchesPersistedDirectDraft(
          tx,
          { id: ctx.runId, ...preparation },
          ctx.packet,
        )) ||
        preparation.claimPhase !== ClaimPreparationPhase.SUBMISSION_READY)
    )
      throw problemException(
        COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
        ctx.correlationId,
        {
          status: HttpStatus.CONFLICT,
          meta: { gaps: inventoryGaps.map((g) => g.code).join(",") },
        },
      );

    // Recompute human-reviewed projection after the run lock: a stale
    // approval can NEVER publish an incomplete Development catalog.
    await requireApprovedDevelopmentScope(
      tx,
      ctx.runId,
      preparation.claimInventoryRevision,
      ctx.legalSource.id,
      preparation.targetActivityScope,
      ctx.correlationId,
      ctx.packet,
    );

    // Source admission is independent of the activity-scope proof; never publish a new version from a foreign corpus.
    if (ctx.failures.length === 0) {
      await this.authority.requireVersion(
        tx,
        ctx.legalSource.id,
        ctx.correlationId,
      );
    }
    // Cancel and publication serialize on the preparation row; only one can become terminal.
    await acquireComplianceRuleSetActivationLock(tx);

    const valid = ctx.failures.length === 0;
    const previousActive = await tx.complianceRuleSetVersion.findFirst({
      where: { lifecycleState: PrismaArtifactLifecycleState.ACTIVE },
      select: { id: true },
    });
    const ordinal =
      (await tx.complianceRuleSetVersion.count({
        where: { legalSourceVersionId: ctx.legalSource.id },
      })) + 1;
    const version = `${ctx.legalSource.version}.p${ordinal}`;
    const now = new Date();
    const ruleSetId = randomUUID();
    const activationRecordId = randomUUID();

    if (valid && previousActive) {
      await tx.complianceRuleSetVersion.update({
        where: { id: previousActive.id },
        data: {
          lifecycleState: PrismaArtifactLifecycleState.SUPERSEDED,
          supersededAt: now,
        },
      });
    }

    const ruleSet = await tx.complianceRuleSetVersion.create({
      data: {
        id: ruleSetId,
        version,
        legalSourceVersionId: ctx.legalSource.id,
        preparationRunId: ctx.runId,
        targetActivityScope: preparation.targetActivityScope,
        lifecycleState: valid
          ? PrismaArtifactLifecycleState.ACTIVE
          : PrismaArtifactLifecycleState.INVALID,
        ruleSetDigest: ctx.ruleSetDigest,
        validationOutcome: valid
          ? PrismaValidationOutcome.PASSED
          : PrismaValidationOutcome.FAILED,
        validationFailures: ctx.failures,
        validatedAt: now,
        activatedAt: valid ? now : null,
      },
    });
    if (valid) {
      await this.writeChildren(tx, ruleSet.id, ctx);
      await this.enqueueAuthoredDocuments(tx, ruleSet.id);
      if (
        ruleSet.targetActivityScope ===
        PreparationTargetActivityScope.DEVELOPMENT_ONLY
      ) {
        const { materializeGroupingProposal } =
          await import("./rule-catalog-groups.service.js");
        await materializeGroupingProposal(
          tx,
          ruleSet.id,
          ruleSet.ruleSetDigest,
        );
      }
    }

    await tx.ruleSetPreparationRun.update({
      where: { id: ctx.runId },
      data: valid
        ? {
            executionState: PrismaAgentExecutionState.SUCCEEDED,
            claimPhase: ClaimPreparationPhase.COMPLETION,
            completedAt: now,
          }
        : {
            executionState: PrismaAgentExecutionState.FAILED,
            failureReason:
              PrismaRuleSetPreparationFailureReason.RULE_SET_VALIDATION_FAILED,
            completedAt: now,
          },
    });

    const eventType = valid
      ? COMPLIANCE_RULE_SET_EVENT_TYPES.ruleSetActivated
      : COMPLIANCE_RULE_SET_EVENT_TYPES.ruleSetValidationFailed;
    const outboxEventId = await this.outboxRepository.enqueue(
      buildOutboxMessageInput({
        aggregateType: OUTBOX_AGGREGATE_TYPES.complianceRuleSetVersion,
        aggregateId: ruleSet.id,
        eventType,
        correlationId: ctx.correlationId,
        causationId: activationRecordId,
        actor: { id: RULE_SET_SERVICE, type: AUDIT_ACTOR_TYPES.system },
        result: valid
          ? AGENTIC_TOOL_STATUSES.ready
          : AGENTIC_TOOL_STATUSES.failed,
        redactionStatus: AUDIT_REDACTION_STATUSES.none,
        idempotencyKey: `${ruleSet.id}:${ctx.idempotencyKey}`,
        payload: {
          ruleSetVersionRef: `compliance-rule-set:${ruleSet.id}`,
          activationRecordRef: `compliance-rule-set-activation:${activationRecordId}`,
          legalSourceVersionRef: `legal-source-version:${ctx.legalSource.id}`,
          previousActiveRuleSetRef:
            valid && previousActive
              ? `compliance-rule-set:${previousActive.id}`
              : null,
          ruleSetDigest: ctx.ruleSetDigest,
          failureReasons: [
            ...new Set(ctx.failures.map((failure) => failure.code)),
          ],
        },
      }),
      tx,
    );

    await tx.complianceRuleSetActivationRecord.create({
      data: {
        id: activationRecordId,
        ruleSetVersionId: ruleSet.id,
        preparationRunId: ctx.runId,
        idempotencyKey: ctx.idempotencyKey,
        requestDigest: ctx.requestDigest,
        validationOutcome: valid
          ? PrismaValidationOutcome.PASSED
          : PrismaValidationOutcome.FAILED,
        validationFailures: ctx.failures,
        previousActiveRuleSetVersionId: valid
          ? (previousActive?.id ?? null)
          : null,
        outboxEventId,
        correlationId: ctx.correlationId,
      },
    });

    await this.auditWriter.writeInTx(
      {
        eventType,
        actorId,
        actor: { id: actorId, type: AUDIT_ACTOR_TYPES.service },
        resourceType: AUDIT_RESOURCE_TYPES.complianceRuleSetVersion,
        resourceId: ruleSet.id,
        decision: valid ? AUDIT_DECISIONS.allow : AUDIT_DECISIONS.deny,
        correlationId: ctx.correlationId,
        redactionStatus: AUDIT_REDACTION_STATUSES.none,
        payload: {
          ruleSetVersionRef: `compliance-rule-set:${ruleSet.id}`,
          activationRecordRef: `compliance-rule-set-activation:${activationRecordId}`,
          outboxEventRef: `outbox:${outboxEventId}`,
          manualApprovalRequired: false,
          failureReasons: [
            ...new Set(ctx.failures.map((failure) => failure.code)),
          ].join(","),
          idempotencyKey: ctx.idempotencyKey,
        },
      },
      tx,
    );

    return toSubmitResult({
      runId: ctx.runId,
      ruleSet,
      activationRecordId,
      failures: ctx.failures,
      previousActiveRuleSetVersionId: valid
        ? (previousActive?.id ?? null)
        : null,
      replayed: false,
    });
  }

  /**
   * Business purpose: Publish only Admin-selected, persisted LegalRule results as the single ACTIVE Rule Set without inventing a full-source Preparation.
   *
   * Business rules:
   * - The caller must validate current successful result revisions, source pins, and the combined packet in the same transaction before calling this method.
   * - New selected publications also require the approved official original corpus, even if a caller already validated the packet.
   * - The selected-result manifest is immutable provenance; the shared advisory lock and partial unique index preserve one ACTIVE Rule Set.
   * - Publication and replacement of the prior ACTIVE version, child rows, audit, and outbox commit atomically.
   *
   * Execution flow:
   * 1. Replay a matching prior idempotency request or reject a changed request digest.
   * 2. Acquire the shared activation lock and recheck replay after concurrent publishers finish.
   * 3. Supersede the current ACTIVE version, persist the validated packet and exact selected-result manifest, then write children and audit/outbox records.
   *
   * Failure cases:
   * - A reused key with a different digest conflicts; any child, audit, outbox, or database failure aborts the caller transaction and retains the prior ACTIVE version.
   *
   * Side effects:
   * - Creates one ACTIVE ComplianceRuleSetVersion and activation record; does not mutate any selected PreparationRun or rerun AI.
   */
  async commitSelected(
    tx: Prisma.TransactionClient,
    ctx: SelectedActivationContext,
    actorId: string,
  ): Promise<LegalRuleActivationResult> {
    const replay = await this.findSelectedReplay(
      tx,
      ctx.idempotencyKey,
      ctx.requestDigest,
      ctx.correlationId,
    );
    if (replay) return replay;

    await acquireComplianceRuleSetActivationLock(tx);
    const lockedReplay = await this.findSelectedReplay(
      tx,
      ctx.idempotencyKey,
      ctx.requestDigest,
      ctx.correlationId,
    );
    if (lockedReplay) return lockedReplay;

    // Recheck admission after acquiring the publication lock; a historical replay is unchanged.
    await this.authority.requireVersion(
      tx,
      ctx.legalSource.id,
      ctx.correlationId,
    );
    const previousActive = await tx.complianceRuleSetVersion.findFirst({
      where: { lifecycleState: PrismaArtifactLifecycleState.ACTIVE },
      select: { id: true },
    });
    const ordinal =
      (await tx.complianceRuleSetVersion.count({
        where: { legalSourceVersionId: ctx.legalSource.id },
      })) + 1;
    const now = new Date();
    const ruleSetId = randomUUID();
    const activationRecordId = randomUUID();
    const manifest =
      ctx.selectedPreparationResults as unknown as Prisma.InputJsonValue;

    if (previousActive) {
      await tx.complianceRuleSetVersion.update({
        where: { id: previousActive.id },
        data: {
          lifecycleState: PrismaArtifactLifecycleState.SUPERSEDED,
          supersededAt: now,
        },
      });
    }

    const ruleSet = await tx.complianceRuleSetVersion.create({
      data: {
        id: ruleSetId,
        version: `${ctx.legalSource.version}.p${ordinal}`,
        legalSourceVersionId: ctx.legalSource.id,
        preparationRunId: null,
        selectedPreparationResults: manifest,
        targetActivityScope: PreparationTargetActivityScope.FULL_SOURCE,
        lifecycleState: PrismaArtifactLifecycleState.ACTIVE,
        ruleSetDigest: ctx.ruleSetDigest,
        validationOutcome: PrismaValidationOutcome.PASSED,
        validationFailures: [],
        validatedAt: now,
        activatedAt: now,
      },
    });

    await this.writeChildren(tx, ruleSet.id, ctx, false);
    await this.enqueueAuthoredDocuments(tx, ruleSet.id);

    const outboxEventId = await this.outboxRepository.enqueue(
      buildOutboxMessageInput({
        aggregateType: OUTBOX_AGGREGATE_TYPES.complianceRuleSetVersion,
        aggregateId: ruleSet.id,
        eventType: COMPLIANCE_RULE_SET_EVENT_TYPES.ruleSetActivated,
        correlationId: ctx.correlationId,
        causationId: activationRecordId,
        actor: { id: actorId, type: AUDIT_ACTOR_TYPES.user },
        result: AGENTIC_TOOL_STATUSES.ready,
        redactionStatus: AUDIT_REDACTION_STATUSES.none,
        idempotencyKey: `${ruleSet.id}:${ctx.idempotencyKey}`,
        payload: {
          ruleSetVersionRef: `compliance-rule-set:${ruleSet.id}`,
          activationRecordRef: `compliance-rule-set-activation:${activationRecordId}`,
          legalSourceVersionRef: `legal-source-version:${ctx.legalSource.id}`,
          previousActiveRuleSetRef: previousActive
            ? `compliance-rule-set:${previousActive.id}`
            : null,
          ruleSetDigest: ctx.ruleSetDigest,
          selectedResultCount: ctx.selectedPreparationResults.length,
          assessmentRuleCount: ctx.packet.assessmentRules.length,
          failureReasons: [],
        },
      }),
      tx,
    );

    await tx.complianceRuleSetActivationRecord.create({
      data: {
        id: activationRecordId,
        ruleSetVersionId: ruleSet.id,
        preparationRunId: null,
        selectedPreparationResults: manifest,
        idempotencyKey: ctx.idempotencyKey,
        requestDigest: ctx.requestDigest,
        validationOutcome: PrismaValidationOutcome.PASSED,
        validationFailures: [],
        previousActiveRuleSetVersionId: previousActive?.id ?? null,
        outboxEventId,
        correlationId: ctx.correlationId,
      },
    });

    await this.auditWriter.writeInTx(
      {
        eventType: COMPLIANCE_RULE_SET_EVENT_TYPES.ruleSetActivated,
        actorId,
        actor: { id: actorId, type: AUDIT_ACTOR_TYPES.user },
        resourceType: AUDIT_RESOURCE_TYPES.complianceRuleSetVersion,
        resourceId: ruleSet.id,
        decision: AUDIT_DECISIONS.allow,
        correlationId: ctx.correlationId,
        redactionStatus: AUDIT_REDACTION_STATUSES.none,
        payload: {
          ruleSetVersionRef: `compliance-rule-set:${ruleSet.id}`,
          activationRecordRef: `compliance-rule-set-activation:${activationRecordId}`,
          outboxEventRef: `outbox:${outboxEventId}`,
          selectedResultCount: ctx.selectedPreparationResults.length,
          assessmentRuleCount: ctx.packet.assessmentRules.length,
          idempotencyKey: ctx.idempotencyKey,
        },
      },
      tx,
    );

    return {
      activationRecordId,
      ruleSetVersionId: ruleSet.id,
      version: ruleSet.version,
      assessmentRuleCount: ctx.packet.assessmentRules.length,
      selectedResultCount: ctx.selectedPreparationResults.length,
      previousActiveRuleSetVersionId: previousActive?.id ?? null,
      replayed: false,
    };
  }

  /**
   * Business purpose: Return one committed selected-result publication for an idempotent retry.
   *
   * Business rules:
   * - A key belongs to exactly one request digest and must identify selected-result provenance rather than a full Preparation submission.
   *
   * Execution flow:
   * 1. Load the activation record and its immutable Rule Set version.
   * 2. Compare publication digest and derive counts from persisted rows and manifest.
   *
   * Failure cases:
   * - Reused keys with changed content or a different publication kind return the standard idempotency conflict.
   *
   * Side effects:
   * - Read-only lookup; no publication or lifecycle state is changed.
   */
  private async findSelectedReplay(
    client: Prisma.TransactionClient,
    idempotencyKey: string,
    requestDigest: string,
    correlationId: string,
  ): Promise<LegalRuleActivationResult | null> {
    const record = await client.complianceRuleSetActivationRecord.findUnique({
      where: { idempotencyKey },
      include: {
        ruleSet: { include: { _count: { select: { assessmentRules: true } } } },
      },
    });
    if (!record) return null;
    if (
      record.preparationRunId !== null ||
      record.requestDigest !== requestDigest ||
      !Array.isArray(record.selectedPreparationResults)
    )
      throw problemException(
        COMPLIANCE_RULE_SET_ERROR_CODES.idempotencyConflict,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    return {
      activationRecordId: record.id,
      ruleSetVersionId: record.ruleSet.id,
      version: record.ruleSet.version,
      assessmentRuleCount: record.ruleSet._count.assessmentRules,
      selectedResultCount: record.selectedPreparationResults.length,
      previousActiveRuleSetVersionId: record.previousActiveRuleSetVersionId,
      replayed: true,
    };
  }

  /**
   * Business purpose: Persist the validated legal graph, Requirements, AssessmentRules, and their provenance beneath a passing Rule Set version.
   *
   * Business rules:
   * - Every source reference must resolve through the server-validated chunk map; missing resolution aborts the surrounding activation transaction.
   * - Requirement and claim bindings, source provenance, AssessmentRule parents, and context relations preserve the submitted packet's validated structure and source digest.
   * - Child records are written only for a passing version; this method does not interpret legal meaning or change submitted statements.
   *
   * Execution flow:
   * 1. Require and persist the validated semantic claim graph.
   * 2. Create Requirement rows, claim bindings, and deduplicated source-provenance rows.
   * 3. Create AssessmentRule rows with linked source-chunk fingerprints and Requirement links.
   * 4. Persist directed context relations to Requirement rows or validated source chunks.
   *
   * Failure cases:
   * - Full-source publication requires a semantic graph; selected-result publication may omit one because its independently validated legal sources are persisted as chunk provenance.
   * - An unresolved source claim throws, causing the enclosing activation transaction to roll back.
   * - Database constraint or child-write failures propagate and prevent partial publication.
   *
   * Side effects:
   * - Creates semantic graph, Requirement, claim binding, provenance, AssessmentRule, Requirement-link, and context-relation rows in the caller's transaction.
   */
  private async writeChildren(
    tx: Prisma.TransactionClient,
    ruleSetVersionId: string,
    ctx: Pick<SubmitContext, "packet" | "resolved" | "legalSource">,
    requireSemanticGraph = true,
  ): Promise<void> {
    const { packet, resolved, legalSource } = ctx;
    if (!packet.semanticGraph && requireSemanticGraph)
      throw new Error(
        "Validated new Rule Set must have a semantic claim graph",
      );
    if (packet.semanticGraph)
      await writeSemanticGraph(tx, ruleSetVersionId, packet.semanticGraph);
    const ruleRowId = new Map(
      packet.legalRequirements.map((rule) => [
        rule.legalRequirementId,
        randomUUID(),
      ]),
    );
    const chunkOf = (ref: { documentId: string; locator: string }) => {
      const chunk = resolved.get(sourceClaimKey(ref));
      if (!chunk)
        throw new Error(`unresolved source claim ${sourceClaimKey(ref)}`);
      return chunk;
    };

    await tx.legalRequirement.createMany({
      data: packet.legalRequirements.map((rule, ordinal) => ({
        id: ruleRowId.get(rule.legalRequirementId)!,
        ruleSetVersionId,
        legalRequirementId: rule.legalRequirementId,
        applicabilityMode: rule.applicabilityMode,
        title: rule.title,
        proposition: rule.proposition,
        operativePropositions: rule.operativePropositions,
        semanticContext: rule.semanticContext,
        applicabilityConditions: rule.applicabilityConditions,
        applicabilityLogic: rule.applicabilityLogic,
        qualifiers: rule.qualifiers,
        exceptions: rule.exceptions,
        nonRepositoryDuty: rule.nonRepositoryDuty,
        coverageState: rule.coverage.state,
        nonAssessableReason: rule.coverage.nonAssessableReason,
        contentDigest: sha256Hex(canonicalJson(rule)),
        ordinal,
      })),
    });

    await tx.legalRequirementClaimBinding.createMany({
      data: packet.legalRequirements.flatMap((rule) =>
        (rule.claimBindings ?? []).map((binding, ordinal) => ({
          ...binding,
          ordinal,
          ruleSetVersionId,
          legalRequirementRowId: ruleRowId.get(rule.legalRequirementId)!,
        })),
      ),
    });

    await tx.legalRequirementProvenance.createMany({
      data: packet.legalRequirements.flatMap((rule) => {
        const seen = new Set<string>();
        return rule.sourceRefs.flatMap((sourceRef, ordinal) => {
          const chunk = chunkOf(sourceRef);
          if (seen.has(chunk.id)) return [];
          seen.add(chunk.id);
          return [
            {
              ruleSetVersionId,
              legalRequirementRowId: ruleRowId.get(rule.legalRequirementId)!,
              legalSourceVersionId: legalSource.id,
              chunkId: chunk.id,
              documentId: chunk.documentId,
              locator: chunk.locator,
              contentSha256: chunk.contentSha256,
              sourceEffectStatus: chunk.sourceEffectStatus,
              legalEffectStatus: chunk.legalEffectStatus,
              legalStatusSourceRef: chunk.legalStatusSourceRef,
              ordinal,
            },
          ];
        });
      }),
    });

    const engineeringRowId = new Map(
      packet.assessmentRules.map((rule) => [
        rule.assessmentRuleId,
        randomUUID(),
      ]),
    );
    await tx.assessmentRule.createMany({
      data: packet.assessmentRules.map((rule, ordinal) => {
        const chunks = [
          ...new Map(
            rule.sourceRefs.map((r) => {
              const c = chunkOf(r);
              return [c.id, c] as const;
            }),
          ).values(),
        ];
        const { sourceRefs: _refs, ...semantic } = rule;
        void _refs;
        return {
          id: engineeringRowId.get(rule.assessmentRuleId)!,
          ruleSetVersionId,
          assessmentRuleId: rule.assessmentRuleId,
          assessmentRuleVersion: ctx.legalSource.version,
          concept: rule.concept,
          legalIntent: rule.legalIntent,
          applicabilityGuidance: rule.applicabilityGuidance,
          criteria: rule.criteria,
          contract: {
            ...semantic,
            sourceChunkIds: chunks.map((c) => c.id),
          },
          sourceFingerprint: sha256Hex(
            canonicalJson({
              legalSource: legalSource.id,
              chunks: chunks.map((c) => `${c.id}:${c.contentSha256}`).sort(),
            }),
          ),
          contentDigest: sha256Hex(canonicalJson(rule)),
          ordinal,
        };
      }),
    });
    await tx.assessmentRuleLegalRequirement.createMany({
      data: packet.assessmentRules.flatMap((rule) =>
        [...new Set(rule.legalRequirementIds)].map((legalRequirementId) => ({
          ruleSetVersionId,
          assessmentRuleRowId: engineeringRowId.get(rule.assessmentRuleId)!,
          legalRequirementRowId: ruleRowId.get(legalRequirementId)!,
        })),
      ),
    });

    for (const [ordinal, relation] of packet.contextRelations.entries()) {
      await tx.legalRequirementContextRelation.create({
        data: {
          ruleSetVersionId,
          relationId: relation.relationId,
          kind: relation.kind,
          fromRuleId: ruleRowId.get(relation.fromLegalRequirementId)!,
          toRuleId: relation.toLegalRequirementId
            ? ruleRowId.get(relation.toLegalRequirementId)!
            : null,
          toChunkId: relation.toSourceRef
            ? chunkOf(relation.toSourceRef).id
            : null,
          legalSourceVersionId: legalSource.id,
          relationDigest: sha256Hex(canonicalJson(relation)),
          ordinal,
        },
      });
    }
  }

  /**
   * Business purpose: Queue authored localization for the canonical requirements and Assessment Rules written to one Rule Set version.
   *
   * Business rules:
   * - Only persisted child rows of the successfully created version are localized; source and rule meaning remain unchanged.
   *
   * Execution flow:
   * 1. Read the version's LegalRequirement and AssessmentRule rows.
   * 2. Enqueue each row using its content digest as the canonical revision.
   *
   * Failure cases:
   * - Query or localization enqueue errors abort the surrounding publication transaction.
   *
   * Side effects:
   * - Adds authored-localization work records in the caller's transaction.
   */
  private async enqueueAuthoredDocuments(
    tx: Prisma.TransactionClient,
    ruleSetVersionId: string,
  ): Promise<void> {
    const { enqueueAuthoredDocument } =
      await import("../../../../platform/localization/authored-localization.service.js");
    const { AUTHORED_LOCALIZATION_ENTITIES } =
      await import("@lcsp/contracts/assessment-domain");
    const requirements = await tx.legalRequirement.findMany({
      where: { ruleSetVersionId },
    });
    const rules = await tx.assessmentRule.findMany({
      where: { ruleSetVersionId },
    });
    for (const row of requirements)
      await enqueueAuthoredDocument(tx, {
        sourceLanguages: {},
        scopeId: ruleSetVersionId,
        entityType: AUTHORED_LOCALIZATION_ENTITIES.LEGAL_REQUIREMENT,
        entityId: row.legalRequirementId,
        canonicalRevision: row.contentDigest,
        document: row,
      });
    for (const row of rules)
      await enqueueAuthoredDocument(tx, {
        sourceLanguages: {},
        scopeId: ruleSetVersionId,
        entityType: AUTHORED_LOCALIZATION_ENTITIES.ASSESSMENT_RULE,
        entityId: row.assessmentRuleId,
        canonicalRevision: row.contentDigest,
        document: row,
      });
  }
}
import { matchesPersistedDirectDraft } from "./preparation-inventory.persistence.js";
