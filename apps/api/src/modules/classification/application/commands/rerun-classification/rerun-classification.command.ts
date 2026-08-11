import type { PbacRequestContext } from "../../../../../platform/pbac/interfaces/pbac-request.interface.js";

export class RerunClassificationCommand {
  constructor(
    public readonly assessmentId: string,
    public readonly pbacContext: PbacRequestContext,
    public readonly correlationId: string,
    public readonly reason?: string,
  ) {}
}
