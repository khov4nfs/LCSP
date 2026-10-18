import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  AgentExecutionState,
  ClaimPreparationPhase,
  Prisma,
} from "@prisma/client";
import {
  CLAIM_INVENTORY_ACTIONS as A,
  CLAIM_INVENTORY_GAPS as G,
  COMPLIANCE_RULE_SET_ERROR_CODES,
  CLAIM_PREPARATION_PHASES as P,
  COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES as O,
  COMPLIANCE_RULE_SET_FAILURE_CODES as F,
  semanticAuditReceiptSchema,
  legalSemanticGraphSchema,
  LEGAL_SEMANTIC_GRAPH_VERSION,
} from "@lcsp/contracts/compliance-rule-set";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { LegalSourceSnapshotLoader } from "../../../infrastructure/persistence/legal-source-snapshot.service.js";
import {
  inventoryFingerprint,
  inventoryHash,
  normalizeInventory,
  validateClaimInventory,
} from "../../../domain/claim-inventory.js";
import {
  reviewedFrontierFingerprint,
  completedReviewStates,
} from "../../../domain/source-review-frontier.js";
import { reviewPayload } from "../source-review/source-review.handler.js";
import {
  semanticAuditInput,
  semanticAuditReceiptFailures,
} from "../../../domain/semantic-audit.js";
import { ClaimInventoryCommand } from "./claim-inventory.command.js";
import { semanticAuditAttestationFailures } from "../../../domain/semantic-audit-attestation.js";

@CommandHandler(ClaimInventoryCommand)
export class ClaimInventoryHandler implements ICommandHandler<ClaimInventoryCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly source: LegalSourceSnapshotLoader,
  ) {}
  async execute({
    request: input,
    correlationId,
  }: ClaimInventoryCommand): Promise<Record<string, unknown>> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "RuleSetPreparationRun" WHERE id=${input.preparationRunId} FOR UPDATE`,
        );
        const run = await tx.ruleSetPreparationRun.findUnique({
          where: { id: input.preparationRunId },
        });
        if (!run)
          throw problemException(
            COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunNotFound,
            correlationId,
            { status: 404 },
          );
        const fail = (code: string, detail: string) => ({
          outcome: O.FAILED,
          phase: P[run.claimPhase],
          revision: run.claimInventoryRevision,
          failures: [{ code, ref: "claimInventory", detail }],
        });
        if (
          run.executionState !== AgentExecutionState.RUNNING &&
          !(
            run.claimDiscoveryOnly &&
            run.executionState === AgentExecutionState.SUCCEEDED &&
            input.action === A.FINALIZE
          )
        )
          return fail(G.PHASE, "Preparation is not running");
        if (
          input.action === A.REOPEN &&
          run.claimInventoryRevision === input.revision + 1 &&
          run.claimPhase === ClaimPreparationPhase.CLAIM_DISCOVERY &&
          input.reason === run.claimInventoryReopenReason
        )
          return {
            outcome: O.PASSED,
            phase: P.CLAIM_DISCOVERY,
            revision: run.claimInventoryRevision,
            alreadyReopened: true,
            downstreamInvalidated: true,
          };
        if (run.claimInventoryRevision !== input.revision)
          return fail(G.STALE, "Reload the current inventory revision");
        const frozen = await tx.ruleSetPreparationClaimInventory.findUnique({
          where: {
            preparationRunId_revision: {
              preparationRunId: run.id,
              revision: input.revision,
            },
          },
        });
        if (input.action === A.REOPEN) {
          if (!frozen || !input.reason)
            return fail(
              G.PHASE,
              "A frozen inventory and explicit reopening reason are required",
            );
          await tx.ruleSetPreparationRun.update({
            where: { id: run.id },
            data: {
              claimInventoryRevision: { increment: 1 },
              claimPhase: ClaimPreparationPhase.CLAIM_DISCOVERY,
              claimInventoryReopenReason: input.reason,
            },
          });
          return {
            outcome: O.PASSED,
            phase: P.CLAIM_DISCOVERY,
            revision: input.revision + 1,
            reason: input.reason,
            downstreamInvalidated: true,
          };
        }
        if (input.action === A.AUTHOR_RULES) {
          if (
            frozen &&
            legalSemanticGraphSchema.parse(frozen.graph).contractVersion !==
              LEGAL_SEMANTIC_GRAPH_VERSION
          )
            return fail(
              F.SEMANTIC_AUDIT_REQUIRED,
              "Historical inventories are read-only; explicitly reopen and obtain V3 source support/audits before new authoring",
            );
          if (run.claimDiscoveryOnly)
            return fail(
              G.PHASE,
              "A discovery-only diagnostic cannot author Rules",
            );
          if (
            frozen &&
            (
              [
                ClaimPreparationPhase.RULE_AUTHORING,
                ClaimPreparationPhase.RULE_VALIDATION,
                ClaimPreparationPhase.SUBMISSION_READY,
              ] as ClaimPreparationPhase[]
            ).includes(run.claimPhase)
          )
            return {
              outcome: O.PASSED,
              phase: P[run.claimPhase],
              revision: frozen.revision,
              fingerprint: frozen.fingerprint,
              alreadyStarted: true,
            };

          if (
            !frozen ||
            run.claimPhase !== ClaimPreparationPhase.CLAIM_INVENTORY_READY
          )
            return fail(
              G.PHASE,
              "Finalize inventory before starting Rule authoring",
            );
          await tx.ruleSetPreparationRun.update({
            where: { id: run.id },
            data: { claimPhase: ClaimPreparationPhase.RULE_AUTHORING },
          });
          return {
            outcome: O.PASSED,
            phase: P.RULE_AUTHORING,
            revision: frozen.revision,
            fingerprint: frozen.fingerprint,
          };
        }
        if (!input.graph || !input.identities)
          return fail(
            G.INVALID,
            "Graph and canonical identity keys are required",
          );
        const graph = normalizeInventory(input.graph);
        const fingerprint = inventoryFingerprint(input.revision, graph);
        if (frozen)
          return frozen.fingerprint === fingerprint
            ? {
                outcome: O.PASSED,
                phase: P[run.claimPhase],
                revision: frozen.revision,
                fingerprint,
                alreadyFinalized: true,
              }
            : fail(
                G.FROZEN,
                "Frozen claims cannot mutate; reopen inventory explicitly",
              );
        if (
          run.claimPhase !== ClaimPreparationPhase.CLAIM_DISCOVERY &&
          run.claimPhase !== ClaimPreparationPhase.CLAIM_INVENTORY_VALIDATION
        )
          return fail(
            G.PHASE,
            "Claim discovery must precede inventory validation",
          );
        const frontier = await tx.ruleSetPreparationReviewFrontier.findUnique({
          where: {
            preparationRunId_inventoryRevision: {
              preparationRunId: run.id,
              inventoryRevision: input.revision,
            },
          },
        });
        if (!frontier)
          return {
            ...fail(
              G.INVALID,
              "Initialize the deterministic review frontier first",
            ),
            requiredAction: "get_next_review_unit",
          };
        const items = await tx.ruleSetPreparationSourceReview.findMany({
          where: {
            preparationRunId: run.id,
            inventoryRevision: input.revision,
          },
          orderBy: { ordinal: "asc" },
        });
        const unfinished = items.filter(
          (item) => !completedReviewStates.includes(item.state as never),
        );
        if (!items.length || unfinished.length)
          return {
            ...fail(
              G.INVALID,
              "Complete every pending/in-review/blocked review unit before freezing",
            ),
            requiredAction: "get_next_review_unit",
            pendingCount: unfinished.length,
            nextReviewUnitIds: unfinished
              .slice(0, 3)
              .map((i) => i.sourceNodeId),
          };
        const reviewBinding = {
          revision: frontier.revision,
          fingerprint: frontier.fingerprint,
          reviewedFingerprint: reviewedFrontierFingerprint(
            frontier.fingerprint,
            items,
          ),
        };
        const payloads = items.map(reviewPayload);
        const audits = await tx.ruleSetPreparationSemanticAudit.findMany({
          where: {
            preparationRunId: run.id,
            inventoryRevision: input.revision,
          },
        });
        const persistentGraph = normalizeInventory({
          ...graph,
          semanticAudits: audits.map((row) =>
            semanticAuditReceiptSchema.parse(row.receipt),
          ),
          reviewFrontier: reviewBinding,
          claims: payloads.flatMap((p) => p.claims),
          relations: [
            ...new Map(
              payloads
                .flatMap((p) => p.relations)
                .map((r) => [r.relationId, r]),
            ).values(),
          ],
          sourceAccounting: items.map((item) => ({
            sourceNodeId: item.sourceNodeId,
            claimIds: item.claimIds,
            nonSemanticReason: item.claimIds.length ? null : item.reason,
          })),
          referenceAccounting: payloads.flatMap((p) => p.referenceAccounting),
        });
        const persistentIdentities = Object.fromEntries(
          payloads.flatMap((p) => Object.entries(p.identities)),
        );
        const { snapshot } = await this.source.load(run.legalSourceVersionId, {
          legalRequirements: [],
          assessmentRules: [],
          contextRelations: [],
        });
        if (input.action === A.RECORD_SEMANTIC_AUDITS) {
          if (!snapshot.documentGraph)
            return fail(
              F.SEMANTIC_AUDIT_REQUIRED,
              "Pinned source graph required",
            );
          const withoutAudits = (value: typeof graph) => ({
            ...value,
            semanticAudits: [],
          });
          if (
            inventoryHash(withoutAudits(persistentGraph)) !==
            inventoryHash(withoutAudits(graph))
          )
            return fail(
              G.INVALID,
              "Audit candidate differs from durable source reviews",
            );
          const receipts = new Map(
            (graph.semanticAudits ?? []).map((r) => [r.sourceNodeId, r]),
          );
          if (
            receipts.size !== items.length ||
            receipts.size !== (graph.semanticAudits ?? []).length
          )
            return fail(
              F.SEMANTIC_AUDIT_REQUIRED,
              "Exactly one independent receipt is required per completed unit",
            );
          for (const item of items) {
            const receipt = receipts.get(item.sourceNodeId);
            const gaps = semanticAuditReceiptFailures(
              semanticAuditInput(
                snapshot.documentGraph,
                persistentGraph,
                item.sourceNodeId,
                input.revision,
              ),
              receipt,
            );
            gaps.push(...semanticAuditAttestationFailures(receipt, run.id));
            if (gaps.length)
              return fail(
                F.SEMANTIC_AUDIT_REQUIRED,
                `${item.sourceNodeId}: ${gaps.join(", ")}`,
              );
          }
          for (const receipt of receipts.values())
            await tx.ruleSetPreparationSemanticAudit.upsert({
              where: {
                preparationRunId_inventoryRevision_sourceNodeId: {
                  preparationRunId: run.id,
                  inventoryRevision: input.revision,
                  sourceNodeId: receipt.sourceNodeId,
                },
              },
              create: {
                preparationRunId: run.id,
                inventoryRevision: input.revision,
                sourceNodeId: receipt.sourceNodeId,
                receipt,
              },
              update: { receipt },
            });
          return {
            outcome: O.PASSED,
            revision: input.revision,
            semanticAuditCount: receipts.size,
          };
        }
        // A producer-supplied or replayed receipt never authorizes freezing,
        // even when its source and semantic fingerprints are structurally valid.
        for (const receipt of persistentGraph.semanticAudits ?? []) {
          const originGaps = semanticAuditAttestationFailures(receipt, run.id);
          if (originGaps.length)
            return fail(F.SEMANTIC_AUDIT_REQUIRED, `${receipt.sourceNodeId}: ${originGaps.join(", ")}`);
        }
        // Validate durable evidence before comparing projections, so legacy defects remain repairable.
        const result = validateClaimInventory(
          run.id,
          input.revision,
          persistentGraph,
          persistentIdentities,
          snapshot,
          run.claimDiscoveryOnly
            ? new Set(items.map((item) => item.sourceNodeId))
            : undefined,
        );
        if (result.failures.length)
          return {
            ...result,
            outcome: O.FAILED,
            phase: P.CLAIM_INVENTORY_VALIDATION,
            revision: input.revision,
          };
        if (
          inventoryHash(persistentGraph) !== inventoryHash(graph) ||
          inventoryHash(persistentIdentities) !==
            inventoryHash(input.identities)
        )
          return {
            ...fail(
              G.INVALID,
              "Candidate differs from transactionally completed source reviews",
            ),
            requiredAction: "get_claim_inventory",
          };
        if (result.failures.length || input.action === A.VALIDATE)
          return {
            ...result,
            outcome: result.failures.length ? O.FAILED : O.PASSED,
            phase: P.CLAIM_INVENTORY_VALIDATION,
            revision: input.revision,
            fingerprint,
          };
        await tx.ruleSetPreparationClaimInventory.create({
          data: {
            preparationRunId: run.id,
            revision: input.revision,
            fingerprint,
            graphDigest: inventoryHash(graph),
            reviewedFrontierFingerprint: reviewBinding.reviewedFingerprint,
            graph,
            identities: input.identities,
            reopenReason: run.claimInventoryReopenReason,
          },
        });
        await tx.ruleSetPreparationReviewFrontier.update({
          where: {
            preparationRunId_inventoryRevision: {
              preparationRunId: run.id,
              inventoryRevision: input.revision,
            },
          },
          data: { frozenAt: new Date() },
        });
        await tx.ruleSetPreparationRun.update({
          where: { id: run.id },
          data: {
            claimPhase: ClaimPreparationPhase.CLAIM_INVENTORY_READY,
            ...(run.claimDiscoveryOnly
              ? {
                  executionState: AgentExecutionState.SUCCEEDED,
                  completedAt: new Date(),
                }
              : {}),
          },
        });
        return {
          outcome: O.PASSED,
          phase: P.CLAIM_INVENTORY_READY,
          revision: input.revision,
          fingerprint,
          graphDigest: inventoryHash(graph),
          coverage: result.coverage,
        };
      },
      { timeout: 30000 },
    );
  }
}
