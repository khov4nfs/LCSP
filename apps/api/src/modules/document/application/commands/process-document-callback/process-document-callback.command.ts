/**
 * Carries a worker-produced document-generation callback and correlation context into the command pipeline.
 */
export class ProcessDocumentCallbackCommand {
  /**
   * Creates the document callback command.
   *
   * @param payload - Worker callback payload describing the document request result.
   * @param correlationId - Correlation identifier used when the callback does not resolve to a stored request context.
   */
  constructor(
    public readonly payload: unknown,
    public readonly correlationId: string,
  ) {}
}
