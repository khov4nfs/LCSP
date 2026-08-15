import type { ScanCallbackRequest } from "../../contracts/scan/scan-callback.contract.js";

/**
 * Carries a scanner-worker callback for one repository scan job into the command pipeline.
 */
export class ProcessScanCallbackCommand {
  /**
   * Creates the scan callback command.
   *
   * @param scanJobId - Repository scan job identifier from the callback route.
   * @param payload - Worker callback containing evidence, tool/config versions, privacy flags, and terminal status.
   * @param correlationId - Correlation identifier propagated to validation, audit, outbox, and response metadata.
   */
  constructor(
    public readonly scanJobId: string,
    public readonly payload: ScanCallbackRequest,
    public readonly correlationId: string,
  ) {}
}
