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

/**
 * Business purpose: Read one persisted source-review payload through the shared contract before using its claims and relationships.
 *
 * Business rules:
 * - Persisted review content must satisfy the public source-review payload schema; malformed stored data is not silently repaired.
 *
 * Execution flow:
 * 1. Parse the row's stored payload against the source-review contract.
 * 2. Return the typed claims, identities, relations, and accounting projection.
 *
 * Failure cases:
 * - Schema-invalid persisted payloads throw validation errors to the consuming review gate.
 *
 * Side effects:
 * - None; parses data in memory.
 */
export function reviewPayload(item: RuleSetPreparationSourceReview) {
  return sourceReviewPayloadSchema.parse(item.payload);
}

@CommandHandler(StartClaimDiscoveryDiagnosticCommand)
export class StartClaimDiscoveryDiagnosticHandler implements ICommandHandler<StartClaimDiscoveryDiagnosticCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: LegalDocumentGraphService,
  ) {}
  /**
   * Business purpose: Start or reuse a source-only claim-discovery session for an explicitly isolated diagnostic environment.
   *
   * Business rules:
   * - Diagnostics require the feature flag and one of the explicitly allowed isolated staging or local review databases.
   * - The immutable Legal Source graph must already be materialized; the idempotency key cannot be reused for another source or a non-diagnostic run.
   * - This diagnostic run cannot author Rules or conclude a customer Preparation.
   *
   * Execution flow:
   * 1. Verify the diagnostic flag and database identity allowlist.
   * 2. Export the existing source graph and fail if it is unavailable.
   * 3. Create a RUNNING discovery-only diagnostic or reuse the same-key diagnostic without resetting its state, then verify its source/session identity.
   * 4. Load the source chunks and return the graph, run ID, and discovery-only mode.
   *
   * Failure cases:
   * - Disallowed environment, missing graph, or key collision returns a typed failed diagnostic outcome without starting a customer Preparation.
   * - Persistence, graph export, and chunk-read errors propagate.
   *
   * Side effects:
   * - May create the isolated discovery-only run and reads the existing graph/chunks; it does not enqueue paid Preparation work.
   */
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
  /**
   * Business purpose: Manage deterministic legal-source review units and commit their source-grounded semantic claims into one Preparation inventory.
   *
   * Business rules:
   * - Every request is serialized against the run and current inventory revision; mutating completion must also match the pinned materialization, frontier revision, and active review operation.
   * - Only a running CLAIM_DISCOVERY frontier may be changed; a frozen or finished frontier requires explicit inventory reopening.
   * - Claims must have canonical identities and valid source anchors; unblocked completion additionally requires source-support validation, explicit disposition, and correctly accounted references and semantic relationships.
   * - Direct-draft completion must carry the loaded draft version and exact inventory revision; rejected packages do not partially write review decisions.
   * - Reference dependencies and invalidated endpoint bindings remain blocked or reopened until their source evidence is reconsidered.
   *
   * Execution flow:
   * 1. Normalize any supplied payload, lock the Preparation, and verify its current revision.
   * 2. On INIT, build the frontier from the pinned graph, assign references to review owners, and create pending units; PROGRESS reconciles wakeable blocked dependencies before returning bounded state, while LOAD only reads the selected payloads.
   * 3. For completion, validate operation/revision pins, draft revision, unit dispositions, claim identity/source support, reference accounting, and dependency endpoints before writing decisions.
   * 4. Update frontier counts/fingerprints, reopen dependents affected by changed endpoints, persist an accepted direct draft when included, and reconcile newly wakeable blockers.
   * 5. For explicit REOPEN, require a reason; for EXPAND, require a reason and existing outgoing references, then update and return the frontier.
   *
   * Failure cases:
   * - Missing/stale runs or pins, unavailable graphs, incomplete source accounting, invalid claims/dispositions, changed endpoint meanings, unsupported actions, and held leases return typed failed results.
   * - A malformed persisted payload, graph, or database operation propagates and rolls back the transaction.
   *
   * Side effects:
   * - Transactionally creates/updates frontier and review rows, counters, operation/lease state, expansion history, and an accepted direct draft; it never makes a model call or mutates legal source text.
   */
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
        /**
         * Business purpose: Return one source-review action failure with its required next operation.
         *
         * Business rules:
         * - The supplied gap code, reference, and detail remain explicit to the caller.
         * - The default next step is claim commitment unless a caller provides a more specific action.
         *
         * Execution flow:
         * 1. Accept the failure identity and optional next action/metadata.
         * 2. Construct a typed FAILED response without changing the frontier.
         *
         * Failure cases:
         * - None beyond the validation gap being represented in the result.
         *
         * Side effects:
         * - None; builds an in-memory action response.
         */
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
        /**
         * Business purpose: Address one review row within the current run and inventory revision.
         *
         * Business rules:
         * - The composite identity always includes the transaction's current run and revision.
         *
         * Execution flow:
         * 1. Add the requested source node ID to the current frontier key.
         *
         * Failure cases:
         * - None; missing rows are handled by the persistence operation using this key.
         *
         * Side effects:
         * - None; constructs an in-memory database key.
         */
        const itemKey = (sourceNodeId: string) => ({ ...key, sourceNodeId });
        /**
         * Business purpose: Project current frontier counters into the progress response and determine whether discovery can complete.
         *
         * Business rules:
         * - Completion eligibility requires at least one unit and no pending, in-review, or blocked units.
         * - Reviewed counts and persisted claim counts are reported without changing their source rows.
         *
         * Execution flow:
         * 1. Read the frontier's unit/state/claim counters.
         * 2. Compute the discovery-complete predicate from open and blocked counts.
         *
         * Failure cases:
         * - None; a missing frontier is prevented by the enclosing transaction flow.
         *
         * Side effects:
         * - None; returns a counter snapshot.
         */
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
        /**
         * Business purpose: Reconcile frontier counters and fingerprints after a review row changes.
         *
         * Business rules:
         * - State buckets and owned-claim counts reflect the row's persisted before/after values.
         * - The aggregate fingerprint removes the previous row hash and adds the current row hash.
         *
         * Execution flow:
         * 1. When a previous row is supplied, reload its updated value and compute the new state fingerprint.
         * 2. Adjust affected state and claim counters and update the row fingerprint.
         * 3. Persist the aggregate accumulator and frontier state fingerprint.
         *
         * Failure cases:
         * - A missing expected row or failed database write aborts the surrounding transaction.
         *
         * Side effects:
         * - Updates the review row fingerprint and its frontier counters/fingerprint inside the current transaction.
         */
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
        /**
         * Business purpose: Rebuild reference-dependency evidence from the frontier's exact pinned graph and review rows.
         *
         * Business rules:
         * - The exported materialization must equal the frontier's stored materialization before dependency claims can be trusted.
         * - Completion batch projections are used when validating an atomic batch; otherwise persisted rows are loaded.
         *
         * Execution flow:
         * 1. Export the pinned graph.
         * 2. Verify its materialization ID and select the applicable review rows.
         * 3. Build the canonical reference-dependency view for this run/revision.
         *
         * Failure cases:
         * - Missing or changed structural materialization throws, aborting the current action.
         *
         * Side effects:
         * - Reads the graph and review rows; returns an in-memory dependency snapshot.
         */
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
        /**
         * Business purpose: Reuse one dependency snapshot while the current action evaluates the same candidate review state.
         *
         * Business rules:
         * - The snapshot is shared only within this transaction/action and is invalidated after review rows change.
         *
         * Execution flow:
         * 1. Return the cached snapshot when available.
         * 2. Otherwise load and cache dependencies from the pinned graph and rows.
         *
         * Failure cases:
         * - Graph or row loading errors propagate from the loader.
         *
         * Side effects:
         * - Updates only the local dependency snapshot cache.
         */
        const dependencies = async () =>
          (dependencySnapshot ??= await loadDependencies());
        /**
         * Business purpose: Reopen blocked review units when a committed target or waited-for source unit now permits reconsideration.
         *
         * Business rules:
         * - Reconciliation runs only for an unfrozen frontier during running claim discovery.
         * - A blocker wakes only when the dependency rules detect a new usable endpoint or completed awaited owner.
         *
         * Execution flow:
         * 1. Skip when no blockers exist or the run/frontier is no longer mutable.
         * 2. Load the dependency view and test each blocked row's wake conditions.
         * 3. Move wakeable rows to REOPENED, clear their lease/operation, and refresh frontier counters and fingerprints.
         *
         * Failure cases:
         * - Graph, payload, and persistence failures propagate so reconciliation cannot silently lose a blocked dependency.
         *
         * Side effects:
         * - Updates blocked review rows and frontier state in the active transaction.
         */
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
        /**
         * Business purpose: Withdraw dependent review completion when a committed semantic claim endpoint changes.
         *
         * Business rules:
         * - Endpoint identity is compared by canonical claim ID and semantic fingerprint; only relations referencing changed or removed claims are invalidated.
         * - A dependent row remains available for repair, but must be reopened and reviewed before its old completion can authorize the graph.
         *
         * Execution flow:
         * 1. Compare previous and replacement endpoint fingerprints to identify changed claim IDs.
         * 2. Inspect other review payloads and mark affected relation IDs as invalidated.
         * 3. Reopen changed dependent rows, clear completion and lease ownership, and reconcile their frontier counters.
         *
         * Failure cases:
         * - Invalid persisted payloads or write failures abort the enclosing transaction.
         *
         * Side effects:
         * - Updates dependent review payloads, reasons, state, completion/lease fields, and frontier fingerprints.
         */
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
        /**
         * Business purpose: Return the current pinned frontier and progress after an accepted read or review action.
         *
         * Business rules:
         * - A reviewed-frontier fingerprint is exposed only when every review unit is complete and none remain blocked.
         * - Optional action data is added without replacing the authoritative frontier pins.
         *
         * Execution flow:
         * 1. Snapshot progress counters.
         * 2. When completion is eligible, fingerprint the persisted reviewed rows against the frontier definition.
         * 3. Return source/frontier revisions and fingerprints with progress and action metadata.
         *
         * Failure cases:
         * - Database read or fingerprint errors propagate; an incomplete frontier returns a null reviewed fingerprint.
         *
         * Side effects:
         * - Reads review rows only when a completion fingerprint is eligible; does not mutate the frontier.
         */
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

        /**
         * Business purpose: Decide whether one Agent-authored source-unit review can be committed as completed or explicitly blocked.
         *
         * Business rules:
         * - Completion needs a typed disposition, current source/frontier pins, existing unit, and valid operation ownership.
         * - Claims must use canonical identities, belong to their source unit, cite existing nodes in the exact graph, and have valid source support.
         * - Claim dispositions, reference accounting, semantic relation bindings, dependency fingerprints, and blocked-reference reasons must agree with the review contract.
         * - A changed target claim invalidates dependent bindings; only an explicit reference-resolution disposition may retain unchanged quarantined relations.
         *
         * Execution flow:
         * 1. Verify previously invalidated relations are retained only as unchanged blocked-repair evidence, and validate pinned structural reference bindings.
         * 2. Check completion identity, row state/lease ownership, source anchors, canonical claim ownership, claim disposition, and linked cross-review endpoints.
         * 3. Validate references and material/non-material accounting, then require source-support checks for nonblocked completions.
         * 4. Return the approved state and payload for the caller's transactional write.
         *
         * Failure cases:
         * - Returns typed failures for stale pins, invalid operation/lease, malformed claims, detached references, missing dependency evidence, or unsupported disposition.
         * - Source graph export and persisted payload/schema errors propagate rather than being converted into accepted evidence.
         *
         * Side effects:
         * - None; validates and returns a prospective completion without writing the review row.
         */
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
