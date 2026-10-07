import { randomUUID } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";
import { ARTIFACT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
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
  LEGAL_PORTFOLIO_VALIDATION_OUTCOMES,
  legalPortfolioReadModelSchema,
  legalPortfolioSubmitRequestSchema,
  legalPortfolioValidateRequestSchema,
  legalPreparationClaimRequestSchema,
  legalPreparationFailRequestSchema,
  legalPreparationStartRequestSchema,
  type LegalPortfolioValidateResult,
  type LegalPreparationCorpusBundle,
  type LegalPortfolioReadModel,
  type LegalPortfolioSubmitResult,
  type LegalPreparationRun,
  type LegalPortfolioPacket,
  type LegalPortfolioValidationFailure,
} from "@lcsp/contracts/legal-portfolio";
import { LEGAL_RULE_ERROR_CODES } from "@lcsp/contracts/legal-rule-catalog";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import {
  AgentExecutionState as PrismaAgentExecutionState,
  ArtifactLifecycleState as PrismaArtifactLifecycleState,
  LegalPortfolioValidationOutcome as PrismaValidationOutcome,
  LegalPreparationFailureReason as PrismaLegalPreparationFailureReason,
  Prisma,
} from "@prisma/client";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import {
  canonicalJson,
  sha256Hex,
  sourceClaimKey,
  validateLegalPortfolioPacket,
  type CorpusChunkSnapshot,
  type CorpusSnapshot,
} from "./legal-portfolio-integrity.validator.js";

const PORTFOLIO_SERVICE = "legal-portfolio-service";
const MAX_TRANSACTION_ATTEMPTS = 4;
const SERIALIZATION_FAILURE_CODES = new Set(["P2034", "40001"]);

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

interface SubmitContext {
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

@Injectable()
export class LegalPortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outboxRepository: OutboxRepository,
    private readonly auditWriter: AuditWriterService,
  ) {}

  /** Starts (idempotently) one Legal Preparation run for one pinned corpus. */
  async startPreparation(input: {
    body: unknown;
    requestedBy: string;
    correlationId: string;
  }): Promise<LegalPreparationRun> {
    const parsed = legalPreparationStartRequestSchema.safeParse(input.body);
    if (!parsed.success) {
      throw problemException(
        LEGAL_PORTFOLIO_ERROR_CODES.submitRequestInvalid,
        input.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }
    const { legalCorpusVersionId, idempotencyKey } = parsed.data;

    const existing = await this.prisma.legalPreparationRun.findUnique({
      where: { idempotencyKey },
      include: { portfolio: { select: { id: true } } },
    });
    if (existing) {
      return this.replayPreparation(
        existing,
        legalCorpusVersionId,
        input.correlationId,
      );
    }

    const corpus = await this.prisma.legalCorpusVersion.findUnique({
      where: { id: legalCorpusVersionId },
      select: { id: true },
    });
    if (!corpus) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusVersionNotFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const run = await tx.legalPreparationRun.create({
          data: {
            idempotencyKey,
            legalCorpusVersionId: corpus.id,
            requestedBy: input.requestedBy,
            correlationId: input.correlationId,
            executionState: PrismaAgentExecutionState.QUEUED,
          },
        });
        const outboxEventId = await this.outboxRepository.enqueue(
          buildOutboxMessageInput({
            aggregateType: OUTBOX_AGGREGATE_TYPES.legalCorpusVersion,
            aggregateId: corpus.id,
            eventType: LEGAL_PORTFOLIO_EVENT_TYPES.preparationRequested,
            correlationId: input.correlationId,
            causationId: run.id,
            actor: { id: input.requestedBy, type: AUDIT_ACTOR_TYPES.service },
            result: AGENTIC_TOOL_STATUSES.ready,
            redactionStatus: AUDIT_REDACTION_STATUSES.none,
            idempotencyKey: `${run.id}:preparation`,
            payload: {
              preparationRunId: run.id,
              legalCorpusVersionId: corpus.id,
              preparationRunRef: `legal-preparation-run:${run.id}`,
              corpusVersionRef: `corpus-version:${corpus.id}`,
            },
          }),
          tx,
        );
        await tx.legalPreparationRun.update({
          where: { id: run.id },
          data: { outboxEventId },
        });
        return toRun(run, null);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.prisma.legalPreparationRun.findUnique({
          where: { idempotencyKey },
          include: { portfolio: { select: { id: true } } },
        });
        if (raced) {
          return this.replayPreparation(
            raced,
            legalCorpusVersionId,
            input.correlationId,
          );
        }
      }
      throw error;
    }
  }

  /** The one submit -> integrity validate -> atomic activate boundary. */
  async submit(input: {
    body: unknown;
    actorId: string;
    correlationId: string;
  }): Promise<LegalPortfolioSubmitResult> {
    const parsed = legalPortfolioSubmitRequestSchema.safeParse(input.body);
    if (!parsed.success) {
      throw problemException(
        LEGAL_PORTFOLIO_ERROR_CODES.submitRequestInvalid,
        input.correlationId,
        {
          status: HttpStatus.BAD_REQUEST,
          meta: {
            issues: parsed.error.issues
              .slice(0, 20)
              .map((issue) => issue.path.join("."))
              .join(","),
          },
        },
      );
    }
    const request = parsed.data;
    const requestDigest = sha256Hex(canonicalJson(request.packet));

    const run = await this.prisma.legalPreparationRun.findUnique({
      where: { id: request.preparationRunId },
      include: { corpusVersion: { select: { id: true, version: true } } },
    });
    if (!run) {
      throw problemException(
        LEGAL_PORTFOLIO_ERROR_CODES.preparationRunNotFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    // Cheap replay before any validation work; re-checked inside the lock.
    const replay = await this.findReplay(
      this.prisma,
      request.idempotencyKey,
      run.id,
      requestDigest,
      input.correlationId,
    );
    if (replay) return replay;

    const corpus = await this.loadCorpusSnapshot(
      run.corpusVersion.id,
      request.packet,
    );
    const validation = validateLegalPortfolioPacket(
      request.packet,
      corpus.snapshot,
      (claim) =>
        corpus.foreignHashes.has(
          `${sourceClaimKey(claim)}|${claim.contentSha256}`,
        ),
    );

    const context: SubmitContext = {
      runId: run.id,
      idempotencyKey: request.idempotencyKey,
      requestDigest,
      portfolioDigest: requestDigest,
      packet: request.packet,
      failures: validation.failures,
      resolved: validation.resolved,
      corpus: run.corpusVersion,
      correlationId: input.correlationId,
    };

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          (tx) => this.commit(tx, context, input.actorId),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!isRetryable(error) || attempt >= MAX_TRANSACTION_ATTEMPTS)
          throw error;
      }
    }
  }

  /**
   * Claims a run: QUEUED -> RUNNING (idempotent while RUNNING) and returns the one
   * pinned corpus the agent may read. A finished run cannot be claimed again.
   */
  async claimPreparation(input: {
    body: unknown;
    correlationId: string;
  }): Promise<LegalPreparationCorpusBundle> {
    const parsed = legalPreparationClaimRequestSchema.safeParse(input.body);
    if (!parsed.success) {
      throw problemException(
        LEGAL_PORTFOLIO_ERROR_CODES.submitRequestInvalid,
        input.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }
    const run = await this.prisma.legalPreparationRun.findUnique({
      where: { id: parsed.data.preparationRunId },
      include: { portfolio: { select: { id: true } } },
    });
    if (!run) {
      throw problemException(
        LEGAL_PORTFOLIO_ERROR_CODES.preparationRunNotFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    const claimable =
      run.executionState === PrismaAgentExecutionState.QUEUED ||
      run.executionState === PrismaAgentExecutionState.RUNNING;
    if (!claimable || run.portfolio) {
      throw problemException(
        LEGAL_PORTFOLIO_ERROR_CODES.preparationRunConflict,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    const state =
      run.executionState === PrismaAgentExecutionState.QUEUED
        ? (
            await this.prisma.legalPreparationRun.update({
              where: { id: run.id },
              data: {
                executionState: PrismaAgentExecutionState.RUNNING,
                startedAt: new Date(),
              },
            })
          ).executionState
        : run.executionState;

    const corpus = await this.prisma.legalCorpusVersion.findUniqueOrThrow({
      where: { id: run.legalCorpusVersionId },
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
                hierarchy: true,
              },
            },
          },
        },
      },
    });
    return {
      preparationRunId: run.id,
      executionState: state,
      legalCorpusVersionId: corpus.id,
      corpusVersion: corpus.version,
      documents: corpus.documents.map((document) => ({
        ...document,
        chunks: document.chunks.map(({ id, ...chunk }) => ({
          chunkId: id,
          ...chunk,
        })),
      })),
    };
  }

  /** Records that an execution could not produce a submission. Idempotent for FAILED; a finished run conflicts. */
  async failPreparation(input: {
    body: unknown;
    correlationId: string;
  }): Promise<LegalPreparationRun> {
    const parsed = legalPreparationFailRequestSchema.safeParse(input.body);
    if (!parsed.success) {
      throw problemException(
        LEGAL_PORTFOLIO_ERROR_CODES.submitRequestInvalid,
        input.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }
    const run = await this.prisma.legalPreparationRun.findUnique({
      where: { id: parsed.data.preparationRunId },
      include: { portfolio: { select: { id: true } } },
    });
    if (!run) {
      throw problemException(
        LEGAL_PORTFOLIO_ERROR_CODES.preparationRunNotFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    if (run.executionState === PrismaAgentExecutionState.FAILED) {
      return toRun(run, run.portfolio?.id ?? null);
    }
    const open =
      run.executionState === PrismaAgentExecutionState.QUEUED ||
      run.executionState === PrismaAgentExecutionState.RUNNING;
    if (!open || run.portfolio) {
      throw problemException(
        LEGAL_PORTFOLIO_ERROR_CODES.preparationRunConflict,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    const failed = await this.prisma.legalPreparationRun.update({
      where: { id: run.id },
      data: {
        executionState: PrismaAgentExecutionState.FAILED,
        failureReason: parsed.data.reason,
        completedAt: new Date(),
      },
    });
    return toRun(failed, null);
  }

  /** Dry-run of the submit validation: reads only, never persists. */
  async validate(input: {
    body: unknown;
    correlationId: string;
  }): Promise<LegalPortfolioValidateResult> {
    const parsed = legalPortfolioValidateRequestSchema.safeParse(input.body);
    if (!parsed.success) {
      throw problemException(
        LEGAL_PORTFOLIO_ERROR_CODES.submitRequestInvalid,
        input.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }
    const run = await this.prisma.legalPreparationRun.findUnique({
      where: { id: parsed.data.preparationRunId },
      select: { legalCorpusVersionId: true },
    });
    if (!run) {
      throw problemException(
        LEGAL_PORTFOLIO_ERROR_CODES.preparationRunNotFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    const corpus = await this.loadCorpusSnapshot(
      run.legalCorpusVersionId,
      parsed.data.packet,
    );
    const { failures } = validateLegalPortfolioPacket(
      parsed.data.packet,
      corpus.snapshot,
      (claim) =>
        corpus.foreignHashes.has(
          `${sourceClaimKey(claim)}|${claim.contentSha256}`,
        ),
    );
    return {
      outcome:
        failures.length === 0
          ? LEGAL_PORTFOLIO_VALIDATION_OUTCOMES.PASSED
          : LEGAL_PORTFOLIO_VALIDATION_OUTCOMES.FAILED,
      failures,
    };
  }

  /** The single runtime reader: the explicit ACTIVE portfolio, never "latest by date". */
  async getActivePortfolio(
    correlationId: string,
  ): Promise<LegalPortfolioReadModel> {
    const active = await this.prisma.legalPortfolioVersion.findFirst({
      where: { lifecycleState: PrismaArtifactLifecycleState.ACTIVE },
      include: {
        rules: {
          orderBy: { ordinal: "asc" },
          include: { provenance: { orderBy: { ordinal: "asc" } } },
        },
        engineeringRules: {
          orderBy: { ordinal: "asc" },
          include: {
            legalRuleLinks: {
              include: { legalRule: { select: { legalRuleId: true } } },
            },
          },
        },
        contextRelations: {
          orderBy: { ordinal: "asc" },
          include: {
            toChunk: {
              select: { documentId: true, locator: true, contentSha256: true },
            },
          },
        },
      },
    });
    if (!active) {
      throw problemException(
        LEGAL_PORTFOLIO_ERROR_CODES.activePortfolioNotFound,
        correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const ruleKeyById = new Map(
      active.rules.map((rule) => [rule.id, rule.legalRuleId]),
    );
    const engineeringChunkIds = [
      ...new Set(
        active.engineeringRules.flatMap((rule) =>
          contractChunkIds(rule.contract),
        ),
      ),
    ];
    const chunks = await this.prisma.legalDocumentChunk.findMany({
      where: {
        id: { in: engineeringChunkIds },
        legalCorpusVersionId: active.legalCorpusVersionId,
      },
      select: {
        id: true,
        documentId: true,
        locator: true,
        contentSha256: true,
        sourceDocument: { select: { sourceEffectStatus: true } },
      },
    });
    const chunkById = new Map(chunks.map((chunk) => [chunk.id, chunk]));

    return legalPortfolioReadModelSchema.parse({
      portfolioVersionId: active.id,
      version: active.version,
      legalCorpusVersionId: active.legalCorpusVersionId,
      portfolioDigest: active.portfolioDigest,
      lifecycleState: ARTIFACT_LIFECYCLE_STATES.ACTIVE,
      activatedAt: active.activatedAt?.toISOString() ?? null,
      legalRules: active.rules.map((rule) => ({
        legalRuleId: rule.legalRuleId,
        title: rule.title,
        proposition: rule.proposition,
        applicabilityConditions: rule.applicabilityConditions,
        qualifiers: rule.qualifiers,
        exceptions: rule.exceptions,
        nonRepositoryDuty: rule.nonRepositoryDuty,
        coverage: {
          state: rule.coverageState,
          nonAssessableReason: rule.nonAssessableReason,
        },
        sources: rule.provenance.map((p) => ({
          chunkId: p.chunkId,
          documentId: p.documentId,
          locator: p.locator,
          contentSha256: p.contentSha256,
          sourceEffectStatus: p.sourceEffectStatus,
        })),
      })),
      engineeringRules: active.engineeringRules.map((rule) => {
        const { sourceChunkIds: _ids, ...contract } = rule.contract as Record<
          string,
          unknown
        >;
        void _ids;
        return {
          ...contract,
          engineeringRuleId: rule.engineeringRuleId,
          engineeringRuleVersion: rule.engineeringRuleVersion,
          legalRuleIds: rule.legalRuleLinks
            .map((link) => link.legalRule.legalRuleId)
            .sort(),
          concept: rule.concept,
          legalIntent: rule.legalIntent,
          applicabilityGuidance: rule.applicabilityGuidance,
          criteria: rule.criteria,
          sourceFingerprint: rule.sourceFingerprint,
          sources: contractChunkIds(rule.contract).flatMap((id) => {
            const chunk = chunkById.get(id);
            return chunk
              ? [
                  {
                    chunkId: chunk.id,
                    documentId: chunk.documentId,
                    locator: chunk.locator,
                    contentSha256: chunk.contentSha256,
                    sourceEffectStatus: chunk.sourceDocument.sourceEffectStatus,
                  },
                ]
              : [];
          }),
        };
      }),
      contextRelations: active.contextRelations.map((relation) => ({
        relationId: relation.relationId,
        kind: relation.kind,
        fromLegalRuleId: ruleKeyById.get(relation.fromRuleId) ?? "",
        toLegalRuleId: relation.toRuleId
          ? (ruleKeyById.get(relation.toRuleId) ?? null)
          : null,
        toSourceRef: relation.toChunk
          ? {
              documentId: relation.toChunk.documentId,
              locator: relation.toChunk.locator,
              contentSha256: relation.toChunk.contentSha256,
            }
          : null,
      })),
    });
  }

  private replayPreparation(
    existing: {
      id: string;
      legalCorpusVersionId: string;
      executionState: PrismaAgentExecutionState;
      portfolio: { id: string } | null;
    },
    legalCorpusVersionId: string,
    correlationId: string,
  ): LegalPreparationRun {
    if (existing.legalCorpusVersionId !== legalCorpusVersionId) {
      throw problemException(
        LEGAL_PORTFOLIO_ERROR_CODES.idempotencyConflict,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    return toRun(existing, existing.portfolio?.id ?? null);
  }

  private async findReplay(
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

  private async loadCorpusSnapshot(
    corpusVersionId: string,
    packet: LegalPortfolioPacket,
  ): Promise<{ snapshot: CorpusSnapshot; foreignHashes: Set<string> }> {
    const [documents, chunks, validIndex] = await Promise.all([
      this.prisma.legalSourceDocument.findMany({
        where: { legalCorpusVersionId: corpusVersionId },
        select: { documentId: true, sourceEffectStatus: true },
      }),
      this.prisma.legalDocumentChunk.findMany({
        where: { legalCorpusVersionId: corpusVersionId },
        select: {
          id: true,
          documentId: true,
          locator: true,
          contentSha256: true,
          legalStatus: true,
        },
      }),
      this.prisma.legalRetrievalIndex.findFirst({
        where: {
          legalCorpusVersionId: corpusVersionId,
          status: "VALID",
          validatedAt: { not: null },
        },
        select: { id: true },
      }),
    ]);
    const effectByDocument = new Map(
      documents.map((d) => [d.documentId, d.sourceEffectStatus]),
    );

    // Only claims whose hash mismatches the pinned corpus need a foreign-corpus lookup.
    const pinnedHash = new Map(
      chunks.map((c) => [sourceClaimKey(c), c.contentSha256]),
    );
    const claims = [
      ...packet.legalRules.flatMap((rule) => rule.sourceRefs),
      ...packet.engineeringRules.flatMap((rule) => rule.sourceRefs),
      ...packet.contextRelations.flatMap((relation) =>
        relation.toSourceRef ? [relation.toSourceRef] : [],
      ),
    ];
    const stale = [
      ...new Map(
        claims
          .filter(
            (c) =>
              pinnedHash.has(sourceClaimKey(c)) &&
              pinnedHash.get(sourceClaimKey(c)) !== c.contentSha256,
          )
          .map((c) => [`${sourceClaimKey(c)}|${c.contentSha256}`, c] as const),
      ).values(),
    ];
    const foreignHashes = new Set<string>();
    if (stale.length > 0) {
      const foreign = await this.prisma.legalDocumentChunk.findMany({
        where: {
          legalCorpusVersionId: { not: corpusVersionId },
          OR: stale.map((c) => ({
            documentId: c.documentId,
            locator: c.locator,
            contentSha256: c.contentSha256,
          })),
        },
        select: { documentId: true, locator: true, contentSha256: true },
      });
      for (const c of foreign)
        foreignHashes.add(`${sourceClaimKey(c)}|${c.contentSha256}`);
    }
    return {
      snapshot: {
        corpusVersionId,
        retrievalIndexValid: validIndex !== null,
        chunks: chunks.map((chunk) => ({
          ...chunk,
          sourceEffectStatus:
            effectByDocument.get(chunk.documentId) ?? "UNKNOWN",
        })),
      },
      foreignHashes,
    };
  }

  private async commit(
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

function contractChunkIds(contract: Prisma.JsonValue): string[] {
  const ids = (contract as { sourceChunkIds?: unknown } | null)?.sourceChunkIds;
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === "string")
    : [];
}

function toRun(
  run: {
    id: string;
    legalCorpusVersionId: string;
    executionState: PrismaAgentExecutionState;
  },
  portfolioVersionId: string | null,
): LegalPreparationRun {
  return {
    preparationRunId: run.id,
    legalCorpusVersionId: run.legalCorpusVersionId,
    executionState: run.executionState,
    portfolioVersionId,
  };
}

function toSubmitResult(input: {
  runId: string;
  portfolio: {
    id: string;
    version: string;
    lifecycleState: PrismaArtifactLifecycleState;
  };
  activationRecordId: string;
  failures: LegalPortfolioValidationFailure[];
  previousActivePortfolioVersionId: string | null;
  replayed: boolean;
}): LegalPortfolioSubmitResult {
  return {
    preparationRunId: input.runId,
    portfolioVersionId: input.portfolio.id,
    version: input.portfolio.version,
    lifecycleState: input.portfolio.lifecycleState,
    validation: {
      outcome:
        input.failures.length === 0
          ? LEGAL_PORTFOLIO_VALIDATION_OUTCOMES.PASSED
          : LEGAL_PORTFOLIO_VALIDATION_OUTCOMES.FAILED,
      failures: input.failures,
    },
    activationRecordId: input.activationRecordId,
    previousActivePortfolioVersionId: input.previousActivePortfolioVersionId,
    replayed: input.replayed,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function isRetryable(error: unknown): boolean {
  const code = error as { code?: string; meta?: { code?: string } } | null;
  return (
    SERIALIZATION_FAILURE_CODES.has(code?.code ?? "") ||
    SERIALIZATION_FAILURE_CODES.has(code?.meta?.code ?? "")
  );
}
