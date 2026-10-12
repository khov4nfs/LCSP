import type { AuthUserRole } from "@lcsp/contracts/auth";
import type {
  AssessmentEventsPage,
  AssessmentEventsQuery,
} from "@lcsp/contracts/assessment-domain";
import { Query } from "@nestjs/cqrs";

/** One owner-scoped page of an assessment's canonical events, ascending by sequence. */
export class ListAssessmentEventsQuery extends Query<AssessmentEventsPage> {
  constructor(
    public readonly assessmentId: string,
    public readonly sessionUserId: string,
    public readonly subjectRole: AuthUserRole,
    public readonly page: AssessmentEventsQuery,
    public readonly correlationId: string,
  ) {
    super();
  }
}
