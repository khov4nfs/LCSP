import { Command } from "@nestjs/cqrs";
import type {
  SupersedeModelTariffAssignmentInput,
  SupersedeModelTariffAssignmentResponse,
} from "@lcsp/contracts/billing";

export type SupersedeModelTariffAssignmentCommandInput =
  SupersedeModelTariffAssignmentInput & {
    assignmentId: string;
    actorId: string;
    correlationId: string;
  };

export class SupersedeModelTariffAssignmentCommand extends Command<SupersedeModelTariffAssignmentResponse> {
  constructor(
    public readonly input: SupersedeModelTariffAssignmentCommandInput,
  ) {
    super();
  }
}
