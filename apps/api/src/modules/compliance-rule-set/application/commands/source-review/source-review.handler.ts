import { REFERENCE_ONLY_TARGET_REASON } from "@lcsp/contracts/legal-source";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  Prisma,
  AgentExecutionState,
  SourceReviewState,
  PreparationExecutionContract,
  type RuleSetPreparationSourceReview,
} from "@prisma/client";
import {
  SOURCE_REVIEW_ACTIONS as A,
  SOURCE_REVIEW_STATES as S,
  SOURCE_REVIEW_DISPOSITIONS as D,
  SOURCE_REVIEW_GAPS as G,
  LEGAL_REFERENCE_RESOLUTION_STATES as R,
  REFERENCE_DEPENDENCY_STATES as DEP,
  type LegalDocumentGraph,
} from "@lcsp/contracts/legal-source";
import {
  sourceReviewPayloadSchema,
  ruleSetPreparationAuthoringDraftSchema,
  CLAIM_INVENTORY_GAPS,
  COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES as O,
  CLAIM_PREPARATION_PHASES as P,
  CLAIM_DISCOVERY_MODES,
  LEGAL_SEMANTIC_CLAIM_TYPES as C,
  COMPLIANCE_RULE_SET_FAILURE_CODES as F,
  type UnitReviewCompletion,
} from "@lcsp/contracts/compliance-rule-set";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { LegalDocumentGraphService } from "../../../../legal-source/application/services/legal-document-graph.service.js";
import {
  canonicalClaimId,
  inventoryHash,
} from "../../../domain/claim-inventory.js";
import {
  sourceReviewUnits,
  referenceOnlyNodeIds,
  reviewReferenceOwners,
  frontierDefinitionFingerprint,
  reviewedFrontierFingerprint,
  completedReviewStates,
  reviewItemStateFingerprint,
  xorReviewHash,
  zeroReviewAccumulator,
  normalizeReviewPayload,
  reviewCompletionFingerprint,
} from "../../../domain/source-review-frontier.js";
import { semanticReferenceBindings } from "../../../domain/semantic-reference-binding.js";
import { pinnedMaterializationId } from "../../../infrastructure/persistence/preparation-inventory.persistence.js";
import { sourceSupportFailures } from "../../../domain/source-completeness.js";
import {
  claimEndpointFingerprint,
  referenceDependencyView,
  referenceDependencyWake,
  invalidateDependentPayload,
} from "../../../domain/reference-dependencies.js";
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
          action = "commit_claims",
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
          if (input.action !== A.INIT)
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
          const graph = await this.graph.export(
            run.legalSourceVersionId,
            await pinnedMaterializationId(tx, run.id),
          );
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
        if (
          input.action === A.INIT &&
          run.executionState === AgentExecutionState.RUNNING &&
          !run.reviewOperationId
        ) {
          await tx.ruleSetPreparationRun.update({
            where: { id: run.id },
            data: { reviewOperationId: input.operationId },
          });
          run.reviewOperationId = input.operationId;
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
        let completionRows: RuleSetPreparationSourceReview[] | undefined;
        let dependencySnapshot:
          Awaited<ReturnType<typeof loadDependencies>> | undefined;
        const loadDependencies = async () => {
          const graph = await this.graph.export(
            run.legalSourceVersionId,
            frontier!.materializationId,
          );
          if (!graph || graph.materializationId !== frontier!.materializationId)
            throw new Error("Pinned structural materialization is unavailable");
          const rows =
            completionRows ??
            (await tx.ruleSetPreparationSourceReview.findMany({
              where: key,
            }));
          return {
            graph,
            rows,
            view: referenceDependencyView(
              graph,
              rows,
              run.id,
              input.inventoryRevision,
            ),
          };
        };
        const dependencies = async () =>
          (dependencySnapshot ??= await loadDependencies());
        const reconcileBlocked = async () => {
          if (
            !frontier!.blockedCount ||
            frontier!.frozenAt ||
            run.claimPhase !== P.CLAIM_DISCOVERY ||
            run.executionState !== AgentExecutionState.RUNNING
          )
            return;
          const { rows, view } = await dependencies();
          for (const item of rows.filter(
            (r) => r.state === SourceReviewState.BLOCKED_REFERENCE,
          )) {
            if (!referenceDependencyWake(item, view).wake) continue;
            await tx.ruleSetPreparationSourceReview.update({
              where: {
                preparationRunId_inventoryRevision_sourceNodeId: itemKey(
                  item.sourceNodeId,
                ),
              },
              data: {
                state: SourceReviewState.REOPENED,
                operationId: null,
                leaseExpiresAt: null,
              },
            });
            await changed(
              { node: item.sourceNodeId, endpointPublication: true },
              item,
            );
          }
          dependencySnapshot = undefined;
        };
        const invalidateDependents = async (
          previous: RuleSetPreparationSourceReview,
          payload: NonNullable<typeof input.payload>,
        ) => {
          const old = new Map(
            reviewPayload(previous).claims.map((c) => [
              c.claimId,
              claimEndpointFingerprint(c),
            ]),
          );
          const current = new Map(
            payload.claims.map((c) => [c.claimId, claimEndpointFingerprint(c)]),
          );
          const changedIds = new Set(
            [...old]
              .filter(([id, fingerprint]) => current.get(id) !== fingerprint)
              .map(([id]) => id),
          );
          if (!changedIds.size) return [];
          dependencySnapshot = undefined;
          const { rows } = await dependencies();
          const invalidated: string[] = [];
          for (const row of rows) {
            if (row.sourceNodeId === previous.sourceNodeId) continue;
            const before = reviewPayload(row);
            const affected = new Set(
              [...changedIds].filter(
                (id) =>
                  !current.has(id) ||
                  before.dependencyFingerprints?.[id] !== current.get(id),
              ),
            );
            const after = invalidateDependentPayload(before, affected);
            if (!after || inventoryHash(after) === inventoryHash(before))
              continue;
            await tx.ruleSetPreparationSourceReview.update({
              where: {
                preparationRunId_inventoryRevision_sourceNodeId: itemKey(
                  row.sourceNodeId,
                ),
              },
              data: {
                state: SourceReviewState.REOPENED,
                payload: after,
                reason:
                  "Committed semantic endpoint changed; reconsider the invalidated bindings",
                completedAt: null,
                operationId: null,
                leaseExpiresAt: null,
              },
            });
            await changed(
              { node: row.sourceNodeId, endpointInvalidation: true },
              row,
            );
            invalidated.push(row.sourceNodeId);
          }
          dependencySnapshot = undefined;
          return invalidated;
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
        if (
          input.sourceRevision &&
          input.sourceRevision !== frontier.materializationId
        )
          return failed(
            G.STALE,
            "sourceRevision",
            "Reload the pinned structural materialization",
          );
        if (input.action === A.PROGRESS) await reconcileBlocked();
        if (
          input.action === A.PROGRESS &&
          (input.referenceIds?.length || input.claimIds?.length)
        ) {
          if (
            (input.referenceIds?.length ?? 0) > 20 ||
            (input.claimIds?.length ?? 0) > 128
          )
            return failed(
              G.REFERENCE,
              "referenceIds",
              "Inspect at most twenty references or 128 endpoints at once",
            );
          const { view } = await dependencies();
          const offset = input.offset ?? 0,
            limit = input.limit ?? 10;
          return reply({
            referenceTargets: (input.referenceIds ?? []).map((id) => {
              const { claims, ...target } = view.target(id);
              return {
                ...target,
                targetClaims: claims.slice(offset, offset + limit),
                targetClaimCount: claims.length,
                hasMore: offset + limit < claims.length,
              };
            }),
            endpoints: (input.claimIds ?? []).flatMap((id) =>
              view.endpoints.has(id) ? [view.endpoints.get(id)!] : [],
            ),
          });
        }
        if (input.action === A.INIT || input.action === A.PROGRESS)
          return reply();
        if (input.action === A.LOAD) {
          const limit = input.limit ?? 20,
            offset = input.offset ?? 0;
          const loadedThrough = input.updatedThrough
            ? new Date(input.updatedThrough)
            : new Date();
          const records = await tx.ruleSetPreparationSourceReview.findMany({
            where: {
              ...key,
              state: { not: SourceReviewState.PENDING },
              updatedAt: input.updatedSince
                ? { gte: new Date(input.updatedSince), lte: loadedThrough }
                : { lte: loadedThrough },
            },
            orderBy: { ordinal: "asc" },
            skip: offset,
            take: limit + 1,
          });
          return reply({
            loadedThrough: loadedThrough.toISOString(),
            records: records.slice(0, limit).map((record) => ({
              ...record,
              payload: reviewPayload(record),
            })),
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

        const validateCompletion = async (
          input: SourceReviewCommand["request"],
          existing: RuleSetPreparationSourceReview,
        ) => {
          const quarantined = new Set(
            input.payload?.invalidatedRelationIds ?? [],
          );
          if (quarantined.size) {
            const previous = existing ? reviewPayload(existing) : null;
            if (
              input.disposition !== D.REQUIRES_REFERENCE_RESOLUTION ||
              [...quarantined].some(
                (id) =>
                  !previous?.invalidatedRelationIds?.includes(id) ||
                  inventoryHash(
                    previous.relations.find((r) => r.relationId === id) ?? null,
                  ) !==
                    inventoryHash(
                      input.payload!.relations.find(
                        (r) => r.relationId === id,
                      ) ?? null,
                    ),
              )
            )
              return failed(
                G.DEPENDENCY,
                input.sourceNodeId ?? "unit",
                "Only unchanged previously invalidated decisions may be retained as blocked repair evidence",
              );
          }
          if (input.payload?.relations.some((r) => r.referenceId)) {
            const graph = await this.graph.export(
              run.legalSourceVersionId,
              frontier!.materializationId,
            );
            if (
              !graph ||
              graph.materializationId !== frontier!.materializationId
            )
              return failed(
                G.STALE,
                "sourceRevision",
                "Reload the pinned structural materialization",
              );
            const { view } = await dependencies();
            const claims = new Map(
              [
                ...[...view.endpoints.values()].map((e) => e.claim),
                ...input.payload.claims,
              ].map((c) => [c.claimId, c]),
            );
            const binding = semanticReferenceBindings(
              graph,
              run.legalSourceVersionId,
              frontier!.materializationId,
            );
            for (const relation of input.payload.relations) {
              if (!relation.referenceId || quarantined.has(relation.relationId))
                continue;
              const detached = binding.failure(relation, claims);
              if (detached)
                return { outcome: O.FAILED, failures: [detached], ...detached };
            }
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
            );
          const payload = input.payload;
          const completionFingerprint = reviewCompletionFingerprint({
            ...input,
            payload,
          });
          if (
            existing.completionFingerprint === completionFingerprint &&
            (completedReviewStates.includes(existing.state as never) ||
              existing.state === S.BLOCKED_REFERENCE)
          )
            return {
              existing,
              payload,
              completionFingerprint,
              alreadyCompleted: true,
              state: existing.state,
            };
          if (
            !([S.PENDING, S.REOPENED, S.IN_REVIEW] as string[]).includes(
              existing.state,
            ) ||
            (existing.state === S.IN_REVIEW &&
              existing.operationId !== input.operationId &&
              !!existing.leaseExpiresAt &&
              existing.leaseExpiresAt > new Date())
          )
            return failed(
              G.LEASE,
              existing.sourceNodeId,
              "Another operation owns an unexpired review lease, or this unit must be reopened",
            );
          const referenceOnly = referenceOnlyNodeIds(
            (await dependencies()).graph,
          );
          if (
            payload.claims.some(
              (c) =>
                c.operative !== null &&
                [
                  ...c.sourceNodeIds,
                  ...(c.sourceSupport ?? []).map((s) => s.nodeId),
                ].some((id) => referenceOnly.has(id)),
            )
          )
            return failed(
              G.BINDING,
              existing.sourceNodeId,
              "Reference-only documents cannot support claims; use them only as legalEffect targets",
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
            );
          const anchors = [
            ...new Set(payload.claims.flatMap((c) => c.sourceNodeIds)),
          ];
          const conflicts = owned.size
            ? (await dependencies()).rows.filter(
                (r) =>
                  r.sourceNodeId !== existing.sourceNodeId &&
                  r.claimIds.some((id) => owned.has(id)),
              )
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
                materializationId: frontier!.materializationId,
                legalSourceVersionId: run.legalSourceVersionId,
                nodeId: { in: anchors },
              },
            })) !== anchors.length
          )
            return failed(
              G.BINDING,
              existing.sourceNodeId,
              "Claim source nodes must exist in this exact source revision",
            );
          if (
            input.claimIds.length !== new Set(input.claimIds).size ||
            [...owned].some((id) => !input.claimIds!.includes(id))
          )
            return failed(
              G.BINDING,
              existing.sourceNodeId,
              "Include every claim authored in this review; omitted canonical IDs are returned",
              "commit_claims",
              {
                expectedClaimIds: [...owned],
                missingClaimIds: [...owned].filter(
                  (id) => !input.claimIds!.includes(id),
                ),
              },
            );
          const linked = input.claimIds.filter((id) => !owned.has(id));
          const otherRows = linked.length
            ? (await dependencies()).rows.filter((r) =>
                r.claimIds.some((id) => linked.includes(id)),
              )
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
                  !([C.CONTEXT, C.DEFINITION] as string[]).includes(
                    c.claimType,
                  ),
              ) ||
                !input.claimIds.length)) ||
            (input.disposition === D.CLAIMS_AUTHORED && !input.claimIds.length)
          )
            return failed(
              G.DISPOSITION,
              existing.sourceNodeId,
              "No-claim needs zero claims and a reason; context-only cannot hide a normative claim",
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
            );
          const relationIds = new Set(
            payload.relations.map((r) => r.relationId),
          );
          const endpoints = [
            ...new Set(
              payload.relations
                .filter((r) => !quarantined.has(r.relationId))
                .flatMap((r) => [r.fromClaimId, r.toClaimId])
                .filter((id) => !owned.has(id)),
            ),
          ];
          const { view: endpointView } = await dependencies();
          if (
            payload.invalidatedRelationIds?.length &&
            input.disposition !== D.REQUIRES_REFERENCE_RESOLUTION
          )
            return failed(
              G.DEPENDENCY,
              existing.sourceNodeId,
              "Explicitly repair invalidated semantic bindings before completion",
            );
          for (const id of endpoints) {
            const endpoint = endpointView.endpoints.get(id);
            if (!endpoint)
              return failed(
                G.ENDPOINT,
                id,
                "The cross-review endpoint must be a valid committed canonical claim",
              );
            if (payload.dependencyFingerprints?.[id] !== endpoint.fingerprint)
              return failed(
                G.DEPENDENCY,
                id,
                "The committed target meaning changed or was not inspected; reconsider this binding",
              );
          }
          if (payload.relations.some((r) => r.fromClaimId === r.toClaimId))
            return failed(
              G.BINDING,
              existing.sourceNodeId,
              "Relation endpoints must be distinct canonical claims",
            );
          const refs = await tx.legalDocumentReference.findMany({
            where: {
              materializationId: frontier!.materializationId,
              referenceId: { in: existing.referenceIds },
            },
          });
          const blocked = input.disposition === D.REQUIRES_REFERENCE_RESOLUTION;
          delete payload.blockedSourceNodeIds;
          if (blocked && !input.referenceIds?.length) {
            // With no structural reference to wait on, a unit may wait for the reopened units whose relations touch its claims.
            const waitsFor = (await dependencies()).rows
              .filter(
                (r) =>
                  r.state === S.REOPENED &&
                  reviewPayload(r).relations.some(
                    (rel) =>
                      owned.has(rel.fromClaimId) || owned.has(rel.toClaimId),
                  ),
              )
              .map((r) => r.sourceNodeId)
              .sort();
            if (waitsFor.length) payload.blockedSourceNodeIds = waitsFor;
          }
          if (blocked) {
            payload.blockedEndpointFingerprints = {};
            for (const id of input.referenceIds ?? []) {
              const target = endpointView.target(id);
              if (referenceOnly.has(target.targetNodeId ?? ""))
                return failed(
                  G.REFERENCE,
                  id,
                  "Use non-material REFERENCE_ONLY_TARGET for a reference-only target; no target claim or review is required",
                );
              if (target.classification === DEP.OUTSIDE_SCOPE)
                return failed(
                  G.REFERENCE,
                  id,
                  "The resolved target is outside scope; explicitly expand before blocking",
                  "commit_claims",
                );
              payload.blockedEndpointFingerprints[id] =
                target.endpointFingerprint;
              if (target.bindingCanProceed)
                return failed(
                  G.REFERENCE,
                  id,
                  "Durable target claims are available; bind them, or explicitly reopen a target that needs semantic correction",
                );
            }
          }
          if (
            blocked &&
            (!input.reason ||
              (!input.referenceIds?.length &&
                !payload.blockedSourceNodeIds?.length) ||
              input.referenceIds?.some(
                (id) => !refs.some((r) => r.referenceId === id),
              ))
          )
            return failed(
              G.REFERENCE,
              existing.sourceNodeId,
              "Blocking needs specific outgoing reference IDs, or a reopened unit whose relations touch this unit's claims, and a reason",
            );
          const { graph: depGraph } = await dependencies();
          const { within } = semanticReferenceBindings(
            depGraph,
            run.legalSourceVersionId,
            frontier!.materializationId,
          );
          for (const ref of refs) {
            const accounting = payload.referenceAccounting.find(
              (r) => r.referenceId === ref.referenceId,
            );
            if (
              ref.toNodeId &&
              referenceOnly.has(ref.toNodeId) &&
              !accounting?.material &&
              (accounting?.nonMaterialReason !== REFERENCE_ONLY_TARGET_REASON ||
                accounting.relationIds.length ||
                input.referenceIds?.includes(ref.referenceId))
            )
              return failed(
                G.REFERENCE,
                ref.referenceId,
                "Use non-material REFERENCE_ONLY_TARGET for a reference-only target",
              );
            if (
              accounting?.nonMaterialReason === REFERENCE_ONLY_TARGET_REASON &&
              (!ref.toNodeId || !referenceOnly.has(ref.toNodeId))
            )
              return failed(
                G.REFERENCE,
                ref.referenceId,
                "REFERENCE_ONLY_TARGET is only permitted for references that resolve to a verified reference-only target node",
              );
            if (blocked && input.referenceIds?.includes(ref.referenceId))
              continue;
            const hasLegalEffect = Boolean(
              ref.toNodeId &&
              payload.claims.some((c) =>
                c.semanticFrame?.legalEffect?.targets.some(
                  (t) =>
                    t.nodeId === ref.toNodeId ||
                    (t.scope === "SUBTREE" && within(ref.toNodeId!, t.nodeId)),
                ),
              ),
            );
            if (
              !accounting ||
              (!accounting.material &&
                payload.relations.some(
                  (r) => r.referenceId === ref.referenceId,
                )) ||
              (accounting.material &&
                (ref.resolutionState !== R.RESOLVED ||
                  (!hasLegalEffect && !accounting.relationIds.length) ||
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
              );
          }
          if (!blocked) {
            const { graph } = await dependencies();
            for (const claim of payload.claims) {
              const gaps = sourceSupportFailures(claim, graph);
              if (gaps.length)
                return failed(
                  F.SOURCE_SUPPORT_INVALID,
                  claim.claimId,
                  gaps.join(", "),
                );
            }
          }
          return {
            existing,
            payload,
            completionFingerprint,
            alreadyCompleted: false,
            state: blocked
              ? SourceReviewState.BLOCKED_REFERENCE
              : input.claimIds.length
                ? SourceReviewState.REVIEWED_WITH_CLAIMS
                : SourceReviewState.REVIEWED_NO_CLAIMS,
          };
        };
        if (input.action === A.COMPLETE) {
          const direct =
            run.executionContract ===
            PreparationExecutionContract.DIRECT_DRAFT_V1;
          const draftKey = {
            preparationRunId_revision: {
              preparationRunId: run.id,
              revision: input.inventoryRevision,
            },
          };
          const savedDraft = direct
            ? await tx.ruleSetPreparationAuthoringDraft.findUnique({
                where: draftKey,
              })
            : null;
          const parsedDraft = direct
            ? ruleSetPreparationAuthoringDraftSchema.safeParse(input.draft)
            : null;
          const draftVersion = savedDraft?.draftVersion ?? 0;
          if (
            direct &&
            (!parsedDraft?.success || input.draftVersion === undefined)
          )
            return failed(
              CLAIM_INVENTORY_GAPS.SCHEMA,
              "draft",
              "Direct preparation requires typed candidates and their loaded draft version",
            );
          if (
            direct &&
            input.draftVersion !== draftVersion &&
            !(
              input.draftVersion === draftVersion - 1 &&
              savedDraft &&
              inventoryHash(savedDraft.draft) ===
                inventoryHash(parsedDraft!.data)
            )
          )
            return failed(
              CLAIM_INVENTORY_GAPS.DRAFT_STALE,
              "draftVersion",
              "Reload the persisted draft before editing it",
            );
          if (
            direct &&
            Object.values(parsedDraft!.data!.legalRequirements).some(
              (r) => r.claimInventoryRevision !== input.inventoryRevision,
            )
          )
            return failed(
              CLAIM_INVENTORY_GAPS.STALE,
              "draft",
              "Requirements must bind this exact source review revision",
            );
          if (!direct && input.draft)
            return failed(
              G.BINDING,
              "draft",
              "Historical preparation contracts cannot accept direct drafts",
            );
          if (!input.sourceRevision || !input.frontierRevision)
            return failed(
              G.STALE,
              "sourceRevision",
              "Supply the pinned source and frontier revisions",
            );
          if (
            !run.reviewOperationId ||
            run.reviewOperationId !== input.operationId
          )
            return failed(
              G.LEASE,
              "operationId",
              "Initialize this run's review operation before completing units",
            );
          const batch: (Partial<UnitReviewCompletion> & {
            sourceNodeId: string;
          })[] =
            input.batch ??
            (input.sourceNodeId
              ? [{ ...input, sourceNodeId: input.sourceNodeId }]
              : []);
          if (
            !batch.length ||
            new Set(batch.map((u) => u.sourceNodeId)).size !== batch.length
          )
            return failed(
              G.BINDING,
              "batch",
              "Supply distinct source review units",
            );
          const original = (await dependencies()).rows;
          const candidates = new Map<string, SourceReviewCommand["request"]>(
            batch.map(
              (unit) =>
                [
                  unit.sourceNodeId,
                  {
                    ...input,
                    ...unit,
                    payload: unit.payload
                      ? normalizeReviewPayload(unit.payload)
                      : unit.payload,
                  },
                ] as const,
            ),
          );
          const failures = new Map<string, Record<string, unknown>>();
          let valid: Map<
            string,
            Awaited<ReturnType<typeof validateCompletion>>
          >;
          // Remove failed endpoints and revalidate dependents before any write; cycles survive together.
          do {
            const before = candidates.size;
            completionRows = original.map((row) => {
              const unit = candidates.get(row.sourceNodeId);
              return unit?.payload
                ? {
                    ...row,
                    payload: unit.payload,
                    claimIds: unit.claimIds ?? [],
                    state:
                      unit.disposition === D.REQUIRES_REFERENCE_RESOLUTION
                        ? SourceReviewState.BLOCKED_REFERENCE
                        : unit.claimIds?.length
                          ? SourceReviewState.REVIEWED_WITH_CLAIMS
                          : SourceReviewState.REVIEWED_NO_CLAIMS,
                    completionFingerprint: reviewCompletionFingerprint(
                      unit as Parameters<typeof reviewCompletionFingerprint>[0],
                    ),
                  }
                : row;
            });
            dependencySnapshot = undefined;
            valid = new Map();
            for (const [id, unit] of candidates) {
              const row = original.find((r) => r.sourceNodeId === id);
              const result = row
                ? await validateCompletion(unit, row)
                : failed(G.BINDING, id, "Unit not found in frontier");
              if ("existing" in result) valid.set(id, result);
              else {
                failures.set(id, result);
              }
            }
            for (const id of failures.keys()) candidates.delete(id);
            if (before === candidates.size) break;
          } while (candidates.size);
          completionRows = undefined;
          dependencySnapshot = undefined;
          // A direct package acknowledges candidates and their evidence together, never a partial write.
          if (direct && failures.size)
            return {
              outcome: O.FAILED,
              completedSourceNodeIds: [],
              failures: [...failures].map(([sourceNodeId, failure]) => ({
                sourceNodeId,
                failure,
              })),
            };
          const completed: Extract<
            Awaited<ReturnType<typeof validateCompletion>>,
            { existing: RuleSetPreparationSourceReview }
          >[] = [];
          for (const [id, result] of valid) {
            if (!("existing" in result) || !candidates.has(id)) continue;
            const unit = candidates.get(id)!;
            if (!result.alreadyCompleted) {
              const blocked =
                result.state === SourceReviewState.BLOCKED_REFERENCE;
              await tx.ruleSetPreparationSourceReview.update({
                where: {
                  preparationRunId_inventoryRevision_sourceNodeId: itemKey(id),
                },
                data: {
                  state: result.state,
                  disposition: unit.disposition,
                  reason: unit.reason ?? null,
                  claimIds: unit.claimIds,
                  ownedClaimCount: result.payload.claims.length,
                  payload: result.payload,
                  completionFingerprint: result.completionFingerprint,
                  blockedReferenceIds: blocked ? (unit.referenceIds ?? []) : [],
                  operationId: null,
                  leaseExpiresAt: null,
                  completedAt: blocked ? null : new Date(),
                },
              });
              await changed({ node: id }, result.existing);
            }
            completed.push(result);
          }
          dependencySnapshot = undefined;
          const invalidatedSourceReviews: string[] = [];
          for (const result of completed)
            if (!result.alreadyCompleted)
              invalidatedSourceReviews.push(
                ...(await invalidateDependents(
                  result.existing,
                  result.payload,
                )),
              );
          await reconcileBlocked();
          const rejected = [...failures].map(([sourceNodeId, failure]) => ({
            sourceNodeId,
            failure,
          }));
          if (!completed.length)
            return {
              ...rejected[0].failure,
              failures: input.batch ? rejected : rejected[0].failure.failures,
            };
          let acceptedDraftVersion = draftVersion;
          if (
            direct &&
            input.draftVersion === draftVersion &&
            (!savedDraft ||
              inventoryHash(savedDraft.draft) !==
                inventoryHash(parsedDraft!.data))
          ) {
            acceptedDraftVersion += 1;
            const draft = parsedDraft!.data! as Prisma.InputJsonValue;
            await tx.ruleSetPreparationAuthoringDraft.upsert({
              where: draftKey,
              create: {
                preparationRunId: run.id,
                revision: input.inventoryRevision,
                draft,
                draftVersion: acceptedDraftVersion,
              },
              update: { draft, draftVersion: acceptedDraftVersion },
            });
            await tx.ruleSetPreparationRun.update({
              where: { id: run.id },
              data: { draftValidation: Prisma.DbNull },
            });
          }
          return reply({
            ...(direct ? { draftVersion: acceptedDraftVersion } : {}),
            completedCount: completed.length,
            completedSourceNodeIds: completed.map(
              (r) => r.existing.sourceNodeId,
            ),
            completedSourceNodeId: completed[0].existing.sourceNodeId,
            state: completed[0].state,
            claimIds: completed.flatMap(
              (r) => candidates.get(r.existing.sourceNodeId)!.claimIds ?? [],
            ),
            alreadyCompleted: completed.every((r) => r.alreadyCompleted),
            invalidatedSourceReviews,
            ...(rejected.length ? { failures: rejected } : {}),
          });
        }

        if (!existing)
          return failed(
            G.BINDING,
            input.sourceNodeId ?? "unit",
            "Unit not found in frontier",
          );
        if (input.action === A.REOPEN) {
          if (!input.reason)
            return failed(
              G.DISPOSITION,
              existing.sourceNodeId,
              "Give an explicit review reopening reason",
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
              completionFingerprint: null,
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
                  previousCompletionFingerprint: existing.completionFingerprint,
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
              "commit_claims",
            );
          const graph = (await this.graph.export(
            run.legalSourceVersionId,
            frontier.materializationId,
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

        return failed(
          G.DISPOSITION,
          input.sourceNodeId ?? "unit",
          "Unsupported source review action",
        );
      },
      { timeout: 30000 },
    );
  }
}
