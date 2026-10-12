import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { AssessmentRuntimeControlService } from "../../../../../platform/runtime-events/assessment-runtime-control.service.js";
import { ControlAssessmentRuntimeCommand } from "./control-assessment-runtime.command.js";
@CommandHandler(ControlAssessmentRuntimeCommand)
export class ControlAssessmentRuntimeHandler implements ICommandHandler<ControlAssessmentRuntimeCommand> {
  constructor(private readonly controls: AssessmentRuntimeControlService) {}
  execute(command: ControlAssessmentRuntimeCommand) {
    return this.controls.request(command);
  }
}
