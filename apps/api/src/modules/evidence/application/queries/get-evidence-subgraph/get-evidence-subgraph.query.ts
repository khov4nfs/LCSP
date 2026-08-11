import type { EvidenceSubgraphDirection } from "../../contracts/evidence/evidence-subgraph.contract.js";

export class GetEvidenceSubgraphQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly evidenceReportId: string,
    public readonly seedNodeId: string,
    public readonly direction: EvidenceSubgraphDirection,
    public readonly maxDepth: number,
    public readonly maxNodes: number,
    public readonly maxEdges: number,
    public readonly correlationId: string,
  ) {}
}
