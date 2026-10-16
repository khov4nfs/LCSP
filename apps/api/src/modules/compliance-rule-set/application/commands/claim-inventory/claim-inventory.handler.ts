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
import { ClaimInventoryCommand } from "./claim-inventory.command.js";

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
        if (run.executionState !== AgentExecutionState.RUNNING)
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
        const { snapshot } = await this.source.load(run.legalSourceVersionId, {
          legalRequirements: [],
          assessmentRules: [],
          contextRelations: [],
        });
        const result = validateClaimInventory(
          run.id,
          input.revision,
          graph,
          input.identities,
          snapshot,
        );
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
            graph,
            identities: input.identities,
            reopenReason: run.claimInventoryReopenReason,
          },
        });
        await tx.ruleSetPreparationRun.update({
          where: { id: run.id },
          data: { claimPhase: ClaimPreparationPhase.CLAIM_INVENTORY_READY },
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
