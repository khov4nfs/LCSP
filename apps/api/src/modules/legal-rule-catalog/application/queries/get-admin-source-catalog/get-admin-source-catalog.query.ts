import type { GetAdminSourceCatalogInput } from "@lcsp/contracts/evidence";

export class GetAdminSourceCatalogQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly input: GetAdminSourceCatalogInput,
    public readonly actorId: string,
    public readonly correlationId: string,
  ) {}
}
