import { createHash, randomUUID } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_EVENT_TYPES,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import {
  LEGAL_SOURCE_DELETION_BLOCKERS,
  LEGAL_SOURCE_DELETION_ERROR_CODES,
  LEGAL_SOURCE_EVENT_SCHEMA_VERSIONS,
  LEGAL_SOURCE_EVENT_TYPES,
  LEGAL_SOURCE_MANAGEMENT_ERROR_CODES,
  legalSourceDeletedEventSchema,
  legalSourceDeletionImpactResponseSchema,
  deleteLegalSourceRequestSchema,
  deleteLegalSourceResponseSchema,
  type LegalSourceDeletionBlocker,
  type DeleteLegalSourceRequest,
} from "@lcsp/contracts/legal-source";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import {
  AgentExecutionState,
  AssessmentLifecycleState,
  AssessmentArtifactKind,
  LegalSourceDocumentIngestionState,
  LegalSourceLifecycleStatus,
  OutboxStatus,
  Prisma,
} from "@prisma/client";

import { fromPrismaLegalSourceLifecycleStatus } from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { acquireLegalSourceLifecycleLock } from "./legal-source.service.js";

const NONTERMINAL_PREPARATION_STATES: AgentExecutionState[] = [
  AgentExecutionState.QUEUED,
  AgentExecutionState.RUNNING,
  AgentExecutionState.INTERRUPTED,
  AgentExecutionState.PAUSED,
] as const;

const OUTBOX_REPLAYABLE_STATES = [
  OutboxStatus.PENDING,
  OutboxStatus.FAILED,
  OutboxStatus.DLQ,
] as const;

type DeletionClient = Prisma.TransactionClient;

/**
 * Business purpose: Identify PostgreSQL transaction conflicts that can safely retry the same deletion request.
 *
 * Business rules:
 * - Retry only Prisma serialization/deadlock conflicts; domain blockers and other persistence failures remain final.
 *
 * Execution flow:
 * 1. Confirm the error is a Prisma known request error.
 * 2. Match the documented Prisma conflict code or PostgreSQL serialization code.
 *
 * Failure cases:
 * - Prisma conflicts outside the allowlist and domain failures return false so callers propagate them.
 *
 * Side effects:
 * - Pure classification; no persistence or retry is performed here.
 */
function isRetryableTransactionConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2034" ||
      error.meta?.code === "40001" ||
      error.message.includes("40001"))
  );
}

/** Source deletion owns its explicit cleanup graph; every write participates in one PostgreSQL transaction. */
@Injectable()
export class LegalSourceDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriterService,
    private readonly outbox: OutboxRepository,
  ) {}

  /**
   * Business purpose: Show an Admin the source-owned deletion scope and current blockers before confirmation.
   *
   * Business rules:
   * - The impact is informational and never grants deletion authority; final eligibility is reloaded in the delete transaction.
   *
   * Execution flow:
   * 1. Read source, versions, dependent work, protected references, and shared-blob counts in one repeatable-read snapshot.
   * 2. Validate the response against the shared deletion-impact contract.
   *
   * Failure cases:
   * - Missing sources return the canonical not-found problem; invalid database projections fail response validation.
   *
   * Side effects:
   * - Read-only PostgreSQL transaction; no audit, outbox, or source mutation.
   */
  async getImpact(sourceId: string, correlationId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const impact = await this.loadImpact(tx, sourceId, correlationId);
        return legalSourceDeletionImpactResponseSchema.parse(impact);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * Business purpose: Permanently remove one Legal Source and its owned preparation and Rule Set trees without losing protected history.
   *
   * Business rules:
   * - Require an Admin-authorized caller, matching impact snapshot and confirmation slug, unique idempotency identity, and no protected or unsettled dependency.
   * - A single PostgreSQL transaction owns every deletion, receipt, audit event, and deletion outbox event; unrelated sources and shared blobs remain intact.
   *
   * Execution flow:
   * 1. Validate and digest the request, then acquire the canonical lifecycle lock and check for a prior idempotent receipt.
   * 2. Lock the source-owned rows and outbox records in stable order, reload blockers, and verify the impact snapshot.
   * 3. Record a transaction-local deletion receipt, settle replayable work, delete owned descendants and unreferenced blobs, then write durable audit/outbox evidence.
   * 4. Retry only bounded serialization/deadlock conflicts so a concurrent same-key request can observe the committed receipt.
   *
   * Failure cases:
   * - Stale impact, confirmation mismatch, protected references, active work, or conflicting idempotency payload return typed problems; any failure rolls the entire transaction back.
   *
   * Side effects:
   * - Physically deletes the source-owned PostgreSQL graph and eligible blobs; preserves independent snapshots and audit/deletion receipts.
   */
  async deleteSource(input: {
    sourceId: string;
    actorId: string;
    correlationId: string;
    request: DeleteLegalSourceRequest;
  }) {
    const parsed = deleteLegalSourceRequestSchema.safeParse(input.request);
    if (!parsed.success) {
      throw problemException(
        LEGAL_SOURCE_MANAGEMENT_ERROR_CODES.requestInvalid,
        input.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    const request = parsed.data;
    const requestDigest = this.requestDigest(
      input.sourceId,
      input.actorId,
      request,
    );

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            await acquireLegalSourceLifecycleLock(tx);

            const prior = await tx.legalSourceDeletionReceipt.findUnique({
              where: { idempotencyKey: request.idempotencyKey },
            });
            if (prior) {
              if (
                prior.requestDigest !== requestDigest ||
                prior.sourceId !== input.sourceId
              ) {
                throw problemException(
                  LEGAL_SOURCE_DELETION_ERROR_CODES.idempotencyConflict,
                  input.correlationId,
                  { status: HttpStatus.CONFLICT },
                );
              }
              return this.receiptResponse(prior, true);
            }

            const sourceLock = await tx.$queryRaw<Array<{ id: string }>>(
              Prisma.sql`SELECT id FROM "LegalSource" WHERE id = ${input.sourceId} FOR UPDATE`,
            );
            if (sourceLock.length === 0) {
              throw problemException(
                LEGAL_SOURCE_DELETION_ERROR_CODES.sourceNotFound,
                input.correlationId,
                { status: HttpStatus.NOT_FOUND },
              );
            }

            const versionLock = await tx.$queryRaw<Array<{ id: string }>>(
              Prisma.sql`SELECT id FROM "LegalSourceVersion" WHERE "legalSourceId" = ${input.sourceId} ORDER BY id FOR UPDATE`,
            );
            const versionIds = versionLock.map((row) => row.id);
            if (versionIds.length) {
              await tx.$queryRaw(
                Prisma.sql`SELECT id FROM "LegalSourceDocument" WHERE "legalSourceVersionId" IN (${Prisma.join(versionIds)}) ORDER BY id FOR UPDATE`,
              );
              await tx.$queryRaw(
                Prisma.sql`SELECT id FROM "RuleSetPreparationRun" WHERE "legalSourceVersionId" IN (${Prisma.join(versionIds)}) ORDER BY id FOR UPDATE`,
              );
              await tx.$queryRaw(
                Prisma.sql`SELECT id FROM "ComplianceRuleSetVersion" WHERE "legalSourceVersionId" IN (${Prisma.join(versionIds)}) ORDER BY id FOR UPDATE`,
              );
            }

            const impact = legalSourceDeletionImpactResponseSchema.parse(
              await this.loadImpact(tx, input.sourceId, input.correlationId),
            );
            if (request.confirmationSlug !== impact.source.slug) {
              throw problemException(
                LEGAL_SOURCE_DELETION_ERROR_CODES.confirmationMismatch,
                input.correlationId,
                { status: HttpStatus.CONFLICT },
              );
            }
            if (request.expectedImpactEtag !== impact.snapshot.etag) {
              throw problemException(
                LEGAL_SOURCE_DELETION_ERROR_CODES.impactStale,
                input.correlationId,
                {
                  status: HttpStatus.CONFLICT,
                  meta: { currentImpactEtag: impact.snapshot.etag },
                },
              );
            }
            if (!impact.eligibility.eligibleAtSnapshot) {
              throw problemException(
                LEGAL_SOURCE_DELETION_ERROR_CODES.deletionBlocked,
                input.correlationId,
                {
                  status: HttpStatus.CONFLICT,
                  meta: { blockers: impact.eligibility.blockers.join("|") },
                },
              );
            }

            const source = await tx.legalSource.findUniqueOrThrow({
              where: { id: input.sourceId },
              select: { id: true, slug: true },
            });
            const versions = await tx.legalSourceVersion.findMany({
              where: { legalSourceId: source.id },
              orderBy: { id: "asc" },
              select: { id: true },
            });
            const ids = versions.map((version) => version.id);
            const documents = ids.length
              ? await tx.legalSourceDocument.findMany({
                  where: { legalSourceVersionId: { in: ids } },
                  orderBy: { id: "asc" },
                  select: { id: true, blobSha256: true },
                })
              : [];
            const blobHashes = [
              ...new Set(
                documents.flatMap((document) =>
                  document.blobSha256 ? [document.blobSha256] : [],
                ),
              ),
            ].sort();
            if (blobHashes.length) {
              await tx.$queryRaw(
                Prisma.sql`SELECT "sha256" FROM "LegalSourceDocumentBlob" WHERE "sha256" IN (${Prisma.join(blobHashes)}) ORDER BY "sha256" FOR UPDATE`,
              );
            }
            const preparations = ids.length
              ? await tx.ruleSetPreparationRun.findMany({
                  where: { legalSourceVersionId: { in: ids } },
                  orderBy: { id: "asc" },
                  select: { id: true },
                })
              : [];
            const preparationIds = preparations.map((run) => run.id);
            const ruleSets = ids.length
              ? await tx.complianceRuleSetVersion.findMany({
                  where: { legalSourceVersionId: { in: ids } },
                  orderBy: { id: "asc" },
                  select: { id: true },
                })
              : [];
            const ruleSetIds = ruleSets.map((ruleSet) => ruleSet.id);
            const aggregateIds = [
              source.id,
              ...ids,
              ...preparationIds,
              ...ruleSetIds,
            ];
            if (aggregateIds.length) {
              // Serialize against the publisher's row-claim transition before making the
              // final settlement decision. If a publisher already owns a row, this read
              // observes that state or the serializable transaction aborts safely.
              await tx.$queryRaw(
                Prisma.sql`SELECT id FROM "OutboxMessage" WHERE "aggregateId" IN (${Prisma.join(aggregateIds)}) ORDER BY id FOR UPDATE`,
              );
            }
            const finalImpact = legalSourceDeletionImpactResponseSchema.parse(
              await this.loadImpact(tx, input.sourceId, input.correlationId),
            );
            if (request.expectedImpactEtag !== finalImpact.snapshot.etag) {
              throw problemException(
                LEGAL_SOURCE_DELETION_ERROR_CODES.impactStale,
                input.correlationId,
                {
                  status: HttpStatus.CONFLICT,
                  meta: { currentImpactEtag: finalImpact.snapshot.etag },
                },
              );
            }
            if (!finalImpact.eligibility.eligibleAtSnapshot) {
              throw problemException(
                LEGAL_SOURCE_DELETION_ERROR_CODES.deletionBlocked,
                input.correlationId,
                {
                  status: HttpStatus.CONFLICT,
                  meta: {
                    blockers: finalImpact.eligibility.blockers.join("|"),
                  },
                },
              );
            }

            // The receipt is an uncommitted authorization witness for narrowly scoped immutable-row
            // DELETE triggers. It is completed with real audit/outbox IDs before commit. Any failure
            // rolls the receipt and every deletion back together.
            const deletionReceiptId = randomUUID();
            const receipt = await tx.legalSourceDeletionReceipt.create({
              data: {
                id: deletionReceiptId,
                sourceId: source.id,
                sourceSlug: source.slug,
                idempotencyKey: request.idempotencyKey,
                requestDigest,
                reasonCode: request.reason.code,
                reasonText: request.reason.text,
                actorId: input.actorId,
                correlationId: input.correlationId,
                auditEventId: randomUUID(),
                outboxEventId: randomUUID(),
                deletedVersionIds: ids,
                deletedDocumentRowIds: documents.map((document) => document.id),
                deletedPreparationRunIds: preparationIds,
                deletedRuleSetVersionIds: ruleSetIds,
                retainedIndependentSnapshotCount:
                  finalImpact.retention.independentSnapshots,
              },
            });
            await tx.$queryRaw`
          SELECT set_config('lcsp.source_deletion_source_id', ${source.id}, true)
        `;

            if (aggregateIds.length) {
              await tx.outboxMessage.updateMany({
                where: {
                  aggregateId: { in: aggregateIds },
                  status: { in: [...OUTBOX_REPLAYABLE_STATES] },
                },
                data: { status: OutboxStatus.CANCELLED },
              });
            }

            await this.deleteRuleSetTrees(tx, ruleSetIds, preparationIds);
            await this.deletePreparationTrees(tx, preparationIds);
            await this.deleteSourceGraphs(tx, ids);
            await this.deleteSourceDocuments(tx, ids, documents);
            await tx.legalRetrievalIndex.deleteMany({
              where: { legalSourceVersionId: { in: ids } },
            });
            await tx.legalSourceActivationRecord.deleteMany({
              where: { legalSourceVersionId: { in: ids } },
            });
            await tx.legalSourceVersion.deleteMany({
              where: { id: { in: ids } },
            });
            await tx.legalSource.delete({ where: { id: source.id } });

            const eventId = randomUUID();
            const event = legalSourceDeletedEventSchema.parse({
              schemaVersion: LEGAL_SOURCE_EVENT_SCHEMA_VERSIONS.deletion,
              eventId,
              sourceId: source.id,
              deletedVersionIds: ids,
              deletionReceiptId,
              reasonCode: request.reason.code,
              actor: { id: input.actorId, type: AUDIT_ACTOR_TYPES.user },
              correlationId: input.correlationId,
              idempotencyKey: request.idempotencyKey,
              occurredAt: new Date().toISOString(),
            });
            const outboxEventId = await this.outbox.enqueue(
              buildOutboxMessageInput({
                aggregateType: OUTBOX_AGGREGATE_TYPES.legalSource,
                aggregateId: source.id,
                eventType: LEGAL_SOURCE_EVENT_TYPES.legalSourceDeleted,
                correlationId: input.correlationId,
                causationId: deletionReceiptId,
                actor: { id: input.actorId, type: AUDIT_ACTOR_TYPES.user },
                result: LEGAL_SOURCE_EVENT_TYPES.legalSourceDeleted,
                redactionStatus: AUDIT_REDACTION_STATUSES.none,
                idempotencyKey: `${source.id}:${request.idempotencyKey}:deleted`,
                payload: event,
              }),
              tx,
            );
            const auditEventId = await this.audit.writeInTxReturningId(
              {
                eventType: AUDIT_EVENT_TYPES.legalSourceDeleted,
                actorId: input.actorId,
                actor: { id: input.actorId, type: AUDIT_ACTOR_TYPES.user },
                resourceType: AUDIT_RESOURCE_TYPES.legalSource,
                resourceId: source.id,
                reasonCode: request.reason.code,
                decision: AUDIT_DECISIONS.allow,
                correlationId: input.correlationId,
                redactionStatus: AUDIT_REDACTION_STATUSES.none,
                payload: {
                  sourceId: source.id,
                  sourceSlug: source.slug,
                  deletedVersionIds: ids,
                  deletedDocumentRowIds: documents.map(
                    (document) => document.id,
                  ),
                  deletedPreparationRunIds: preparationIds,
                  deletedRuleSetVersionIds: ruleSetIds,
                  reasonCode: request.reason.code,
                  reasonText: request.reason.text,
                  idempotencyKey: request.idempotencyKey,
                  deletionReceiptId,
                  outboxEventId,
                },
              },
              tx,
            );
            const completedReceipt = await tx.legalSourceDeletionReceipt.update(
              {
                where: { id: receipt.id },
                data: { auditEventId, outboxEventId },
              },
            );
            return this.receiptResponse(completedReceipt, false);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (attempt < 2 && isRetryableTransactionConflict(error)) continue;
        throw error;
      }
    }
  }

  /**
   * Business purpose: Build the authoritative read projection used to explain whether source-owned records can be removed safely.
   *
   * Business rules:
   * - Assessments, reports, nonterminal jobs, active ingestion, and unsettled owned outbox work block deletion; shared blobs are counted separately.
   *
   * Execution flow:
   * 1. Load the source and its versions with owned document, preparation, Rule Set, graph, and activation counts.
   * 2. Resolve protected references, ingestion settlement, outbox state, snapshots, and surviving blob ownership.
   * 3. Return the contract projection with blockers and an impact ETag.
   *
   * Failure cases:
   * - A missing source returns the canonical 404 problem; query failures propagate without presenting an empty eligible result.
   *
   * Side effects:
   * - Read-only transaction queries; does not reserve or mutate any resource.
   */
  private async loadImpact(
    tx: DeletionClient,
    sourceId: string,
    correlationId: string,
  ) {
    const source = await tx.legalSource.findUnique({
      where: { id: sourceId },
      include: {
        versions: {
          orderBy: { id: "asc" },
          include: {
            _count: {
              select: {
                documents: true,
                chunks: true,
                activations: true,
                ruleSetPreparationRuns: true,
                ruleSetVersions: true,
                documentMaterializations: true,
              },
            },
          },
        },
      },
    });
    if (!source) {
      throw problemException(
        LEGAL_SOURCE_DELETION_ERROR_CODES.sourceNotFound,
        correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    const versionIds = source.versions.map((version) => version.id);
    const documents = versionIds.length
      ? await tx.legalSourceDocument.findMany({
          where: { legalSourceVersionId: { in: versionIds } },
          orderBy: { id: "asc" },
          select: {
            id: true,
            documentId: true,
            blobSha256: true,
            ingestionState: true,
            ingestionAttempt: true,
            legalSourceVersionId: true,
          },
        })
      : [];
    const documentIds = documents.map((document) => document.id);
    const preparationRuns = versionIds.length
      ? await tx.ruleSetPreparationRun.findMany({
          where: { legalSourceVersionId: { in: versionIds } },
          orderBy: { id: "asc" },
          select: {
            id: true,
            executionState: true,
            legalSourceVersionId: true,
          },
        })
      : [];
    const preparationIds = preparationRuns.map((run) => run.id);
    const ruleSets = versionIds.length
      ? await tx.complianceRuleSetVersion.findMany({
          where: { legalSourceVersionId: { in: versionIds } },
          orderBy: { id: "asc" },
          select: { id: true, legalSourceVersionId: true },
        })
      : [];
    const ruleSetIds = ruleSets.map((ruleSet) => ruleSet.id);
    const outboxAggregateIds = [
      source.id,
      ...versionIds,
      ...preparationIds,
      ...ruleSetIds,
    ];

    const [
      chunks,
      graphNodes,
      graphReferences,
      cases,
      auditRequests,
      finalReports,
      pendingOutbox,
      ownedOutbox,
      externalBaseReferences,
      externalActivationReferences,
      mixedReactivations,
      prepAssessmentEvents,
      snapshots,
      distinctBlobs,
    ] = await Promise.all([
      versionIds.length
        ? tx.legalDocumentChunk.count({
            where: { legalSourceVersionId: { in: versionIds } },
          })
        : 0,
      versionIds.length
        ? tx.legalDocumentNode.count({
            where: { legalSourceVersionId: { in: versionIds } },
          })
        : 0,
      versionIds.length
        ? tx.legalDocumentReference.count({
            where: { legalSourceVersionId: { in: versionIds } },
          })
        : 0,
      ruleSetIds.length
        ? tx.assessmentCase.count({
            where: { ruleSetVersionId: { in: ruleSetIds } },
          })
        : 0,
      ruleSetIds.length
        ? tx.assessmentRuleAuditRequest.count({
            where: { ruleSetVersionId: { in: ruleSetIds } },
          })
        : 0,
      ruleSetIds.length
        ? tx.assessmentArtifact.count({
            where: {
              ruleSetVersionId: { in: ruleSetIds },
              kind: AssessmentArtifactKind.FINAL_REPORT,
            },
          })
        : 0,
      outboxAggregateIds.length
        ? tx.outboxMessage.count({
            where: {
              aggregateId: { in: outboxAggregateIds },
              status: { in: [...OUTBOX_REPLAYABLE_STATES] },
            },
          })
        : 0,
      outboxAggregateIds.length
        ? tx.outboxMessage.count({
            where: {
              aggregateId: { in: outboxAggregateIds },
              status: OutboxStatus.OWNED_PENDING,
            },
          })
        : 0,
      versionIds.length
        ? tx.legalSourceVersion.count({
            where: {
              basedOnVersionId: { in: versionIds },
              legalSourceId: { not: source.id },
            },
          })
        : 0,
      ruleSetIds.length
        ? tx.complianceRuleSetActivationRecord.count({
            where: {
              previousActiveRuleSetVersionId: { in: ruleSetIds },
              ruleSetVersionId: { notIn: ruleSetIds },
            },
          })
        : 0,
      ruleSetIds.length
        ? tx.complianceRuleSetReactivationRecord.count({
            where: {
              OR: [
                {
                  targetRuleSetVersionId: { in: ruleSetIds },
                  previousRuleSetVersionId: { notIn: ruleSetIds },
                },
                {
                  previousRuleSetVersionId: { in: ruleSetIds },
                  targetRuleSetVersionId: { notIn: ruleSetIds },
                },
              ],
            },
          })
        : 0,
      preparationIds.length
        ? tx.assessmentRuntimeEvent.count({
            where: {
              preparationRunId: { in: preparationIds },
              assessmentId: { not: null },
            },
          })
        : 0,
      documentIds.length
        ? tx.legalSourceSnapshot.count({
            where: {
              documentId: {
                in: documents.map((document) => document.documentId),
              },
            },
          })
        : 0,
      this.countDeletableBlobs(tx, versionIds),
    ]);

    const versionDetails = await Promise.all(
      source.versions.map(async (version) => {
        const versionDocuments = documents.filter(
          (document) => document.legalSourceVersionId === version.id,
        );
        const versionPreparationIds = preparationRuns
          .filter((run) => run.legalSourceVersionId === version.id)
          .map((run) => run.id);
        const versionRuleSetIds = ruleSets
          .filter((ruleSet) => ruleSet.legalSourceVersionId === version.id)
          .map((ruleSet) => ruleSet.id);
        const [
          assessmentCount,
          assessmentAuditCount,
          reports,
          provenanceCount,
        ] = ruleSets.some(
          (ruleSet) => ruleSet.legalSourceVersionId === version.id,
        )
          ? await Promise.all([
              tx.assessmentCase.count({
                where: { ruleSet: { legalSourceVersionId: version.id } },
              }),
              tx.assessmentRuleAuditRequest.count({
                where: {
                  ruleSetVersionId: {
                    in: ruleSets
                      .filter(
                        (ruleSet) =>
                          ruleSet.legalSourceVersionId === version.id,
                      )
                      .map((ruleSet) => ruleSet.id),
                  },
                },
              }),
              tx.assessmentArtifact.count({
                where: {
                  ruleSetVersionId: {
                    in: ruleSets
                      .filter(
                        (ruleSet) =>
                          ruleSet.legalSourceVersionId === version.id,
                      )
                      .map((ruleSet) => ruleSet.id),
                  },
                  kind: AssessmentArtifactKind.FINAL_REPORT,
                },
              }),
              tx.legalRequirementProvenance.count({
                where: { legalSourceVersionId: version.id },
              }),
            ])
          : [0, 0, 0, 0];
        const versionRuns = preparationRuns.filter(
          (run) => run.legalSourceVersionId === version.id,
        );
        const nonterminalPreparations = versionRuns.filter((run) =>
          NONTERMINAL_PREPARATION_STATES.includes(run.executionState),
        ).length;
        const versionRules = ruleSets.filter(
          (ruleSet) => ruleSet.legalSourceVersionId === version.id,
        );
        const [nonterminalAssessments, versionGraphCount] = await Promise.all([
          versionRules.length
            ? tx.assessmentCase.count({
                where: {
                  ruleSetVersionId: {
                    in: versionRules.map((ruleSet) => ruleSet.id),
                  },
                  assessment: {
                    lifecycleState: {
                      notIn: [
                        AssessmentLifecycleState.COMPLETE,
                        AssessmentLifecycleState.FAILED,
                        AssessmentLifecycleState.CANCELLED,
                      ],
                    },
                  },
                },
              })
            : 0,
          tx.legalDocumentMaterialization.count({
            where: { legalSourceVersionId: version.id },
          }),
        ]);
        const [pendingDocuments, processingDocuments, failedDocuments] = [
          versionDocuments.filter(
            (document) =>
              document.ingestionState ===
              LegalSourceDocumentIngestionState.PENDING,
          ).length,
          versionDocuments.filter(
            (document) =>
              document.ingestionState ===
              LegalSourceDocumentIngestionState.PROCESSING,
          ).length,
          versionDocuments.filter(
            (document) =>
              document.ingestionState ===
              LegalSourceDocumentIngestionState.FAILED,
          ).length,
        ];
        return {
          versionId: version.id,
          version: version.version,
          status: fromPrismaLegalSourceLifecycleStatus(version.status),
          activatedEver: Boolean(
            version.activatedAt || version._count.activations,
          ),
          references: {
            legalSourceDocuments: version._count.documents,
            chunks: version._count.chunks,
            activationRecords: version._count.activations,
            preparationRuns: version._count.ruleSetPreparationRuns,
            ruleSetVersions: version._count.ruleSetVersions,
            assessments: assessmentCount,
            assessmentRuleAuditRequests: assessmentAuditCount,
            finalReports: reports,
            provenanceReferences: provenanceCount,
            documentGraphMaterializations: versionGraphCount,
          },
          ingestion: {
            pendingDocuments,
            processingDocuments,
            failedDocuments,
            unsettledAttempts: pendingDocuments + processingDocuments,
            unsettledOutboxMessages:
              versionPreparationIds.length || versionRuleSetIds.length
                ? await tx.outboxMessage.count({
                    where: {
                      aggregateId: {
                        in: [
                          version.id,
                          ...versionPreparationIds,
                          ...versionRuleSetIds,
                        ],
                      },
                      status: OutboxStatus.OWNED_PENDING,
                    },
                  })
                : await tx.outboxMessage.count({
                    where: {
                      aggregateId: version.id,
                      status: OutboxStatus.OWNED_PENDING,
                    },
                  }),
          },
          nonterminalPreparations,
          nonterminalAssessments,
        };
      }),
    );

    const blockers = new Set<LegalSourceDeletionBlocker>();
    if (
      cases +
        auditRequests +
        finalReports +
        externalBaseReferences +
        externalActivationReferences +
        mixedReactivations +
        prepAssessmentEvents >
      0
    )
      blockers.add(LEGAL_SOURCE_DELETION_BLOCKERS.protectedReferenceExists);
    if (
      preparationRuns.some((run) =>
        NONTERMINAL_PREPARATION_STATES.includes(run.executionState),
      )
    )
      blockers.add(LEGAL_SOURCE_DELETION_BLOCKERS.nonterminalWorkExists);
    if (
      documents.some(
        (document) =>
          document.ingestionState ===
            LegalSourceDocumentIngestionState.PENDING ||
          document.ingestionState ===
            LegalSourceDocumentIngestionState.PROCESSING,
      )
    )
      blockers.add(LEGAL_SOURCE_DELETION_BLOCKERS.unsettledIngestionExists);
    if (ownedOutbox > 0)
      blockers.add(LEGAL_SOURCE_DELETION_BLOCKERS.unsettledOutboxExists);

    const referencedBlobHashes = [
      ...new Set(
        documents.flatMap((document) =>
          document.blobSha256 ? [document.blobSha256] : [],
        ),
      ),
    ];
    const [
      sharedBlobCount,
      materializationCount,
      graphMappings,
      units,
      semanticGraphs,
      requirements,
      assessmentRules,
      activations,
    ] = await Promise.all([
      referencedBlobHashes.length
        ? tx.legalSourceDocument.count({
            where: {
              blobSha256: { in: referencedBlobHashes },
              legalSourceVersionId: { notIn: versionIds },
            },
          })
        : 0,
      tx.legalDocumentMaterialization.count({
        where: { legalSourceVersionId: { in: versionIds } },
      }),
      versionIds.length
        ? tx.legalDocumentChunkNode.count({
            where: { legalSourceVersionId: { in: versionIds } },
          })
        : 0,
      versionIds.length
        ? tx.legalDocumentRetrievalUnit.count({
            where: { legalSourceVersionId: { in: versionIds } },
          })
        : 0,
      ruleSetIds.length
        ? tx.legalSemanticGraph.count({
            where: { legalSourceVersionId: { in: versionIds } },
          })
        : 0,
      ruleSetIds.length
        ? tx.legalRequirement.count({
            where: { ruleSetVersionId: { in: ruleSetIds } },
          })
        : 0,
      ruleSetIds.length
        ? tx.assessmentRule.count({
            where: { ruleSetVersionId: { in: ruleSetIds } },
          })
        : 0,
      versionIds.length
        ? tx.legalSourceActivationRecord.count({
            where: { legalSourceVersionId: { in: versionIds } },
          })
        : 0,
    ]);
    const ownedRuleSetRecords = ruleSetIds.length
      ? (
          await Promise.all([
            tx.legalSemanticClaim.count({
              where: { ruleSetVersionId: { in: ruleSetIds } },
            }),
            tx.legalSemanticClaimSource.count({
              where: { ruleSetVersionId: { in: ruleSetIds } },
            }),
            tx.legalSemanticClaimRelation.count({
              where: { ruleSetVersionId: { in: ruleSetIds } },
            }),
            tx.legalRequirementClaimBinding.count({
              where: { ruleSetVersionId: { in: ruleSetIds } },
            }),
            tx.legalRequirementProvenance.count({
              where: { ruleSetVersionId: { in: ruleSetIds } },
            }),
            tx.legalRequirementContextRelation.count({
              where: { ruleSetVersionId: { in: ruleSetIds } },
            }),
            tx.assessmentRuleLegalRequirement.count({
              where: { ruleSetVersionId: { in: ruleSetIds } },
            }),
            tx.ruleCatalogGroupMembership.count({
              where: { ruleSetVersionId: { in: ruleSetIds } },
            }),
            tx.ruleCatalogGroupingProposal.count({
              where: { ruleSetVersionId: { in: ruleSetIds } },
            }),
            tx.complianceRuleSetActivationRecord.count({
              where: { ruleSetVersionId: { in: ruleSetIds } },
            }),
            tx.complianceRuleSetReactivationRecord.count({
              where: {
                OR: [
                  { targetRuleSetVersionId: { in: ruleSetIds } },
                  { previousRuleSetVersionId: { in: ruleSetIds } },
                ],
              },
            }),
          ])
        ).reduce(
          (total, count) => total + count,
          requirements + assessmentRules,
        )
      : 0;
    const digestState = {
      source: { id: source.id, slug: source.slug, name: source.name },
      versions: source.versions.map((version) => ({
        id: version.id,
        version: version.version,
        status: version.status,
        activatedAt: version.activatedAt,
        createdAt: version.createdAt,
        counts: version._count,
      })),
      documents: documents.map((document) => ({
        id: document.id,
        blob: document.blobSha256,
        state: document.ingestionState,
        attempt: document.ingestionAttempt,
      })),
      preparationRuns: preparationRuns.map((run) => ({
        id: run.id,
        state: run.executionState,
      })),
      ruleSets: ruleSets.map((ruleSet) => ruleSet.id),
      blockers: [...blockers].sort(),
      pendingOutbox,
      ownedOutbox,
      cases,
      auditRequests,
      finalReports,
      externalBaseReferences,
      externalActivationReferences,
      mixedReactivations,
      prepAssessmentEvents,
    };
    const etag = `sha256:${createHash("sha256").update(JSON.stringify(digestState)).digest("hex")}`;
    const byStatus = Object.fromEntries(
      Object.values(LegalSourceLifecycleStatus).map((status) => [
        status,
        source.versions.filter((version) => version.status === status).length,
      ]),
    );
    return {
      source: { id: source.id, slug: source.slug, name: source.name },
      snapshot: { etag, generatedAt: new Date().toISOString() },
      preflightOnly: true as const,
      versions: versionDetails,
      cascade: {
        documents: documents.length,
        chunks,
        activationRecords: activations,
        preparationRuns: preparationRuns.length,
        ruleSetVersions: ruleSetIds.length,
        ownedRuleSetRecords,
        documentGraphRecords:
          graphNodes +
          graphReferences +
          graphMappings +
          units +
          materializationCount +
          semanticGraphs,
        orphanedBlobs: distinctBlobs,
      },
      versionCounts: { total: source.versions.length, byStatus },
      sharedBlobs: {
        referencedBySurvivingDocuments: sharedBlobCount,
        eligibleForGarbageCollection: distinctBlobs,
      },
      retention: {
        independentSnapshots: snapshots,
        snapshotsWillBePreserved: true as const,
        auditEvidenceWillBePreserved: true as const,
        retentionHold: false,
      },
      eligibility: {
        eligibleAtSnapshot: blockers.size === 0,
        blockers: [...blockers],
      },
    };
  }

  /**
   * Business purpose: Count original blobs eligible for collection after the selected source documents are removed.
   *
   * Business rules:
   * - A content-addressed blob is eligible only when no document outside the deleting versions references its digest.
   *
   * Execution flow:
   * 1. Collect distinct non-null hashes owned by the selected versions.
   * 2. Count surviving document references for each hash and return the number with none.
   *
   * Failure cases:
   * - Database query failures propagate and prevent the deletion preview or transaction from claiming safe cleanup.
   *
   * Side effects:
   * - Read-only count queries; blob rows are not changed by this helper.
   */
  private async countDeletableBlobs(tx: DeletionClient, versionIds: string[]) {
    if (versionIds.length === 0) return 0;
    const hashes = await tx.legalSourceDocument.findMany({
      where: {
        legalSourceVersionId: { in: versionIds },
        blobSha256: { not: null },
      },
      select: { blobSha256: true },
      distinct: ["blobSha256"],
    });
    let count = 0;
    for (const row of hashes) {
      if (!row.blobSha256) continue;
      const surviving = await tx.legalSourceDocument.count({
        where: {
          blobSha256: row.blobSha256,
          legalSourceVersionId: { notIn: versionIds },
        },
      });
      if (surviving === 0) count += 1;
    }
    return count;
  }

  /**
   * Business purpose: Remove generated Rule Set descendants owned by the source's preparation outputs before deleting their parents.
   *
   * Business rules:
   * - Delete only descendants whose Rule Set Version or Preparation Run identity is in the locked source-owned set; protected assessment references have already blocked entry.
   *
   * Execution flow:
   * 1. Remove semantic, provenance, grouping, requirement, and assessment-rule links.
   * 2. Remove Rule Set activation/reactivation records that refer to those owned outputs.
   * 3. Delete the generated Rule Set Versions after their foreign-key dependents.
   *
   * Failure cases:
   * - Foreign-key or persistence failures abort the enclosing transaction and restore the complete tree.
   *
   * Side effects:
   * - Deletes only the supplied owned Rule Set tree inside the caller's transaction.
   */
  private async deleteRuleSetTrees(
    tx: DeletionClient,
    ruleSetIds: string[],
    preparationIds: string[],
  ) {
    if (ruleSetIds.length === 0) return;
    const scope = { ruleSetVersionId: { in: ruleSetIds } };
    await tx.legalSemanticClaimRelation.deleteMany({ where: scope });
    await tx.legalSemanticClaimSource.deleteMany({ where: scope });
    await tx.legalRequirementClaimBinding.deleteMany({ where: scope });
    await tx.legalRequirementProvenance.deleteMany({ where: scope });
    await tx.legalRequirementContextRelation.deleteMany({ where: scope });
    await tx.assessmentRuleLegalRequirement.deleteMany({ where: scope });
    await tx.ruleCatalogGroupMembership.deleteMany({ where: scope });
    await tx.ruleCatalogGroupingProposal.deleteMany({ where: scope });
    await tx.legalSemanticClaim.deleteMany({ where: scope });
    await tx.legalSemanticGraph.deleteMany({ where: scope });
    await tx.legalRequirement.deleteMany({ where: scope });
    await tx.assessmentRule.deleteMany({ where: scope });
    await tx.complianceRuleSetReactivationRecord.deleteMany({
      where: {
        OR: [
          { targetRuleSetVersionId: { in: ruleSetIds } },
          { previousRuleSetVersionId: { in: ruleSetIds } },
        ],
      },
    });
    await tx.complianceRuleSetActivationRecord.deleteMany({
      where: {
        OR: [
          { ruleSetVersionId: { in: ruleSetIds } },
          { previousActiveRuleSetVersionId: { in: ruleSetIds } },
          { preparationRunId: { in: preparationIds } },
        ],
      },
    });
    await tx.complianceRuleSetVersion.deleteMany({
      where: { id: { in: ruleSetIds } },
    });
  }

  /**
   * Business purpose: Remove persisted review and execution artifacts owned by the selected Preparation Runs.
   *
   * Business rules:
   * - Only run IDs derived from the locked source versions are eligible; nonterminal work blocks deletion before this helper is called.
   *
   * Execution flow:
   * 1. Delete source-review, scope-review, frontier, inventory, authoring-draft, and runtime-event children.
   * 2. Delete the Preparation Run rows after their dependent records.
   *
   * Failure cases:
   * - Any constraint or write failure aborts the enclosing source-deletion transaction.
   *
   * Side effects:
   * - Physically deletes the supplied preparation-owned database rows only.
   */
  private async deletePreparationTrees(
    tx: DeletionClient,
    preparationIds: string[],
  ) {
    if (preparationIds.length === 0) return;
    const scope = { preparationRunId: { in: preparationIds } };
    await tx.ruleSetPreparationSourceReview.deleteMany({ where: scope });
    await tx.ruleSetPreparationScopeReview.deleteMany({ where: scope });
    await tx.ruleSetPreparationReviewFrontier.deleteMany({ where: scope });
    await tx.ruleSetPreparationClaimInventory.deleteMany({ where: scope });
    await tx.ruleSetPreparationAuthoringDraft.deleteMany({ where: scope });
    await tx.assessmentRuntimeEvent.deleteMany({ where: scope });
    await tx.ruleSetPreparationRun.deleteMany({
      where: { id: { in: preparationIds } },
    });
  }

  /**
   * Business purpose: Remove document graph materializations owned by the source versions before removing source documents.
   *
   * Business rules:
   * - Graph records are scoped by the locked version IDs and are removed only as part of the owning source deletion transaction.
   *
   * Execution flow:
   * 1. Delete graph edges, chunk nodes, retrieval units, and references.
   * 2. Defer the self-parent constraint for the transaction and delete graph nodes and materializations.
   *
   * Failure cases:
   * - Constraint or database failures abort the complete deletion transaction.
   *
   * Side effects:
   * - Physically deletes version-owned graph rows; does not touch independent snapshots.
   */
  private async deleteSourceGraphs(tx: DeletionClient, versionIds: string[]) {
    if (versionIds.length === 0) return;
    const scope = { legalSourceVersionId: { in: versionIds } };
    await tx.legalDocumentReference.deleteMany({ where: scope });
    await tx.legalDocumentChunkNode.deleteMany({ where: scope });
    await tx.legalDocumentRetrievalUnit.deleteMany({ where: scope });
    await tx.$executeRaw(
      Prisma.sql`SET CONSTRAINTS "LegalNode_parent_fkey" DEFERRED`,
    );
    await tx.legalDocumentNode.deleteMany({ where: scope });
    await tx.legalDocumentMaterialization.deleteMany({ where: scope });
  }

  /**
   * Business purpose: Remove source-owned document and chunk rows while collecting only blobs that have no surviving document owner.
   *
   * Business rules:
   * - Delete rows only under the selected version IDs; retain any content-addressed blob referenced by another document.
   *
   * Execution flow:
   * 1. Delete chunks and source-document rows for the locked versions.
   * 2. Recount references for each distinct original hash.
   * 3. Delete a blob only when the remaining reference count is zero.
   *
   * Failure cases:
   * - Query or delete failures propagate so the enclosing transaction restores all source rows and blobs.
   *
   * Side effects:
   * - Removes owned documents/chunks and eligible orphan blobs within the caller transaction.
   */
  private async deleteSourceDocuments(
    tx: DeletionClient,
    versionIds: string[],
    documents: Array<{ id: string; blobSha256: string | null }>,
  ) {
    if (versionIds.length === 0) return;
    await tx.legalDocumentChunk.deleteMany({
      where: { legalSourceVersionId: { in: versionIds } },
    });
    await tx.legalSourceDocument.deleteMany({
      where: { legalSourceVersionId: { in: versionIds } },
    });
    const blobHashes = [
      ...new Set(
        documents.flatMap((document) =>
          document.blobSha256 ? [document.blobSha256] : [],
        ),
      ),
    ];
    for (const sha256 of blobHashes) {
      const remainingReferences = await tx.legalSourceDocument.count({
        where: { blobSha256: sha256 },
      });
      if (remainingReferences === 0) {
        await tx.legalSourceDocumentBlob.deleteMany({ where: { sha256 } });
      }
    }
  }

  /**
   * Business purpose: Bind a deletion idempotency key to the caller, source, confirmation snapshot, and reason payload.
   *
   * Business rules:
   * - The digest excludes only the idempotency key itself so reuse with a different request is detected.
   *
   * Execution flow:
   * 1. Serialize the canonical request identity fields in stable property order.
   * 2. Return the SHA-256 digest used by the durable deletion receipt.
   *
   * Failure cases:
   * - Hashing is deterministic for validated request values; invalid input is rejected before this helper runs.
   *
   * Side effects:
   * - Pure computation; no persistence or external calls.
   */
  private requestDigest(
    sourceId: string,
    actorId: string,
    request: DeleteLegalSourceRequest,
  ) {
    return createHash("sha256")
      .update(
        JSON.stringify({
          sourceId,
          actorId,
          expectedImpactEtag: request.expectedImpactEtag,
          confirmationSlug: request.confirmationSlug,
          reason: request.reason,
        }),
      )
      .digest("hex");
  }

  /**
   * Business purpose: Return the canonical deletion result from its durable receipt for first execution or idempotent replay.
   *
   * Business rules:
   * - The response contains identifiers and retention facts only; replay status reflects whether this request reused a committed receipt.
   *
   * Execution flow:
   * 1. Project persisted receipt columns into the shared deletion-response contract.
   * 2. Validate the projection before returning it to the controller.
   *
   * Failure cases:
   * - Malformed persisted JSON or timestamps fail response validation rather than producing an untyped success body.
   *
   * Side effects:
   * - Pure response mapping; the receipt is not changed.
   */
  private receiptResponse(
    receipt: {
      sourceId: string;
      id: string;
      deletedVersionIds: Prisma.JsonValue;
      deletedAt: Date;
      retainedIndependentSnapshotCount: number;
    },
    idempotentReplay: boolean,
  ) {
    return deleteLegalSourceResponseSchema.parse({
      sourceId: receipt.sourceId,
      deletionReceiptId: receipt.id,
      deletedVersionIds: receipt.deletedVersionIds,
      deletedAt: receipt.deletedAt.toISOString(),
      retainedIndependentSnapshotCount:
        receipt.retainedIndependentSnapshotCount,
      retainedAuditEvidence: true,
      idempotentReplay,
    });
  }
}
