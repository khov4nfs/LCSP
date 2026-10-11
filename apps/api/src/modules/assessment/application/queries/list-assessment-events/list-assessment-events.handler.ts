import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { assessmentEventsPageSchema } from "@lcsp/contracts/assessment-domain";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import {
  CANONICAL_EVENT_SELECT,
  toAssessmentEvent,
} from "../../../../../platform/runtime-events/canonical-assessment-event.mapper.js";
import { ListAssessmentEventsQuery } from "./list-assessment-events.query.js";

@QueryHandler(ListAssessmentEventsQuery)
export class ListAssessmentEventsHandler implements IQueryHandler<ListAssessmentEventsQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(input: ListAssessmentEventsQuery) {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: input.assessmentId },
      select: { ownerId: true },
    });
    // The same answer for "missing" and "someone else's": no assessment is probeable by id.
    if (
      !assessment ||
      input.subjectRole !== AUTH_USER_ROLES.customer ||
      assessment.ownerId !== input.sessionUserId
    ) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    const { afterSequence, limit } = input.page;
    const rows = await this.prisma.assessmentEvent.findMany({
      where: {
        assessmentId: input.assessmentId,
        sequence: { gt: afterSequence },
      },
      orderBy: { sequence: "asc" },
      take: limit + 1,
      select: CANONICAL_EVENT_SELECT,
    });
    const events = rows.slice(0, limit).map(toAssessmentEvent);
    return assessmentEventsPageSchema.parse({
      assessmentId: input.assessmentId,
      events,
      hasMore: rows.length > limit,
      nextAfterSequence: events.at(-1)?.sequence ?? null,
    });
  }
}
