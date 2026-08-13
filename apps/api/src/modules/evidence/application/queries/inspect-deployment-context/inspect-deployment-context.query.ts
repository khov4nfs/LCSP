import type {
  DeploymentEnvironment,
  DeploymentManifestKind,
} from "../../contracts/evidence/deployment-context.contract.js";
export class InspectDeploymentContextQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly evidenceReportId: string,
    public readonly manifestKinds: DeploymentManifestKind[],
    public readonly environments: DeploymentEnvironment[],
    public readonly maxResults: number,
    public readonly correlationId: string,
    public readonly pathPrefixes: string[] = [],
    public readonly cursor: string | null = null,
  ) {}
}
