import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { AssessmentRuntimeControlService } from "../../../../../platform/runtime-events/assessment-runtime-control.service.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AssessmentHumanRequestSupport } from "../../../infrastructure/persistence/assessment-human-request-support.service.js";
import { GetRuntimeControlQuery } from "./get-runtime-control.query.js";
@QueryHandler(GetRuntimeControlQuery)
export class GetRuntimeControlHandler implements IQueryHandler<GetRuntimeControlQuery> {
  constructor(
    private readonly controls: AssessmentRuntimeControlService,
    private readonly prisma: PrismaService,
    private readonly owner: AssessmentHumanRequestSupport,
  ) {}
  async execute(query: GetRuntimeControlQuery) {
    await this.prisma.$transaction((tx) => this.owner.requireOwner(tx, query));
    return this.controls.current(query.assessmentId);
  }
}
