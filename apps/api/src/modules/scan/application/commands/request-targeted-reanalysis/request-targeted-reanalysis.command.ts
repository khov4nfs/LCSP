import type { PbacRequestContext } from "../../../../../platform/pbac/interfaces/pbac-request.interface.js";
import type { RequestTargetedReanalysisInput } from "../../contracts/scan/targeted-reanalysis.contract.js";

export class RequestTargetedReanalysisCommand {
  constructor(
    public readonly input: RequestTargetedReanalysisInput,
    public readonly pbacContext: PbacRequestContext,
    public readonly correlationId: string,
  ) {}
}
