import { Command } from "@nestjs/cqrs";
import type { ManagerOnlyAuthorizationContext } from "../save-wizard-draft/save-wizard-draft.command.js";
import type { ReadinessExportResponse } from "../../contracts/wizard/readiness-export.contract.js";

export class GenerateReadinessExportCommand extends Command<ReadinessExportResponse> {
  constructor(
    public readonly assessmentId: string,
    public readonly ownerId: string,
    public readonly correlationId: string,
    public readonly authorization: ManagerOnlyAuthorizationContext,
  ) {
    super();
  }
}
