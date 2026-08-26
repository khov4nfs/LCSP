import type { EvaluateGapMatrixInput } from "@lcsp/contracts/evidence";

export class EvaluateGapMatrixQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly input: EvaluateGapMatrixInput,
    public readonly actorId: string,
    public readonly correlationId: string,
  ) {}
}
