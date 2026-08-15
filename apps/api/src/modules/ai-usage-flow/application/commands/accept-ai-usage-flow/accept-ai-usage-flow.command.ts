import type { AIUsageFlowCallbackRequest } from "../../contracts/ai-usage-flow/ai-usage-flow-callback.contract.js";

/**
 * Carries a worker-produced AI usage-flow callback and its correlation context into the CQRS command pipeline.
 */
export class AcceptAIUsageFlowCommand {
  /**
   * Creates the callback acceptance command.
   *
   * @param payload - Sanitized AI usage-flow callback payload submitted by the worker.
   * @param correlationId - Correlation identifier propagated through persistence, outbox, audit, and error responses.
   */
  constructor(
    readonly payload: AIUsageFlowCallbackRequest,
    readonly correlationId: string,
  ) {}
}
