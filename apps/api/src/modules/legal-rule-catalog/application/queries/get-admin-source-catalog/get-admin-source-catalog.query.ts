import type { GetAdminSourceCatalogInput } from "@lcsp/contracts/evidence";

export class GetAdminSourceCatalogQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly input: GetAdminSourceCatalogInput,
    public readonly actorId: string,
    public readonly policyId: string | null,
    public readonly policyVersion: string | null,
    public readonly correlationId: string,
  ) {}
}
