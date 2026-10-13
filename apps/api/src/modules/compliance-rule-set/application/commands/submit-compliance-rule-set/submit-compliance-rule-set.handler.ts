import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  type ComplianceRuleSetSubmitResult,
} from "@lcsp/contracts/compliance-rule-set";
import { HttpStatus } from "@nestjs/common";
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

    // Cheap replay before any validation work; re-checked inside the lock.
    const replay = await this.activation.findReplay(
      this.prisma,
      request.idempotencyKey,
      run.id,
      requestDigest,
      input.correlationId,
    );
    if (replay) return replay;

    const legalSource = await this.legalSource.load(
      run.legalSourceVersion.id,
      request.packet,
    );
    const validation = validateComplianceRuleSetPacket(
      request.packet,
      legalSource.snapshot,
      (claim) =>
        legalSource.foreignHashes.has(
          `${sourceClaimKey(claim)}|${claim.contentSha256}`,
        ),
    );

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
