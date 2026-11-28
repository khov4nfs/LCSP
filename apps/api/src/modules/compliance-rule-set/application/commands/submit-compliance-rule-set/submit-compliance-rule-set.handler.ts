import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  COMPLIANCE_RULE_SET_FAILURE_CODES,
  type ComplianceRuleSetSubmitResult,
} from "@lcsp/contracts/compliance-rule-set";
import { HttpStatus } from "@nestjs/common";
import { validateFrozenInventory } from "../../../domain/claim-inventory.js";
import {
  frozenInventoryForRun,
  matchesPersistedDirectDraft,
} from "../../../infrastructure/persistence/preparation-inventory.persistence.js";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { LegalSourceSnapshotLoader } from "../../../infrastructure/persistence/legal-source-snapshot.service.js";
import {
  ComplianceRuleSetActivation,
  type SubmitContext,
} from "../../../infrastructure/persistence/compliance-rule-set-activation.service.js";
import {
  canonicalJson,
  sha256Hex,
  sourceClaimKey,
  validateComplianceRuleSetPacket,
} from "../../../domain/compliance-rule-set-integrity.validator.js";
import { isRetryable } from "../../../infrastructure/persistence/compliance-rule-set.mappers.js";
import { SubmitComplianceRuleSetCommand } from "./submit-compliance-rule-set.command.js";

const MAX_TRANSACTION_ATTEMPTS = 4;

/** The one submit -> integrity validate -> atomic activate boundary. */
@CommandHandler(SubmitComplianceRuleSetCommand)
export class SubmitComplianceRuleSetHandler implements ICommandHandler<SubmitComplianceRuleSetCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly legalSource: LegalSourceSnapshotLoader,
    private readonly activation: ComplianceRuleSetActivation,
  ) {}

  /**
   * Business purpose: Validate and publish one Preparation's submitted Rule Set against its exact pinned Legal Source and frozen inventory.
   *
   * Business rules:
   * - Discovery-only runs cannot submit, and idempotency binds the request digest to the same Preparation.
   * - The packet must match frozen claim inventory and the accepted direct draft before successful activation.
   * - Integrity validation checks identity, source pins, evidence structure, and completeness; it does not author legal meaning.
   * - Publication, cancellation, and inventory reopening serialize on their shared run/activation locks.
   *
   * Execution flow:
   * 1. Load the Preparation and return a matching prior submission before source-validation work when possible.
   * 2. Load its pinned Legal Source snapshot and validate packet citations, semantic structure, inventory binding, and persisted draft equality.
   * 3. Build the commit context and transactionally persist either the activated Rule Set or the failed validation record through the activation service.
   * 4. Retry only recognized transient transaction conflicts up to the existing four-attempt policy, checking for a winning idempotent commit after each retryable failure.
   *
   * Failure cases:
   * - Missing or discovery-only runs return typed preparation errors; changed idempotency payloads, stale inventory/draft, or lifecycle conflicts are rejected.
   * - Non-retryable errors propagate immediately; retryable failures propagate after the existing attempt limit unless a matching commit is found.
   *
   * Side effects:
   * - Reads pinned source/inventory/draft state; the activation transaction writes lifecycle, Rule Set children, audit, and outbox records atomically.
   */
  async execute(
    input: SubmitComplianceRuleSetCommand,
  ): Promise<ComplianceRuleSetSubmitResult> {
    /** The one submit -> integrity validate -> atomic activate boundary. */
    const request = input.request;
    const requestDigest = sha256Hex(canonicalJson(request.packet));

    const run = await this.prisma.ruleSetPreparationRun.findUnique({
      where: { id: request.preparationRunId },
      include: { legalSourceVersion: { select: { id: true, version: true } } },
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

    // Cheap replay before any validation work; re-checked inside the lock.
    const replay = await this.activation.findReplay(
      this.prisma,
      request.idempotencyKey,
      run.id,
      requestDigest,
      input.correlationId,
    );
    if (replay) return replay;

    const legalSource = await this.legalSource.load(run, request.packet);
    const validation = validateComplianceRuleSetPacket(
      request.packet,
      legalSource.snapshot,
      (claim) =>
        legalSource.foreignHashes.has(
          `${sourceClaimKey(claim)}|${claim.contentSha256}`,
        ),
    );
    validation.failures.push(
      ...validateFrozenInventory(
        request.packet,
        await frozenInventoryForRun(
          this.prisma,
          run.id,
          run.claimInventoryRevision,
        ),
        run.claimInventoryRevision,
      ),
    );
    if (!(await matchesPersistedDirectDraft(this.prisma, run, request.packet)))
      validation.failures.push({
        code: COMPLIANCE_RULE_SET_FAILURE_CODES.staleAuthoringDraft,
        ref: "draft",
        detail: "The submitted candidates differ from the accepted draft",
      });

    const context: SubmitContext = {
      runId: run.id,
      idempotencyKey: request.idempotencyKey,
      requestDigest,
      ruleSetDigest: requestDigest,
      packet: request.packet,
      failures: validation.failures,
      resolved: validation.resolved,
      legalSource: run.legalSourceVersion,
      correlationId: input.correlationId,
    };

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          (tx) => this.activation.commit(tx, context, input.actorId),
          // The run row and activation advisory locks serialize cancellation/publication and the
          // ACTIVE pointer; READ COMMITTED lets a waiter observe the winning idempotent commit.
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );
      } catch (error) {
        if (!isRetryable(error) || attempt >= MAX_TRANSACTION_ATTEMPTS)
          throw error;
        const replay = await this.activation.findReplay(
          this.prisma,
          request.idempotencyKey,
          run.id,
          requestDigest,
          input.correlationId,
        );
        if (replay) return replay;
      }
    }
  }
}
