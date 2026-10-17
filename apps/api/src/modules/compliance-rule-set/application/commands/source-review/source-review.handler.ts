import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  Prisma,
  AgentExecutionState,
  SourceReviewState,
  type RuleSetPreparationSourceReview,
} from "@prisma/client";
import {
  SOURCE_REVIEW_ACTIONS as A,
  SOURCE_REVIEW_STATES as S,
  SOURCE_REVIEW_DISPOSITIONS as D,
  SOURCE_REVIEW_GAPS as G,
  LEGAL_REFERENCE_RESOLUTION_STATES as R,
  type LegalDocumentGraph,
  type LegalDocumentNode,
} from "@lcsp/contracts/legal-source";
import {
  sourceReviewPayloadSchema,
  COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES as O,
  CLAIM_PREPARATION_PHASES as P,
  CLAIM_DISCOVERY_MODES,
  LEGAL_SEMANTIC_CLAIM_TYPES as C,
} from "@lcsp/contracts/compliance-rule-set";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { LegalDocumentGraphService } from "../../../../legal-source/application/services/legal-document-graph.service.js";
import {
  canonicalClaimId,
  inventoryHash,
} from "../../../domain/claim-inventory.js";
import {
  sourceReviewUnits,
  reviewReferenceOwners,
  frontierDefinitionFingerprint,
  reviewedFrontierFingerprint,
  completedReviewStates,
  reviewItemStateFingerprint,
  xorReviewHash,
  zeroReviewAccumulator,
  normalizeReviewPayload,
} from "../../../domain/source-review-frontier.js";
import { semanticReferenceBindings } from "../../../domain/semantic-reference-binding.js";
import {
  SourceReviewCommand,
  StartClaimDiscoveryDiagnosticCommand,
} from "./source-review.command.js";

export function reviewPayload(item: RuleSetPreparationSourceReview) {
  return sourceReviewPayloadSchema.parse(item.payload);
}

@CommandHandler(StartClaimDiscoveryDiagnosticCommand)
export class StartClaimDiscoveryDiagnosticHandler implements ICommandHandler<StartClaimDiscoveryDiagnosticCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: LegalDocumentGraphService,
  ) {}
  async execute(input: StartClaimDiscoveryDiagnosticCommand) {
    const url = new URL(
      process.env.DATABASE_URL ?? "postgresql://disabled/disabled",
    );
    const isolated =
      /^lcsp-release-staging-[a-f0-9]{16}-postgres$/u.test(url.hostname) &&
      url.pathname === "/lcsp_staging";
    const localTest =
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
      url.pathname === "/lcsp_review_frontier_test";
    if (
      process.env.LEGAL_CLAIM_DISCOVERY_DIAGNOSTICS_ENABLED !== "true" ||
      !(isolated || localTest)
    )
      return {
        outcome: O.FAILED,
        failures: [
          {
            code: G.BINDING,
            ref: "diagnostic",
            detail:
              "Discovery-only sessions require an explicitly enabled isolated diagnostic database",
          },
        ],
      };
    const graph = await this.graph.export(input.legalSourceVersionId);
    if (!graph)
      return {
        outcome: O.FAILED,
        failures: [
          {
            code: G.BINDING,
            ref: "source",
            detail:
              "Materialize the immutable source graph before starting discovery",
          },
        ],
      };
    const run = await this.prisma.ruleSetPreparationRun.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      update: {},
      create: {
        idempotencyKey: input.idempotencyKey,
        legalSourceVersionId: input.legalSourceVersionId,
        requestedBy: "claim-discovery-diagnostic",
        correlationId: input.idempotencyKey,
        claimDiscoveryOnly: true,
        executionState: AgentExecutionState.RUNNING,
        startedAt: new Date(),
      },
    });
    if (
      !run.claimDiscoveryOnly ||
      run.legalSourceVersionId !== input.legalSourceVersionId
    )
      return {
        outcome: O.FAILED,
        failures: [
          {
            code: G.BINDING,
            ref: "diagnostic",
            detail: "Diagnostic idempotency key targets another source/session",
          },
        ],
      };
    const chunks = await this.prisma.legalDocumentChunk.findMany({
      where: { legalSourceVersionId: run.legalSourceVersionId },
    });
    return {
      outcome: O.PASSED,
      preparationRunId: run.id,
      mode: CLAIM_DISCOVERY_MODES.CLAIM_DISCOVERY_ONLY,
      documentGraph: graph,
      chunks,
    };
  }
}

@CommandHandler(SourceReviewCommand)
export class SourceReviewHandler implements ICommandHandler<SourceReviewCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: LegalDocumentGraphService,
  ) {}
  async execute({
    request: input,
  }: SourceReviewCommand): Promise<Record<string, unknown>> {
    if (input.payload)
      input = { ...input, payload: normalizeReviewPayload(input.payload) };
    // One row lock serializes scheduling, unit completion, freeze and explicit reopening.
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "RuleSetPreparationRun" WHERE id=${input.preparationRunId} FOR UPDATE`,
        );
        const run = await tx.ruleSetPreparationRun.findUnique({
          where: { id: input.preparationRunId },
        });
        const failed = (
          code: string,
          ref: string,
          detail: string,
          action = "get_next_review_unit",
          extra = {},
        ) => ({
          outcome: O.FAILED,
          failures: [{ code, ref, detail }],
          requiredAction: action,
          ...extra,
        });
        if (!run || input.inventoryRevision !== run.claimInventoryRevision)
          return failed(
            G.STALE,
            "inventoryRevision",
            "Reload the current inventory revision",
          );
        const key = {
          preparationRunId: run.id,
          inventoryRevision: input.inventoryRevision,
        };
        let frontier = await tx.ruleSetPreparationReviewFrontier.findUnique({
          where: { preparationRunId_inventoryRevision: key },
        });
        if (!frontier) {
          if (input.action !== A.INIT && input.action !== A.NEXT)
            return failed(
              G.INCOMPLETE,
              "frontier",
              "Request the first deterministic review unit",
            );
          if (
            run.executionState !== AgentExecutionState.RUNNING ||
            run.claimPhase !== P.CLAIM_DISCOVERY
          )
            return failed(
              G.STALE,
              "phase",
              "Review starts only during running claim discovery",
            );
          const graph = await this.graph.export(run.legalSourceVersionId);
          if (!graph)
            return failed(
              G.BINDING,
              "source",
              "The pinned document graph is unavailable",
              "report_rule_set_source_blocked",
            );
          let units = sourceReviewUnits(graph);
          if (input.scopeNodeIds) {
            if (
              !run.claimDiscoveryOnly ||
              input.scopeNodeIds.some(
                (id) => !units.some((n) => n.nodeId === id),
              )
            )
              return failed(
                G.BINDING,
                "scopeNodeIds",
                "Explicit diagnostic scope must select existing review units",
              );
            const selected = new Set(input.scopeNodeIds);
            units = units.filter((n) => selected.has(n.nodeId));
          }
          const referenceOwners = reviewReferenceOwners(graph);
          const referencesByOwner = new Map<string, string[]>();
          for (const ref of graph.references) {
            const owner = referenceOwners.get(ref.referenceId);
            if (owner) {
              const ids = referencesByOwner.get(owner) ?? [];
              ids.push(ref.referenceId);
              referencesByOwner.set(owner, ids);
            }
          }
          const fingerprint = frontierDefinitionFingerprint(
            graph.materializationId,
            1,
            units.map((n) => n.nodeId),
          );
          const stateAccumulator = units.reduce(
            (hash, n) =>
              xorReviewHash(
                hash,
                reviewItemStateFingerprint({
                  sourceNodeId: n.nodeId,
                  state: S.PENDING,
                }),
              ),
            zeroReviewAccumulator,
          );
          frontier = await tx.ruleSetPreparationReviewFrontier.create({
            data: {
              ...key,
              legalSourceVersionId: run.legalSourceVersionId,
              materializationId: graph.materializationId,
              fingerprint,
              stateAccumulator,
              stateFingerprint: inventoryHash({
                fingerprint,
                accumulator: stateAccumulator,
              }),
              unitCount: units.length,
              pendingCount: units.length,
              items: {
                create: units.map((n, ordinal) => ({
                  sourceNodeId: n.nodeId,
                  structuralPath: n.structuralPath,
                  ordinal,
                  stateFingerprint: reviewItemStateFingerprint({
                    sourceNodeId: n.nodeId,
                    state: S.PENDING,
                  }),
                  referenceIds: referencesByOwner.get(n.nodeId) ?? [],
                })),
              },
            },
          });
        }
        const itemKey = (sourceNodeId: string) => ({ ...key, sourceNodeId });
        const progress = () => ({
          total: frontier!.unitCount,
          pending: frontier!.pendingCount,
          inReview: frontier!.inReviewCount,
          reviewedWithClaims: frontier!.reviewedWithClaimsCount,
          reviewedNoClaims: frontier!.reviewedNoClaimsCount,
          blocked: frontier!.blockedCount,
          persistedClaims: frontier!.persistedClaimCount,
          discoveryCompleteEligible:
            frontier!.unitCount > 0 &&
            frontier!.pendingCount +
              frontier!.inReviewCount +
              frontier!.blockedCount ===
              0,
        });
        const bucket: Record<string, string> = {
          [S.PENDING]: "pendingCount",
          [S.REOPENED]: "pendingCount",
          [S.IN_REVIEW]: "inReviewCount",
          [S.REVIEWED_WITH_CLAIMS]: "reviewedWithClaimsCount",
          [S.REVIEWED_NO_CLAIMS]: "reviewedNoClaimsCount",
          [S.BLOCKED_REFERENCE]: "blockedCount",
        };
        const changed = async (
          _change: unknown,
          previous?: RuleSetPreparationSourceReview,
        ) => {
          const counters: Record<string, { increment: number }> = {};
          let accumulator = frontier!.stateAccumulator;
          if (previous) {
            const current =
              await tx.ruleSetPreparationSourceReview.findUniqueOrThrow({
                where: {
                  preparationRunId_inventoryRevision_sourceNodeId: itemKey(
                    previous.sourceNodeId,
                  ),
                },
              });
            const fingerprint = reviewItemStateFingerprint(current);
            accumulator = xorReviewHash(
              xorReviewHash(accumulator, previous.stateFingerprint),
              fingerprint,
            );
            if (bucket[previous.state] !== bucket[current.state]) {
              counters[bucket[previous.state]] = { increment: -1 };
              counters[bucket[current.state]] = { increment: 1 };
            }
            counters.persistedClaimCount = {
              increment: current.ownedClaimCount - previous.ownedClaimCount,
            };
            await tx.ruleSetPreparationSourceReview.update({
              where: {
                preparationRunId_inventoryRevision_sourceNodeId: itemKey(
                  previous.sourceNodeId,
                ),
              },
              data: { stateFingerprint: fingerprint },
            });
          }
          frontier = await tx.ruleSetPreparationReviewFrontier.update({
            where: { preparationRunId_inventoryRevision: key },
            data: {
              ...counters,
              stateAccumulator: accumulator,
              stateFingerprint: inventoryHash({
                fingerprint: frontier!.fingerprint,
                accumulator,
              }),
            },
          });
        };
        const wakeBlocked = async (completedNodeId: string) => {
          const completedTargets: string[] = [completedNodeId];
          let node = await tx.legalDocumentNode.findUniqueOrThrow({
            where: {
              nodeId_materializationId: {
                nodeId: completedNodeId,
                materializationId: frontier!.materializationId,
              },
            },
          });
          const visited = new Set<string>();
          while (node.parentNodeId && !visited.has(node.nodeId)) {
            visited.add(node.nodeId);
            node = await tx.legalDocumentNode.findUniqueOrThrow({
              where: {
                nodeId_materializationId: {
                  nodeId: node.parentNodeId,
                  materializationId: frontier!.materializationId,
                },
              },
            });
            const unfinished =
              await tx.ruleSetPreparationSourceReview.findFirst({
                where: {
                  ...key,
                  structuralPath: { startsWith: node.structuralPath + "/" },
                  state: { notIn: completedReviewStates },
                },
                select: { sourceNodeId: true },
              });
            if (unfinished) break;
            completedTargets.push(node.nodeId);
          }
          const incoming = await tx.legalDocumentReference.findMany({
            where: {
              materializationId: frontier!.materializationId,
              toNodeId: { in: completedTargets },
            },
            select: { referenceId: true },
          });
          if (!incoming.length) return;
          const waiting = await tx.ruleSetPreparationSourceReview.findMany({
            where: {
              ...key,
              state: SourceReviewState.BLOCKED_REFERENCE,
              blockedReferenceIds: {
                hasSome: incoming.map((r) => r.referenceId),
              },
            },
          });
          for (const item of waiting) {
            const references = await tx.legalDocumentReference.findMany({
              where: {
                materializationId: frontier!.materializationId,
                referenceId: { in: item.blockedReferenceIds },
              },
            });
            let ready = references.length === item.blockedReferenceIds.length;
            for (const ref of references) {
              if (!ref.toNodeId || ref.resolutionState !== R.RESOLVED) {
                ready = false;
                break;
              }
              const target = await tx.legalDocumentNode.findUniqueOrThrow({
                where: {
                  nodeId_materializationId: {
                    nodeId: ref.toNodeId,
                    materializationId: frontier!.materializationId,
                  },
                },
              });
              const targetItems =
                await tx.ruleSetPreparationSourceReview.findMany({
                  where: {
                    ...key,
                    OR: [
                      { sourceNodeId: target.nodeId },
                      {
                        structuralPath: {
                          startsWith: target.structuralPath + "/",
                        },
                      },
                    ],
                  },
                  select: { state: true },
                });
              if (
                !targetItems.length ||
                targetItems.some(
                  (t) => !completedReviewStates.includes(t.state as never),
                )
              )
                ready = false;
            }
            if (ready) {
              await tx.ruleSetPreparationSourceReview.update({
                where: {
                  preparationRunId_inventoryRevision_sourceNodeId: itemKey(
                    item.sourceNodeId,
                  ),
                },
                data: { state: SourceReviewState.REOPENED },
              });
              await changed(
                { node: item.sourceNodeId, state: S.REOPENED },
                item,
              );
            }
          }
        };
        const reply = async (extra = {}) => {
          const currentProgress = progress();
          const reviewedFingerprint = currentProgress.discoveryCompleteEligible
            ? reviewedFrontierFingerprint(
                frontier!.fingerprint,
                await tx.ruleSetPreparationSourceReview.findMany({
                  where: key,
                }),
              )
            : null;
          return {
            outcome: O.PASSED,
            sourceRevision: frontier!.materializationId,
            frontierRevision: frontier!.revision,
            frontierFingerprint: frontier!.fingerprint,
            frontierStateFingerprint: frontier!.stateFingerprint,
            reviewedFrontierFingerprint: reviewedFingerprint,
            progress: currentProgress,
            ...extra,
          };
        };
        if (input.action === A.PROGRESS && input.referenceIds?.length) {
          if (input.referenceIds.length > 20)
            return failed(
              G.REFERENCE,
              "referenceIds",
              "Inspect at most twenty structural references at once",
            );
          const references = await tx.legalDocumentReference.findMany({
            where: {
              materializationId: frontier.materializationId,
              legalSourceVersionId: run.legalSourceVersionId,
              referenceId: { in: input.referenceIds },
            },
          });
          const targets: {
            referenceId: string;
            targetNodeId: string | null;
            inScope: boolean;
            reviewReady: boolean;
            pending: number;
          }[] = [];
          for (const ref of references) {
            const node = ref.toNodeId
              ? await tx.legalDocumentNode.findUnique({
                  where: {
                    nodeId_materializationId: {
                      nodeId: ref.toNodeId,
                      materializationId: frontier.materializationId,
                    },
                  },
                })
              : null;
            const items = node
              ? await tx.ruleSetPreparationSourceReview.findMany({
                  where: {
                    ...key,
                    OR: [
                      { sourceNodeId: node.nodeId },
                      {
                        structuralPath: {
                          startsWith: node.structuralPath + "/",
                        },
                      },
                    ],
                  },
                  select: { state: true },
                })
              : [];
            targets.push({
              referenceId: ref.referenceId,
              targetNodeId: ref.toNodeId,
              inScope: items.length > 0,
              reviewReady:
                items.length > 0 &&
                items.every((item) =>
                  completedReviewStates.includes(item.state as never),
                ),
              pending: items.filter(
                (item) => !completedReviewStates.includes(item.state as never),
              ).length,
            });
          }
          return reply({ referenceTargets: targets });
        }
        if (input.action === A.INIT || input.action === A.PROGRESS)
          return reply();
        if (input.action === A.LOAD) {
          const limit = input.limit ?? 20,
            offset = input.offset ?? 0;
          const records = await tx.ruleSetPreparationSourceReview.findMany({
            where: { ...key, state: { not: SourceReviewState.PENDING } },
            orderBy: { ordinal: "asc" },
            skip: offset,
            take: limit + 1,
          });
          return reply({
            records: records.slice(0, limit),
            nextOffset: records.length > limit ? offset + limit : null,
          });
        }
        if (
          (input.sourceRevision &&
            input.sourceRevision !== frontier.materializationId) ||
          (input.frontierRevision &&
            input.frontierRevision !== frontier.revision)
        )
          return failed(
            G.STALE,
            "sourceRevision",
            "Review targets a stale source/frontier revision",
          );
        const existing = input.sourceNodeId
          ? await tx.ruleSetPreparationSourceReview.findUnique({
              where: {
                preparationRunId_inventoryRevision_sourceNodeId: itemKey(
                  input.sourceNodeId,
                ),
              },
            })
          : null;
        if (
          input.action === A.COMPLETE &&
          input.payload?.relations.some((r) => r.referenceId)
        ) {
          const graph = await this.graph.export(run.legalSourceVersionId);
          if (!graph || graph.materializationId !== frontier.materializationId)
            return failed(
              G.STALE,
              "sourceRevision",
              "Reload the pinned structural materialization",
            );
          const ids = [
            ...new Set(
              input.payload.relations.flatMap((r) => [
                r.fromClaimId,
                r.toClaimId,
              ]),
            ),
          ];
          const rows = await tx.ruleSetPreparationSourceReview.findMany({
            where: {
              ...key,
              state: { in: completedReviewStates },
              claimIds: { hasSome: ids },
            },
          });
          const claims = new Map(
            [
              ...rows.flatMap((row) => reviewPayload(row).claims),
              ...input.payload.claims,
            ].map((c) => [c.claimId, c]),
          );
          const binding = semanticReferenceBindings(
            graph,
            run.legalSourceVersionId,
            frontier.materializationId,
          );
          for (const relation of input.payload.relations) {
            if (!relation.referenceId) continue;
            const detached = binding.failure(relation, claims);
            if (detached)
              return { outcome: O.FAILED, failures: [detached], ...detached };
          }
        }
        if (
          existing &&
          input.action === A.COMPLETE &&
          input.payload &&
          input.disposition &&
          input.claimIds &&
          completedReviewStates.includes(existing.state as never) &&
          existing.completionFingerprint ===
            inventoryHash({
              disposition: input.disposition,
              reason: input.reason ?? null,
              claimIds: [...input.claimIds].sort(),
              payload: input.payload,
              referenceIds: input.referenceIds ?? [],
            })
        )
          return reply({
            alreadyCompleted: true,
            completedSourceNodeId: existing.sourceNodeId,
            state: existing.state,
            claimIds: existing.claimIds,
          });
        if (
          frontier.frozenAt ||
          run.executionState !== AgentExecutionState.RUNNING ||
          run.claimPhase !== P.CLAIM_DISCOVERY
        )
          return failed(
            G.STALE,
            "frontier",
            "Frozen/finished discovery cannot mutate; reopen inventory explicitly",
            "reopen_semantic_claim_inventory",
          );

        if (input.action === A.NEXT) {
          let item = await tx.ruleSetPreparationSourceReview.findFirst({
            where: { ...key, state: SourceReviewState.IN_REVIEW },
          });
          if (
            item?.operationId !== input.operationId &&
            item?.leaseExpiresAt &&
            item.leaseExpiresAt > new Date()
          )
            return failed(
              G.LEASE,
              item.sourceNodeId,
              "Another logical operation owns the active review lease",
              "WAIT_FOR_REVIEW_LEASE",
            );
          if (!item)
            item = await tx.ruleSetPreparationSourceReview.findFirst({
              where: {
                ...key,
                state: {
                  in: [SourceReviewState.PENDING, SourceReviewState.REOPENED],
                },
              },
              orderBy: { ordinal: "asc" },
            });
          if (!item) {
            const blockedUnits =
              await tx.ruleSetPreparationSourceReview.findMany({
                where: { ...key, state: SourceReviewState.BLOCKED_REFERENCE },
                take: 3,
                orderBy: { ordinal: "asc" },
                select: {
                  sourceNodeId: true,
                  structuralPath: true,
                  blockedReferenceIds: true,
                },
              });
            return reply({
              unit: null,
              ...(blockedUnits.length
                ? { blockedUnits, requiredAction: "inspect_legal_node" }
                : {}),
            });
          }
          const previous = item;
          const previousState = item.state;
          item = await tx.ruleSetPreparationSourceReview.update({
            where: {
              preparationRunId_inventoryRevision_sourceNodeId: itemKey(
                item.sourceNodeId,
              ),
            },
            data: {
              state: SourceReviewState.IN_REVIEW,
              operationId: input.operationId,
              leaseExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
            },
          });
          if (previousState !== S.IN_REVIEW)
            await changed(
              { node: item.sourceNodeId, state: S.IN_REVIEW },
              previous,
            );
          const node = await tx.legalDocumentNode.findUniqueOrThrow({
            where: {
              nodeId_materializationId: {
                nodeId: item.sourceNodeId,
                materializationId: frontier.materializationId,
              },
            },
          });
          const ancestors: Pick<
            LegalDocumentNode,
            "nodeId" | "structuralPath" | "title" | "content"
          >[] = [];
          let parent = node.parentNodeId;
          while (parent && ancestors.length < 3) {
            const ancestor = await tx.legalDocumentNode.findUniqueOrThrow({
              where: {
                nodeId_materializationId: {
                  nodeId: parent,
                  materializationId: frontier.materializationId,
                },
              },
            });
            ancestors.push({
              nodeId: ancestor.nodeId,
              structuralPath: ancestor.structuralPath,
              title: ancestor.title,
              content: ancestor.content.slice(0, 2000),
            });
            parent = ancestor.parentNodeId;
          }
          const references = await tx.legalDocumentReference.findMany({
            where: {
              materializationId: frontier.materializationId,
              referenceId: { in: item.referenceIds },
            },
            orderBy: { referenceId: "asc" },
            take: 21,
          });
          return reply({
            unit: {
              ...item,
              node: { ...node, content: node.content.slice(0, 12000) },
              contentLength: node.content.length,
              contentTruncated: node.content.length > 12000,
              ancestors,
              references: references.slice(0, 20),
              moreReferences: references.length > 20,
              payload: reviewPayload(item),
            },
          });
        }

        if (!existing)
          return failed(
            G.BINDING,
            input.sourceNodeId ?? "unit",
            "Request the active review unit before disposition",
          );
        if (input.action === A.REOPEN) {
          if (!input.reason)
            return failed(
              G.DISPOSITION,
              existing.sourceNodeId,
              "Give an explicit review reopening reason",
              "reopen_source_review",
            );
          if (existing.state === S.REOPENED && existing.reason === input.reason)
            return reply({ alreadyReopened: true });
          if (existing.state === S.IN_REVIEW)
            return failed(
              G.LEASE,
              existing.sourceNodeId,
              "Complete or block the active unit before reopening it",
            );
          await tx.ruleSetPreparationSourceReview.update({
            where: {
              preparationRunId_inventoryRevision_sourceNodeId: itemKey(
                existing.sourceNodeId,
              ),
            },
            data: {
              state: SourceReviewState.REOPENED,
              reason: input.reason,
              completedAt: null,
              operationId: null,
              leaseExpiresAt: null,
            },
          });
          frontier = await tx.ruleSetPreparationReviewFrontier.update({
            where: { preparationRunId_inventoryRevision: key },
            data: {
              expansions: [
                ...(frontier.expansions as Prisma.JsonArray),
                {
                  kind: "SOURCE_REOPEN",
                  sourceNodeId: existing.sourceNodeId,
                  reason: input.reason,
                  revision: frontier.revision,
                },
              ],
            },
          });
          await changed(
            {
              node: existing.sourceNodeId,
              state: S.REOPENED,
              reason: input.reason,
            },
            existing,
          );
          return reply();
        }
        if (input.action === A.EXPAND) {
          if (!input.reason || !input.referenceIds?.length)
            return failed(
              G.REFERENCE,
              existing.sourceNodeId,
              "Explicit expansion needs a reason and reference edge IDs",
              "expand_review_frontier",
            );
          const graph = (await this.graph.export(
            run.legalSourceVersionId,
          )) as LegalDocumentGraph;
          if (graph.materializationId !== frontier.materializationId)
            return failed(
              G.STALE,
              "sourceRevision",
              "Structural materialization changed; stop and explicitly revise the inventory",
              "report_rule_set_source_blocked",
            );
          const selected = new Set<string>();
          const allUnits = sourceReviewUnits(graph);
          const referenceOwners = reviewReferenceOwners(graph);
          const referencesByOwner = new Map<string, string[]>();
          for (const ref of graph.references) {
            const owner = referenceOwners.get(ref.referenceId);
            if (owner) {
              const ids = referencesByOwner.get(owner) ?? [];
              ids.push(ref.referenceId);
              referencesByOwner.set(owner, ids);
            }
          }
          for (const id of input.referenceIds) {
            const ref = graph.references.find(
              (r) => r.referenceId === id && existing.referenceIds.includes(id),
            );
            if (!ref?.toNodeId)
              return failed(
                G.REFERENCE,
                id,
                "Reference target is unresolved; inspect its source edge",
                "inspect_legal_node",
              );
            const target = graph.nodes.find((n) => n.nodeId === ref.toNodeId)!;
            for (const unit of allUnits)
              if (
                unit.nodeId === target.nodeId ||
                unit.structuralPath.startsWith(target.structuralPath + "/")
              )
                selected.add(unit.nodeId);
          }
          const current = await tx.ruleSetPreparationSourceReview.findMany({
            where: key,
            select: { sourceNodeId: true },
          });
          const ids = new Set(current.map((i) => i.sourceNodeId));
          const additions = allUnits.filter(
            (n) => selected.has(n.nodeId) && !ids.has(n.nodeId),
          );
          if (additions.length) {
            await tx.ruleSetPreparationSourceReview.createMany({
              data: additions.map((n, index) => ({
                ...key,
                sourceNodeId: n.nodeId,
                structuralPath: n.structuralPath,
                ordinal: current.length + index,
                materializationId: frontier!.materializationId,
                legalSourceVersionId: run.legalSourceVersionId,
                stateFingerprint: reviewItemStateFingerprint({
                  sourceNodeId: n.nodeId,
                  state: S.PENDING,
                }),
                referenceIds: referencesByOwner.get(n.nodeId) ?? [],
              })),
            });
            const revision = frontier.revision + 1;
            frontier = await tx.ruleSetPreparationReviewFrontier.update({
              where: { preparationRunId_inventoryRevision: key },
              data: {
                revision,
                fingerprint: frontierDefinitionFingerprint(
                  frontier.materializationId,
                  revision,
                  [...ids, ...additions.map((n) => n.nodeId)],
                ),
                stateAccumulator: additions.reduce(
                  (hash, n) =>
                    xorReviewHash(
                      hash,
                      reviewItemStateFingerprint({
                        sourceNodeId: n.nodeId,
                        state: S.PENDING,
                      }),
                    ),
                  frontier.stateAccumulator,
                ),
                unitCount: { increment: additions.length },
                pendingCount: { increment: additions.length },
                expansions: [
                  ...(frontier.expansions as Prisma.JsonArray),
                  {
                    fromNodeId: existing.sourceNodeId,
                    referenceIds: input.referenceIds,
                    reason: input.reason,
                    revision,
                  },
                ],
              },
            });
            await changed({ expansion: input.referenceIds, revision });
          }
          return reply({
            added: additions.map((n) => n.nodeId),
            alreadyInFrontier: additions.length === 0,
          });
        }

        if (
          input.action !== A.COMPLETE ||
          !input.disposition ||
          !input.payload ||
          !input.claimIds ||
          !input.sourceRevision ||
          !input.frontierRevision
        )
          return failed(
            G.DISPOSITION,
            existing.sourceNodeId,
            "Supply a typed disposition, source/frontier revision, and the current unit's claim payload",
            "complete_source_review",
          );
        const payload = input.payload;
        const completionFingerprint = inventoryHash({
          disposition: input.disposition,
          reason: input.reason ?? null,
          claimIds: [...input.claimIds].sort(),
          payload,
          referenceIds: input.referenceIds ?? [],
        });
        if (
          existing.completionFingerprint === completionFingerprint &&
          completedReviewStates.includes(existing.state as never)
        )
          return reply({ alreadyCompleted: true, unit: existing.sourceNodeId });
        if (
          existing.state !== S.IN_REVIEW ||
          existing.operationId !== input.operationId ||
          !existing.leaseExpiresAt ||
          existing.leaseExpiresAt < new Date()
        )
          return failed(
            G.LEASE,
            existing.sourceNodeId,
            "Acquire/renew this unit's review lease before completing it",
          );
        const owned = new Set(payload.claims.map((c) => c.claimId));
        if (
          owned.size !== payload.claims.length ||
          Object.keys(payload.identities).length !== owned.size ||
          payload.claims.some(
            (c) =>
              !c.sourceNodeIds.includes(existing.sourceNodeId) ||
              c.legalSourceVersionId !== run.legalSourceVersionId ||
              canonicalClaimId(
                run.id,
                input.inventoryRevision,
                c.sourceNodeIds,
                payload.identities[c.claimId] ?? "",
              ) !== c.claimId,
          )
        )
          return failed(
            G.BINDING,
            existing.sourceNodeId,
            "Every owned claim must have a canonical identity and include this unit in its source bindings",
            "register_semantic_claim",
          );
        const anchors = [
          ...new Set(payload.claims.flatMap((c) => c.sourceNodeIds)),
        ];
        const conflicts = owned.size
          ? await tx.ruleSetPreparationSourceReview.findMany({
              where: {
                ...key,
                sourceNodeId: { not: existing.sourceNodeId },
                claimIds: { hasSome: [...owned] },
              },
            })
          : [];
        if (
          conflicts.some((row) =>
            reviewPayload(row).claims.some((c) => owned.has(c.claimId)),
          )
        )
          return failed(
            G.BINDING,
            existing.sourceNodeId,
            "This canonical claim already belongs to another review; link its existing ID instead",
            "get_claim_inventory",
          );
        if (
          (await tx.legalDocumentNode.count({
            where: {
              materializationId: frontier.materializationId,
              legalSourceVersionId: run.legalSourceVersionId,
              nodeId: { in: anchors },
            },
          })) !== anchors.length
        )
          return failed(
            G.BINDING,
            existing.sourceNodeId,
            "Claim source nodes must exist in this exact source revision",
            "update_semantic_claim",
          );
        if (
          input.claimIds.length !== new Set(input.claimIds).size ||
          [...owned].some((id) => !input.claimIds!.includes(id))
        )
          return failed(
            G.BINDING,
            existing.sourceNodeId,
            "Include every claim authored in this review; omitted canonical IDs are returned",
            "complete_source_review",
            {
              expectedClaimIds: [...owned],
              missingClaimIds: [...owned].filter(
                (id) => !input.claimIds!.includes(id),
              ),
            },
          );
        const linked = input.claimIds.filter((id) => !owned.has(id));
        const otherRows = linked.length
          ? await tx.ruleSetPreparationSourceReview.findMany({
              where: { ...key, claimIds: { hasSome: linked } },
            })
          : [];
        const otherClaims = otherRows.flatMap((r) => reviewPayload(r).claims);
        if (
          linked.some(
            (id) =>
              !otherClaims.some(
                (c) =>
                  c.claimId === id &&
                  c.sourceNodeIds.includes(existing.sourceNodeId),
              ),
          )
        )
          return failed(
            G.BINDING,
            existing.sourceNodeId,
            "Related claim IDs must exist and bind this source node",
            "get_claim_inventory",
          );
        if (
          (input.disposition === D.NO_RELEVANT_SEMANTIC_CLAIMS &&
            (input.claimIds.length || !input.reason)) ||
          (input.disposition === D.CONTEXT_ONLY &&
            ([
              ...payload.claims,
              ...otherClaims.filter((c) => linked.includes(c.claimId)),
            ].some(
              (c) =>
                !([C.CONTEXT, C.DEFINITION] as string[]).includes(c.claimType),
            ) ||
              !input.claimIds.length)) ||
          (input.disposition === D.CLAIMS_AUTHORED && !input.claimIds.length)
        )
          return failed(
            G.DISPOSITION,
            existing.sourceNodeId,
            "No-claim needs zero claims and a reason; context-only cannot hide a normative claim",
            "complete_source_review",
          );
        if (
          payload.referenceAccounting.some(
            (r) => !existing.referenceIds.includes(r.referenceId),
          ) ||
          payload.relations.some(
            (r) =>
              r.referenceId && !existing.referenceIds.includes(r.referenceId),
          )
        )
          return failed(
            G.REFERENCE,
            existing.sourceNodeId,
            "Use explicit references assigned to the active review unit",
            "review_source_reference",
          );
        const relationIds = new Set(payload.relations.map((r) => r.relationId));
        const endpoints = [
          ...new Set(
            payload.relations
              .flatMap((r) => [r.fromClaimId, r.toClaimId])
              .filter((id) => !owned.has(id)),
          ),
        ];
        const endpointRows = endpoints.length
          ? await tx.ruleSetPreparationSourceReview.findMany({
              where: { ...key, claimIds: { hasSome: endpoints } },
            })
          : [];
        const endpointClaims = new Set(
          endpointRows.flatMap((r) =>
            reviewPayload(r).claims.map((c) => c.claimId),
          ),
        );
        if (
          payload.relations.some((r) => r.fromClaimId === r.toClaimId) ||
          endpoints.some((id) => !endpointClaims.has(id))
        )
          return failed(
            G.BINDING,
            existing.sourceNodeId,
            "Relation endpoints must be existing canonical claims",
            "link_semantic_claims",
          );
        const refs = await tx.legalDocumentReference.findMany({
          where: {
            materializationId: frontier.materializationId,
            referenceId: { in: existing.referenceIds },
          },
        });
        const blocked = input.disposition === D.REQUIRES_REFERENCE_RESOLUTION;
        let waitingForTarget = false;
        if (blocked)
          for (const ref of refs.filter(
            (r) =>
              input.referenceIds?.includes(r.referenceId) &&
              r.toNodeId &&
              r.resolutionState === R.RESOLVED,
          )) {
            const target = await tx.legalDocumentNode.findUniqueOrThrow({
              where: {
                nodeId_materializationId: {
                  nodeId: ref.toNodeId!,
                  materializationId: frontier.materializationId,
                },
              },
            });
            const targetItems =
              await tx.ruleSetPreparationSourceReview.findMany({
                where: {
                  ...key,
                  OR: [
                    { sourceNodeId: target.nodeId },
                    {
                      structuralPath: {
                        startsWith: target.structuralPath + "/",
                      },
                    },
                  ],
                },
                select: { state: true },
              });
            if (!targetItems.length)
              return failed(
                G.REFERENCE,
                ref.referenceId,
                "The resolved target is outside scope; explicitly expand before blocking",
                "expand_review_frontier",
              );
            if (
              targetItems.some(
                (item) => !completedReviewStates.includes(item.state as never),
              )
            )
              waitingForTarget = true;
          }
        if (
          blocked &&
          (!input.reason ||
            !input.referenceIds?.length ||
            input.referenceIds.some(
              (id) => !refs.some((r) => r.referenceId === id),
            ))
        )
          return failed(
            G.REFERENCE,
            existing.sourceNodeId,
            "Blocking needs specific outgoing reference IDs and a reason",
            "complete_source_review",
          );
        if (
          blocked &&
          !waitingForTarget &&
          input.referenceIds!.every((id) =>
            refs.some(
              (ref) =>
                ref.referenceId === id && ref.resolutionState === R.RESOLVED,
            ),
          )
        )
          return failed(
            G.REFERENCE,
            existing.sourceNodeId,
            "Referenced review work is already complete; inspect the target claims and account for the reference instead of blocking",
            "inspect_semantic_reference_binding",
          );
        for (const ref of refs) {
          const accounting = payload.referenceAccounting.find(
            (r) => r.referenceId === ref.referenceId,
          );
          if (blocked && input.referenceIds!.includes(ref.referenceId))
            continue;
          if (
            !accounting ||
            (!accounting.material &&
              payload.relations.some(
                (r) => r.referenceId === ref.referenceId,
              )) ||
            (accounting.material &&
              (ref.resolutionState !== R.RESOLVED ||
                !accounting.relationIds.length ||
                accounting.nonMaterialReason !== null)) ||
            (!accounting.material &&
              (accounting.relationIds.length ||
                !accounting.nonMaterialReason)) ||
            accounting.relationIds.some(
              (id) =>
                !relationIds.has(id) ||
                payload.relations.find((r) => r.relationId === id)
                  ?.referenceId !== ref.referenceId,
            )
          )
            return failed(
              G.REFERENCE,
              ref.referenceId,
              "Review this explicit reference with valid linked relations or an Agent-authored non-material reason",
              "review_source_reference",
            );
        }
        const state = blocked
          ? SourceReviewState.BLOCKED_REFERENCE
          : input.claimIds.length
            ? SourceReviewState.REVIEWED_WITH_CLAIMS
            : SourceReviewState.REVIEWED_NO_CLAIMS;
        await tx.ruleSetPreparationSourceReview.update({
          where: {
            preparationRunId_inventoryRevision_sourceNodeId: itemKey(
              existing.sourceNodeId,
            ),
          },
          data: {
            state,
            disposition: input.disposition,
            reason: input.reason ?? null,
            claimIds: input.claimIds,
            ownedClaimCount: payload.claims.length,
            payload,
            completionFingerprint,
            blockedReferenceIds: blocked ? input.referenceIds! : [],
            operationId: null,
            leaseExpiresAt: null,
            completedAt: blocked ? null : new Date(),
          },
        });
        await changed(
          { node: existing.sourceNodeId, state, completionFingerprint },
          existing,
        );
        if (!blocked) await wakeBlocked(existing.sourceNodeId);
        return reply({
          completedSourceNodeId: existing.sourceNodeId,
          state,
          claimIds: input.claimIds,
        });
      },
      { timeout: 30000 },
    );
  }
}
