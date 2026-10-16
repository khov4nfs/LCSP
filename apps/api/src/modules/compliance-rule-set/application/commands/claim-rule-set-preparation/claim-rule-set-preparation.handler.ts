import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  RULE_SET_PREPARATION_CLAIM_LEASE_SECONDS,
  type RuleSetPreparationLegalSourceBundle,
} from "@lcsp/contracts/compliance-rule-set";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { AgentExecutionState as PrismaAgentExecutionState } from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { ClaimRuleSetPreparationCommand } from "./claim-rule-set-preparation.command.js";
import { LegalDocumentGraphService } from "../../../../legal-source/application/services/legal-document-graph.service.js";

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
              data: { startedAt: now },
            })
          : { count: 0 };
    if (claimed.count !== 1) {
      throw problemException(
        COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
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
    return {
      documentGraph: await this.graph.materialize(legalSource.id),
      preparationRunId: run.id,
      executionState: state,
      legalSourceVersionId: legalSource.id,
      legalSourceVersion: legalSource.version,
      documents: legalSource.documents.map((document) => ({
        ...document,
        chunks: document.chunks.map(({ id, ...chunk }) => ({
          chunkId: id,
          ...chunk,
          legalEffectStatus: chunk.legalEffectStatus,
        })),
      })),
    };
  }
}
