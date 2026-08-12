import type { ReconcileVerifiedProfileInput } from "@lcsp/contracts/evidence";

export class ReconcileProfileToVerifiedProfileCommand {
  constructor(
    readonly input: ReconcileVerifiedProfileInput,
    readonly organizationId: string,
    readonly correlationId: string,
  ) {}
}
