import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import type { OpenAssessmentHumanRequestResult } from "@lcsp/contracts/assessment-domain";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { AssessmentCaseSupport } from "../../../infrastructure/persistence/assessment-case-support.service.js";
import { AssessmentEventAppender } from "../../services/assessment-event-appender.service.js";
import { AssessmentLifecycleCoordinator } from "../../services/assessment-lifecycle-coordinator.service.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { OpenHumanRequestCommand } from "./open-human-request.command.js";
import { OpenHumanRequestsBatchCommand } from "./open-human-requests-batch.command.js";
import { OpenHumanRequestsBatchHandler } from "./open-human-requests-batch.handler.js";

@CommandHandler(OpenHumanRequestCommand)
export class OpenHumanRequestHandler implements ICommandHandler<OpenHumanRequestCommand> {
  private readonly batchHandler: OpenHumanRequestsBatchHandler;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: AssessmentRuntimeAuthority,
    private readonly support: AssessmentCaseSupport,
    private readonly events: AssessmentEventAppender,
    private readonly audit: AuditWriterService,
    private readonly coordinator: AssessmentLifecycleCoordinator,
  ) {
    // Explanatory comment:
    // Delegate single human requests to OpenHumanRequestsBatchHandler wrapped in a 1-item batch.
    // This eliminates ~450 lines of duplicate code while preserving constructor DI and contract compatibility.
    this.batchHandler = new OpenHumanRequestsBatchHandler(
      prisma,
      authority,
      support,
      events,
      audit,
      coordinator,
    );
  }

  /**
   * Business purpose: Ask one factual question once for the rules authorized by the active Root audit.
   *
   * Business rules:
   * - Delegates single request to the canonical batch handler wrapped in a single-item batch.
   * - Preserves all transactional, idempotency, and audit guarantees of OpenHumanRequestsBatchHandler.
   *
   * Execution flow:
   * 1. Wrap single OpenAssessmentHumanRequest into an OpenHumanRequestsBatchCommand.
   * 2. Execute via OpenHumanRequestsBatchHandler.
   * 3. Return the first OpenAssessmentHumanRequestResult.
   *
   * Failure cases:
   * - Propagates all validation and transactional errors from batch execution.
   *
   * Side effects:
   * - Same side effects as OpenHumanRequestsBatchHandler: writes human request, fact need, audit, and lifecycle events.
   */
  async execute(
    input: OpenHumanRequestCommand,
  ): Promise<OpenAssessmentHumanRequestResult> {
    const batchResult = await this.batchHandler.execute(
      new OpenHumanRequestsBatchCommand(
        input.assessmentId,
        input.leaseToken,
        { requests: [input.request] },
        input.correlationId,
      ),
    );
    const result = batchResult.requests[0];
    if (!result) {
      throw new Error(
        "Batch handler returned empty results for single human request",
      );
    }
    return result;
  }
}
