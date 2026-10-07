import { randomUUID } from "node:crypto";

import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { AGENTIC_TOOL_STATUSES } from "@lcsp/contracts/evidence";
import {
  LEGAL_PORTFOLIO_ERROR_CODES,
  LEGAL_PORTFOLIO_EVENT_TYPES,
  type LegalPortfolioPacket,
  type LegalPortfolioSubmitResult,
  type LegalPortfolioValidationFailure,
} from "@lcsp/contracts/legal-portfolio";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { HttpStatus, Injectable } from "@nestjs/common";
import {
  Prisma,
  AgentExecutionState as PrismaAgentExecutionState,
  ArtifactLifecycleState as PrismaArtifactLifecycleState,
  LegalPreparationFailureReason as PrismaLegalPreparationFailureReason,
  LegalPortfolioValidationOutcome as PrismaValidationOutcome,
} from "@prisma/client";

import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import {
  canonicalJson,
  sha256Hex,
  sourceClaimKey,
  type CorpusChunkSnapshot,
} from "../../domain/legal-portfolio-integrity.validator.js";
import { toSubmitResult } from "./legal-portfolio.mappers.js";

const PORTFOLIO_SERVICE = "legal-portfolio-service";

/** Same transaction-scoped advisory lock pattern as the corpus lifecycle lock. */
export async function acquireLegalPortfolioActivationLock(
  tx: Prisma.TransactionClient,
): Promise<void> {
  let acquired = false;
  while (!acquired) {
    const result = await tx.$queryRaw<Array<{ acquired: boolean }>>(
      Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtext('lcsp:legal-portfolio-activation')) AS acquired`,
    );
    acquired = result[0]?.acquired === true;
    if (!acquired) await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export interface SubmitContext {
  runId: string;
  idempotencyKey: string;
  requestDigest: string;
  portfolioDigest: string;
  packet: LegalPortfolioPacket;
  failures: LegalPortfolioValidationFailure[];
  resolved: Map<string, CorpusChunkSnapshot>;
  corpus: { id: string; version: string };
  correlationId: string;
}

/**
 * The atomic activation transaction body: idempotent replay detection, portfolio + children
 * persistence, previous-ACTIVE supersession, outbox and audit. Only the submit handler drives it.
 */
@Injectable()
export class LegalPortfolioActivation {
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
  ): Promise<LegalPortfolioSubmitResult | null> {
    const record = await client.legalPortfolioActivationRecord.findUnique({
      where: { idempotencyKey },
      include: { portfolio: true },
    });
    if (record) {
      if (
        record.preparationRunId !== runId ||
        record.requestDigest !== requestDigest
      ) {
        throw problemException(
          LEGAL_PORTFOLIO_ERROR_CODES.idempotencyConflict,
          correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      return toSubmitResult({
        runId,
        portfolio: record.portfolio,
        activationRecordId: record.id,
        failures:
          record.validationFailures as unknown as LegalPortfolioValidationFailure[],
        previousActivePortfolioVersionId:
          record.previousActivePortfolioVersionId,
        replayed: true,
      });
    }
    const consumed = await client.legalPortfolioVersion.findUnique({
      where: { preparationRunId: runId },
      select: { id: true },
    });
    if (consumed) {
      throw problemException(
        LEGAL_PORTFOLIO_ERROR_CODES.preparationRunConflict,
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
  ): Promise<LegalPortfolioSubmitResult> {
    await acquireLegalPortfolioActivationLock(tx);

    const replay = await this.findReplay(
      tx,
      ctx.idempotencyKey,
      ctx.runId,
      ctx.requestDigest,
      ctx.correlationId,
    );
    if (replay) return replay;

    const valid = ctx.failures.length === 0;
    const previousActive = await tx.legalPortfolioVersion.findFirst({
      where: { lifecycleState: PrismaArtifactLifecycleState.ACTIVE },
      select: { id: true },
    });
    const ordinal =
      (await tx.legalPortfolioVersion.count({
        where: { legalCorpusVersionId: ctx.corpus.id },
      })) + 1;
    const version = `${ctx.corpus.version}.p${ordinal}`;
    const now = new Date();
    const portfolioId = randomUUID();
    const activationRecordId = randomUUID();

    if (valid && previousActive) {
      await tx.legalPortfolioVersion.update({
        where: { id: previousActive.id },
        data: {
          lifecycleState: PrismaArtifactLifecycleState.SUPERSEDED,
          supersededAt: now,
        },
      });
    }

    const portfolio = await tx.legalPortfolioVersion.create({
      data: {
        id: portfolioId,
        version,
        legalCorpusVersionId: ctx.corpus.id,
        preparationRunId: ctx.runId,
        lifecycleState: valid
          ? PrismaArtifactLifecycleState.ACTIVE
          : PrismaArtifactLifecycleState.INVALID,
        portfolioDigest: ctx.portfolioDigest,
        validationOutcome: valid
          ? PrismaValidationOutcome.PASSED
          : PrismaValidationOutcome.FAILED,
        validationFailures: ctx.failures,
        validatedAt: now,
        activatedAt: valid ? now : null,
      },
    });
    if (valid) await this.writeChildren(tx, portfolio.id, ctx);

    await tx.legalPreparationRun.update({
      where: { id: ctx.runId },
      data: valid
        ? {
            executionState: PrismaAgentExecutionState.SUCCEEDED,
            completedAt: now,
          }
        : {
            executionState: PrismaAgentExecutionState.FAILED,
            failureReason:
              PrismaLegalPreparationFailureReason.PORTFOLIO_VALIDATION_FAILED,
            completedAt: now,
          },
    });

    const eventType = valid
      ? LEGAL_PORTFOLIO_EVENT_TYPES.portfolioActivated
      : LEGAL_PORTFOLIO_EVENT_TYPES.portfolioValidationFailed;
    const outboxEventId = await this.outboxRepository.enqueue(
      buildOutboxMessageInput({
        aggregateType: OUTBOX_AGGREGATE_TYPES.legalPortfolioVersion,
        aggregateId: portfolio.id,
        eventType,
        correlationId: ctx.correlationId,
        causationId: activationRecordId,
        actor: { id: PORTFOLIO_SERVICE, type: AUDIT_ACTOR_TYPES.system },
        result: valid
          ? AGENTIC_TOOL_STATUSES.ready
          : AGENTIC_TOOL_STATUSES.failed,
        redactionStatus: AUDIT_REDACTION_STATUSES.none,
        idempotencyKey: `${portfolio.id}:${ctx.idempotencyKey}`,
        payload: {
          portfolioVersionRef: `legal-portfolio:${portfolio.id}`,
          activationRecordRef: `legal-portfolio-activation:${activationRecordId}`,
          corpusVersionRef: `corpus-version:${ctx.corpus.id}`,
          previousActivePortfolioRef:
            valid && previousActive
              ? `legal-portfolio:${previousActive.id}`
              : null,
          portfolioDigest: ctx.portfolioDigest,
          failureReasons: [
            ...new Set(ctx.failures.map((failure) => failure.code)),
          ],
        },
      }),
      tx,
    );

    await tx.legalPortfolioActivationRecord.create({
      data: {
        id: activationRecordId,
        portfolioVersionId: portfolio.id,
        preparationRunId: ctx.runId,
        idempotencyKey: ctx.idempotencyKey,
        requestDigest: ctx.requestDigest,
        validationOutcome: valid
          ? PrismaValidationOutcome.PASSED
          : PrismaValidationOutcome.FAILED,
        validationFailures: ctx.failures,
        previousActivePortfolioVersionId: valid
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
        resourceType: AUDIT_RESOURCE_TYPES.legalPortfolioVersion,
        resourceId: portfolio.id,
        decision: valid ? AUDIT_DECISIONS.allow : AUDIT_DECISIONS.deny,
        correlationId: ctx.correlationId,
        redactionStatus: AUDIT_REDACTION_STATUSES.none,
        payload: {
          portfolioVersionRef: `legal-portfolio:${portfolio.id}`,
          activationRecordRef: `legal-portfolio-activation:${activationRecordId}`,
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
      portfolio,
      activationRecordId,
      failures: ctx.failures,
      previousActivePortfolioVersionId: valid
        ? (previousActive?.id ?? null)
        : null,
      replayed: false,
    });
  }

  private async writeChildren(
    tx: Prisma.TransactionClient,
    portfolioVersionId: string,
    ctx: SubmitContext,
  ): Promise<void> {
    const { packet, resolved, corpus } = ctx;
    const ruleRowId = new Map(
      packet.legalRules.map((rule) => [rule.legalRuleId, randomUUID()]),
    );
    const chunkOf = (ref: { documentId: string; locator: string }) => {
      const chunk = resolved.get(sourceClaimKey(ref));
      if (!chunk)
        throw new Error(`unresolved source claim ${sourceClaimKey(ref)}`);
      return chunk;
    };

    await tx.legalPortfolioRule.createMany({
      data: packet.legalRules.map((rule, ordinal) => ({
        id: ruleRowId.get(rule.legalRuleId)!,
        portfolioVersionId,
        legalRuleId: rule.legalRuleId,
        title: rule.title,
        proposition: rule.proposition,
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

    await tx.legalRuleProvenance.createMany({
      data: packet.legalRules.flatMap((rule) => {
        const seen = new Set<string>();
        return rule.sourceRefs.flatMap((sourceRef, ordinal) => {
          const chunk = chunkOf(sourceRef);
          if (seen.has(chunk.id)) return [];
          seen.add(chunk.id);
          return [
            {
              portfolioVersionId,
              portfolioRuleId: ruleRowId.get(rule.legalRuleId)!,
              legalCorpusVersionId: corpus.id,
              chunkId: chunk.id,
              documentId: chunk.documentId,
              locator: chunk.locator,
              contentSha256: chunk.contentSha256,
              sourceEffectStatus: chunk.sourceEffectStatus,
              ordinal,
            },
          ];
        });
      }),
    });

    const engineeringRowId = new Map(
      packet.engineeringRules.map((rule) => [
        rule.engineeringRuleId,
        randomUUID(),
      ]),
    );
    await tx.engineeringRule.createMany({
      data: packet.engineeringRules.map((rule, ordinal) => {
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
          id: engineeringRowId.get(rule.engineeringRuleId)!,
          portfolioVersionId,
          engineeringRuleId: rule.engineeringRuleId,
          engineeringRuleVersion: ctx.corpus.version,
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
              corpus: corpus.id,
              chunks: chunks.map((c) => `${c.id}:${c.contentSha256}`).sort(),
            }),
          ),
          contentDigest: sha256Hex(canonicalJson(rule)),
          ordinal,
        };
      }),
    });
    await tx.engineeringRuleLegalRule.createMany({
      data: packet.engineeringRules.flatMap((rule) =>
        [...new Set(rule.legalRuleIds)].map((legalRuleId) => ({
          portfolioVersionId,
          engineeringRuleRowId: engineeringRowId.get(rule.engineeringRuleId)!,
          portfolioRuleId: ruleRowId.get(legalRuleId)!,
        })),
      ),
    });

    for (const [ordinal, relation] of packet.contextRelations.entries()) {
      await tx.legalRuleContextRelation.create({
        data: {
          portfolioVersionId,
          relationId: relation.relationId,
          kind: relation.kind,
          fromRuleId: ruleRowId.get(relation.fromLegalRuleId)!,
          toRuleId: relation.toLegalRuleId
            ? ruleRowId.get(relation.toLegalRuleId)!
            : null,
          toChunkId: relation.toSourceRef
            ? chunkOf(relation.toSourceRef).id
            : null,
          legalCorpusVersionId: corpus.id,
          relationDigest: sha256Hex(canonicalJson(relation)),
          ordinal,
        },
      });
    }
  }
}
