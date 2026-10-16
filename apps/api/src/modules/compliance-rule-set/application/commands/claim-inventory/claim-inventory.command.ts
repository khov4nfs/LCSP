import { Command } from "@nestjs/cqrs";
import type { ClaimInventoryOperation } from "@lcsp/contracts/compliance-rule-set";
export class ClaimInventoryCommand extends Command<Record<string, unknown>> {
  constructor(
    public readonly request: ClaimInventoryOperation,
    public readonly correlationId: string,
  ) {
    super();
  }
}
