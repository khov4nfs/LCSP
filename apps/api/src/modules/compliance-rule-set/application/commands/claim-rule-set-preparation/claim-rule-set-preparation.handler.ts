import { fromPrismaLegalSourceDocumentCorpusRole } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  RULE_SET_PREPARATION_CLAIM_LEASE_SECONDS,
  type RuleSetPreparationLegalSourceBundle,
  CLAIM_PREPARATION_PHASES as P,
  ruleSetPreparationLegalSourceBundleSchema,
} from "@lcsp/contracts/compliance-rule-set";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  AgentExecutionState as PrismaAgentExecutionState,
  SourceReviewState,
  PreparationExecutionContract,
} from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { ClaimRuleSetPreparationCommand } from "./claim-rule-set-preparation.command.js";
import { LegalDocumentGraphService } from "../../../../legal-source/application/services/legal-document-graph.service.js";
import { pinnedMaterializationId } from "../../../infrastructure/persistence/preparation-inventory.persistence.js";

/**
 * Claims a run for exactly one worker: QUEUED -> RUNNING. A duplicated or redelivered command
 * finds the run already claimed and is refused, so one preparation is never paid for twice.
 * Only a claim whose lease expired without a result (a crashed worker) can be taken over.
 * Returns the one pinned Legal Source Version the agent may read.
 */
@CommandHandler(ClaimRuleSetPreparationCommand)
export class ClaimRuleSetPreparationHandler implements ICommandHandler<ClaimRuleSetPreparationCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: LegalDocumentGraphService,
  ) {}

  async execute(
    input: ClaimRuleSetPreparationCommand,
  ): Promise<RuleSetPreparationLegalSourceBundle> {
    const run = await this.prisma.ruleSetPreparationRun.findUnique({
      where: { id: input.request.preparationRunId },
      include: { ruleSet: { select: { id: true } } },
    });
    if (!run) {
      throw problemException(
        COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunNotFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    const supported = input.request.supportedExecutionContracts ?? [PreparationExecutionContract.CLAIM_INVENTORY_V1];
    if (!supported.includes(run.executionContract))
      throw problemException(COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict, input.correlationId, { status: HttpStatus.CONFLICT, meta: { reason: "WORKER_EXECUTION_CONTRACT_UNSUPPORTED" } });
    const now = new Date();
    const leaseCutoff = new Date(
      now.getTime() - RULE_SET_PREPARATION_CLAIM_LEASE_SECONDS * 1000,
    );
    // Both transitions are compare-and-set, so concurrent deliveries cannot both win.
    const claimed = run.ruleSet
      ? { count: 0 }
      : run.executionState === PrismaAgentExecutionState.QUEUED
        ? await this.prisma.ruleSetPreparationRun.updateMany({
            where: {
              id: run.id,
              executionState: PrismaAgentExecutionState.QUEUED,
            },
            data: {
              executionState: PrismaAgentExecutionState.RUNNING,
              startedAt: now,
              reviewOperationId: null,
            },
          })
        : run.executionState === PrismaAgentExecutionState.RUNNING &&
            run.startedAt &&
            run.startedAt <= leaseCutoff
          ? await this.prisma.ruleSetPreparationRun.updateMany({
              where: {
                id: run.id,
                executionState: PrismaAgentExecutionState.RUNNING,
                startedAt: run.startedAt,
              },
              data: { startedAt: now, reviewOperationId: null },
            })
          : { count: 0 };
    if (claimed.count !== 1) {
      throw problemException(
        COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    await this.prisma.ruleSetPreparationSourceReview.updateMany({
      where: {
        preparationRunId: run.id,
        state: SourceReviewState.IN_REVIEW,
      },
      data: {
        leaseExpiresAt: now,
      },
    });
    const state = PrismaAgentExecutionState.RUNNING;

    const legalSource = await this.prisma.legalSourceVersion.findUniqueOrThrow({
      where: { id: run.legalSourceVersionId },
      select: {
        id: true,
        version: true,
        documents: {
          orderBy: { documentId: "asc" },
          select: {
            documentId: true,
            title: true,
            sourceUrl: true,
            sourceSha256: true,
            sourceEffectStatus: true,
            corpusRole: true,
            chunks: {
              orderBy: { locator: "asc" },
              select: {
                id: true,
                locator: true,
                content: true,
                contentSha256: true,
                legalStatus: true,
                legalEffectStatus: true,
                legalStatusSourceRef: true,
                hierarchy: true,
              },
            },
          },
        },
      },
    });
    // A taken-over run resumes on the graph its review frontier pinned, even across a parser revision bump.
    const pinned = await pinnedMaterializationId(this.prisma, run.id);
    const frozen =
      await this.prisma.ruleSetPreparationClaimInventory.findUnique({
        where: {
          preparationRunId_revision: {
            preparationRunId: run.id,
            revision: run.claimInventoryRevision,
          },
        },
        select: {
          revision: true,
          fingerprint: true,
          graph: true,
          identities: true,
        },
      });
    return ruleSetPreparationLegalSourceBundleSchema.parse({
      documentGraph: pinned
        ? (await this.graph.export(legalSource.id, pinned))!
        : await this.graph.materialize(legalSource.id),
      preparationRunId: run.id,
      executionContract: run.executionContract,
      ...(run.targetDate ? { targetDate: run.targetDate.toISOString().slice(0, 10) } : {}),
      executionState: state,
      claimInventoryRevision: run.claimInventoryRevision,
      claimPhase: P[run.claimPhase],
      frozenInventory: frozen,
      legalSourceVersionId: legalSource.id,
      legalSourceVersion: legalSource.version,
      documents: legalSource.documents.map((document) => ({
        ...document,
        corpusRole: fromPrismaLegalSourceDocumentCorpusRole(
          document.corpusRole,
        ),
        chunks: document.chunks.map(({ id, ...chunk }) => ({
          chunkId: id,
          ...chunk,
          legalEffectStatus: chunk.legalEffectStatus,
        })),
      })),
    });
  }
}
