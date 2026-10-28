import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  COMPLIANCE_RULE_SET_FAILURE_CODES as F,
  COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES,
  type ComplianceRuleSetValidateResult,
} from "@lcsp/contracts/compliance-rule-set";
import { HttpStatus } from "@nestjs/common";
import { AgentExecutionState, ClaimPreparationPhase } from "@prisma/client";
import { validateFrozenInventory } from "../../../domain/claim-inventory.js";
import {
  frozenInventoryForRun,
  matchesPersistedDirectDraft,
} from "../../../infrastructure/persistence/preparation-inventory.persistence.js";
import { type ICommandHandler, CommandHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { LegalSourceSnapshotLoader } from "../../../infrastructure/persistence/legal-source-snapshot.service.js";
import {
  sourceClaimKey,
  validateComplianceRuleSetPacket,
} from "../../../domain/compliance-rule-set-integrity.validator.js";
import { ValidateComplianceRuleSetCommand } from "./validate-compliance-rule-set.command.js";

/** Validates a candidate and records protocol readiness without publishing authority. */
@CommandHandler(ValidateComplianceRuleSetCommand)
export class ValidateComplianceRuleSetHandler implements ICommandHandler<ValidateComplianceRuleSetCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly legalSource: LegalSourceSnapshotLoader,
  ) {}

  /**
   * Business purpose: Record whether the current authoring packet is ready for submission without granting Rule Set activation authority.
   *
   * Business rules:
   * - Discovery-only runs cannot enter Rule authoring or validation.
   * - The packet must match the current frozen inventory revision and accepted direct draft, and all source references use the run's pinned Legal Source.
   * - Only a running run in an authoring, validation, or submission-ready phase can record validation.
   *
   * Execution flow:
   * 1. Load the run's source pin and authoring state, rejecting missing or discovery-only runs.
   * 2. Load the pinned source and validate packet structure, citations, frozen inventory, and persisted draft equality.
   * 3. Compare-and-set the draft validation result and move valid packets to SUBMISSION_READY or invalid packets back to RULE_AUTHORING.
   * 4. Return the coverage and all accumulated validation failures.
   *
   * Failure cases:
   * - A missing run returns not found; a discovery-only run returns a submit-request conflict.
   * - A stale phase/revision causes a claim-phase failure in the returned result; source and persistence errors propagate.
   *
   * Side effects:
   * - Reads source, frozen inventory, and accepted draft, then records draft validation and claim phase when the guarded update succeeds; it does not activate a Rule Set.
   */
  async execute(
    input: ValidateComplianceRuleSetCommand,
  ): Promise<ComplianceRuleSetValidateResult> {
    const run = await this.prisma.ruleSetPreparationRun.findUnique({
      where: { id: input.request.preparationRunId },
      select: {
        legalSourceVersionId: true,
        claimDiscoveryOnly: true,
        claimInventoryRevision: true,
        claimPhase: true,
        executionState: true,
        executionContract: true,
      },
    });
    if (!run) {
      throw problemException(
        COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunNotFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    if (run.claimDiscoveryOnly)
      throw problemException(
        COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    const legalSource = await this.legalSource.load(
      { id: input.request.preparationRunId, ...run },
      input.request.packet,
    );
    const { failures, coverage } = validateComplianceRuleSetPacket(
      input.request.packet,
      legalSource.snapshot,
      (claim) =>
        legalSource.foreignHashes.has(
          `${sourceClaimKey(claim)}|${claim.contentSha256}`,
        ),
    );
    failures.push(
      ...validateFrozenInventory(
        input.request.packet,
        await frozenInventoryForRun(
          this.prisma,
          input.request.preparationRunId,
          run.claimInventoryRevision,
        ),
        run.claimInventoryRevision,
      ),
    );
    if (
      !(await matchesPersistedDirectDraft(
        this.prisma,
        { id: input.request.preparationRunId, ...run },
        input.request.packet,
      ))
    )
      failures.push({
        code: F.staleAuthoringDraft,
        ref: "draft",
        detail: "Reload the latest accepted draft before validation",
      });
    const recorded = await this.prisma.ruleSetPreparationRun.updateMany({
      where: {
        id: input.request.preparationRunId,
        executionState: AgentExecutionState.RUNNING,
        claimInventoryRevision: run.claimInventoryRevision,
        claimPhase: {
          in: [
            ClaimPreparationPhase.RULE_AUTHORING,
            ClaimPreparationPhase.RULE_VALIDATION,
            ClaimPreparationPhase.SUBMISSION_READY,
          ],
        },
      },
      data: {
        draftValidation: {
          outcome: failures.length
            ? COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES.FAILED
            : COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES.PASSED,
          failures,
        },
        claimPhase: failures.length
          ? ClaimPreparationPhase.RULE_AUTHORING
          : ClaimPreparationPhase.SUBMISSION_READY,
      },
    });
    if (!recorded.count)
      failures.push({
        code: F.claimPhaseInvalid,
        ref: "claimInventory",
        detail: "Start Rule authoring against the current frozen revision",
      });
    return {
      coverage,
      outcome:
        failures.length === 0
          ? COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES.PASSED
          : COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES.FAILED,
      failures,
    };
  }
}
