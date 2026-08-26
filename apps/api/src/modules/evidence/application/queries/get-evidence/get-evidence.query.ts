import { Query } from "@nestjs/cqrs";
import type { AuthUserRole } from "@lcsp/contracts/auth";

import type { EvidenceDetailDto } from "../../contracts/evidence/evidence-detail.contract.js";

export class GetEvidenceQuery extends Query<EvidenceDetailDto> {
  constructor(
    public readonly assessmentId: string,
    public readonly actorRole: AuthUserRole,
    public readonly correlationId: string,
  ) {
    super();
  }
}
