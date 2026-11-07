import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import {
  assessmentEventsPageSchema,
  AUTHORED_LOCALIZATION_ENTITIES,
} from "@lcsp/contracts/assessment-domain";
import { AuthoredLocalizationService } from "../../../../../platform/localization/authored-localization.service.js";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import {
  CANONICAL_EVENT_SELECT,
  toAssessmentEvent,
} from "../../../../../platform/runtime-events/canonical-assessment-event.mapper.js";
import { ListAssessmentEventsQuery } from "./list-assessment-events.query.js";

@QueryHandler(ListAssessmentEventsQuery)
export class ListAssessmentEventsHandler implements IQueryHandler<ListAssessmentEventsQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localization: AuthoredLocalizationService,
  ) {}

  /**
   * Business purpose: Return the owner's ordered event history in the trusted request locale.
   * Business rules:
   * - Authorization precedes localization; event identity, sequence, technical payload and source evidence remain canonical.
   * Execution flow:
   * 1. Authorize the owner, read one canonical page and project each payload at its exact event/sequence binding.
   * Failure cases:
   * - Foreign assessments return not-found; missing, failed or corrupt translations reject the page explicitly.
   * Side effects:
   * - Read persisted events and translations only; no canonical mutations or provider calls.
   */
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
    const events = await Promise.all(
      rows.slice(0, limit).map(async (row) => {
        const event = toAssessmentEvent(row);
        if (!input.locale) return event;
        const payload = await this.localization.projectDocument(
          event.payload,
          input.locale,
          input.assessmentId,
          {
            entityType: AUTHORED_LOCALIZATION_ENTITIES.EVENT,
            entityId: event.eventId,
            canonicalRevision: String(event.sequence),
          },
        );
        return { ...event, payload };
      }),
    );
    return assessmentEventsPageSchema.parse({
      assessmentId: input.assessmentId,
      events,
      hasMore: rows.length > limit,
      nextAfterSequence: events.at(-1)?.sequence ?? null,
    });
  }
}
