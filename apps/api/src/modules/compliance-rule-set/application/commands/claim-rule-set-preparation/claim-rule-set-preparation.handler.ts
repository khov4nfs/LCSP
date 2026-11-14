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
import { requireApprovedDevelopmentScope } from "../../../infrastructure/persistence/approved-development-scope.js";
import { acquireLegalSourceLifecycleLock } from "../../../../legal-source/application/services/legal-source.service.js";

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

  /**
   * Business purpose: Give one worker exclusive, leased ownership of a queued or abandoned Preparation and return its pinned source package.
   *
   * Business rules:
   * - The worker must support the run's execution contract; a published run cannot be claimed.
   * - QUEUED runs transition to RUNNING once, while RUNNING runs can be taken over only after the claim lease expires.
   * - Compare-and-set state checks prevent concurrent deliveries from claiming the same live run.
   * - Reuse the materialization pinned by an existing inventory frontier when available; otherwise materialize the source graph.
   * - Aggregate durable LLM usage events and report authoritative measured usage alongside unmeasured attempt count, without fabricating arbitrary token estimates.
   *
   * Execution flow:
   * 1. Load the run and reject a missing run or unsupported worker contract.
   * 2. Claim a queued run or refresh an expired running lease, clearing the prior review operation as part of the transition.
   * 3. Expire prior leases for in-review units, load the run's Legal Source documents and frozen inventory, and export the pinned graph.
   * 4. Aggregate durable LLM usage into measured token totals and count unmeasured physical attempts into cumulativeUsage.
   * 5. Map the pinned source and run state into the validated worker bundle.
   *
   * Failure cases:
   * - A missing run returns not found; an unsupported contract, active competing claim, or already-published run returns a preparation conflict.
   * - Missing pinned source data or an invalid response bundle fails the operation instead of substituting another source revision.
   *
   * Side effects:
   * - Updates run claim timestamps/state and active review lease expirations; reads source, graph, and inventory records.
   */
  async execute(
    input: ClaimRuleSetPreparationCommand,
  ): Promise<RuleSetPreparationLegalSourceBundle> {
    const admission = await this.prisma.$transaction(async (tx) => {
      await acquireLegalSourceLifecycleLock(tx);
      const run = await tx.ruleSetPreparationRun.findUnique({
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
      const supported = input.request.supportedExecutionContracts ?? [
        PreparationExecutionContract.CLAIM_INVENTORY_V1,
      ];
      if (!supported.includes(run.executionContract))
        throw problemException(
          COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
          input.correlationId,
          {
            status: HttpStatus.CONFLICT,
            meta: { reason: "WORKER_EXECUTION_CONTRACT_UNSUPPORTED" },
          },
        );
      // Verify the approved, pinned source BEFORE claiming and spending tokens.
      const approvedScope = await requireApprovedDevelopmentScope(
        tx,
        run.id,
        run.claimInventoryRevision,
        run.legalSourceVersionId,
        run.targetActivityScope,
        input.correlationId,
      );
      const now = new Date();
      const leaseCutoff = new Date(
        now.getTime() - RULE_SET_PREPARATION_CLAIM_LEASE_SECONDS * 1000,
      );
      // Both transitions are compare-and-set, serialized with invalidation.
      const claimed = run.ruleSet
        ? { count: 0 }
        : run.executionState === PrismaAgentExecutionState.QUEUED
          ? await tx.ruleSetPreparationRun.updateMany({
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
            ? await tx.ruleSetPreparationRun.updateMany({
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
      await tx.ruleSetPreparationSourceReview.updateMany({
        where: {
          preparationRunId: run.id,
          state: SourceReviewState.IN_REVIEW,
        },
        data: { leaseExpiresAt: now },
      });
      return { run, approvedScope };
    });
    const { run, approvedScope } = admission;
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
    const usageAggregate = this.prisma.llmUsageEvent?.aggregate
      ? await this.prisma.llmUsageEvent.aggregate({
          where: { runId: run.id },
          _sum: {
            inputTokens: true,
            outputTokens: true,
            totalTokens: true,
          },
          _count: {
            id: true,
          },
        })
      : null;

    const unmeasuredEventsCount = this.prisma.llmUsageEvent?.count
      ? await this.prisma.llmUsageEvent.count({
          where: {
            runId: run.id,
            OR: [{ totalTokens: null }, { totalTokens: 0n }],
          },
        })
      : 0;

    const measuredInput = Number(usageAggregate?._sum?.inputTokens ?? 0);
    const measuredOutput = Number(usageAggregate?._sum?.outputTokens ?? 0);
    const measuredTotal = Number(usageAggregate?._sum?.totalTokens ?? 0);
    const modelCalls = usageAggregate?._count?.id ?? 0;
    return ruleSetPreparationLegalSourceBundleSchema.parse({
      documentGraph: pinned
        ? (await this.graph.export(legalSource.id, pinned))!
        : await this.graph.materialize(legalSource.id),
      preparationRunId: run.id,
      executionContract: run.executionContract,
      // The server issues scoped authoring only after the review ledger, pinned
      // inventory and approval are revalidated before worker admission.
      targetActivityScope: run.targetActivityScope,
      scopeReviewRequested:
        run.scopeReviewRequested && run.targetActivityScope === "FULL_SOURCE",
      ...(approvedScope
        ? { approvedScopeDigest: approvedScope.decisionsDigest }
        : {}),
      // Vi is the explicit server-owned Preparation locale until per-run
      // responseLanguage is persisted and selected through an authorized flow.
      responseLanguage: "vi",
      ...(run.targetDate
        ? { targetDate: run.targetDate.toISOString().slice(0, 10) }
        : {}),
      executionState: state,
      claimInventoryRevision: run.claimInventoryRevision,
      claimPhase: P[run.claimPhase],
      frozenInventory: frozen,
      legalSourceVersionId: legalSource.id,
      legalSourceVersion: legalSource.version,
      cumulativeUsage: {
        modelCalls,
        inputTokens: measuredInput,
        outputTokens: measuredOutput,
        totalTokens: measuredTotal,
        consecutiveTurnsWithoutProgress: 0,
        unmeasuredModelCalls: unmeasuredEventsCount,
      },
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
