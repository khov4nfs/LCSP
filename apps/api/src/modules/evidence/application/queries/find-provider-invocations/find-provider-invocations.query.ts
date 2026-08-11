import type { ProviderInvocationProvider } from "../../contracts/evidence/provider-invocation.contract.js";

export class FindProviderInvocationsQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly evidenceReportId: string,
    public readonly maxResults: number,
    public readonly correlationId: string,
    public readonly provider:
      ProviderInvocationProvider | undefined = undefined,
    public readonly pathPrefixes: string[] = [],
  ) {}
}
