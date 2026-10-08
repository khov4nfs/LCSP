import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { assessmentListQuerySchema } from "@lcsp/contracts/assessment-domain";
import { AssessmentDetailLoader } from "../../../infrastructure/persistence/assessment-detail.loader.js";
import { ListAssessmentsQuery } from "./list-assessments.query.js";

@QueryHandler(ListAssessmentsQuery)
export class ListAssessmentsHandler implements IQueryHandler<ListAssessmentsQuery> {
  constructor(private readonly loader: AssessmentDetailLoader) {}
  execute(query: ListAssessmentsQuery) {
    const filters = assessmentListQuerySchema.parse({
      page: query.page,
      page_size: query.pageSize,
      lifecycleState: query.status,
    });
    return this.loader.list({
      ...query,
      page: filters.page,
      pageSize: filters.page_size,
      lifecycleState: filters.lifecycleState,
    });
  }
}
