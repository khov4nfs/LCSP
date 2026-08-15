import { Query } from "@nestjs/cqrs";
import type { SubjectRole } from "@lcsp/contracts/pbac";

import type { ScanJobStatusDto } from "../../contracts/scan/scan-job-status.contract.js";

/**
 * Requests one scan-job status view under the caller's tenant, role, and assessment scope.
 */
export class GetScanJobQuery extends Query<ScanJobStatusDto> {
  /**
   * Creates the scan-job lookup query.
   *
   * @param assessmentId - Assessment that must own the scan job.
   * @param scanJobId - Repository scan job identifier to retrieve.
   * @param organizationId - Organization boundary for the lookup.
   * @param subjectRole - PBAC subject role used for developer-scope filtering.
   * @param scope - PBAC resource scope for non-manager callers.
   * @param correlationId - Correlation identifier propagated to lookup errors and response metadata.
   */
  constructor(
    public readonly assessmentId: string,
    public readonly scanJobId: string,
    public readonly organizationId: string,
    public readonly subjectRole: SubjectRole,
    public readonly scope: string | null,
    public readonly correlationId: string,
  ) {
    super();
  }
}
