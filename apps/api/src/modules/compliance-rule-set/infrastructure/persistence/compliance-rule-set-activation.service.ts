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
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { HttpStatus, Injectable } from "@nestjs/common";
import {
  Prisma,
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

/**
 * The atomic activation transaction body: idempotent replay detection, rule set + children
 * persistence, previous-ACTIVE supersession, outbox and audit. Only the submit handler drives it.
 */
@Injectable()
export class ComplianceRuleSetActivation {
  constructor(
    private readonly outboxRepository: OutboxRepository,
    private readonly auditWriter: AuditWriterService,
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
      }>
    >(
      Prisma.sql`SELECT "executionState", "claimInventoryRevision", "claimPhase", "executionContract" FROM "RuleSetPreparationRun" WHERE "id" = ${ctx.runId} FOR UPDATE`,
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
        !(await matchesPersistedDirectDraft(tx, { id: ctx.runId, ...preparation }, ctx.packet)) ||
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
    if (valid) await this.writeChildren(tx, ruleSet.id, ctx);

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

  private async writeChildren(
    tx: Prisma.TransactionClient,
    ruleSetVersionId: string,
    ctx: SubmitContext,
  ): Promise<void> {
    const { packet, resolved, legalSource } = ctx;
    if (!packet.semanticGraph)
      throw new Error(
        "Validated new Rule Set must have a semantic claim graph",
      );
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
}
import { matchesPersistedDirectDraft } from "./preparation-inventory.persistence.js";
