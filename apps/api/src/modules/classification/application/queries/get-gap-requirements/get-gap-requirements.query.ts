import type { AuthUserRole } from "@lcsp/contracts/auth";
import type { GetGapRequirementsInput } from "@lcsp/contracts/evidence";

export class GetGapRequirementsQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly input: GetGapRequirementsInput,
    public readonly actorId: string,
    public readonly actorRole: AuthUserRole,
    public readonly correlationId: string,
  ) {}
}
