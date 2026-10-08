import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { AssessmentDetailLoader } from "../../../infrastructure/persistence/assessment-detail.loader.js";
import { GetAssessmentQuery } from "./get-assessment.query.js";

@QueryHandler(GetAssessmentQuery)
export class GetAssessmentHandler implements IQueryHandler<GetAssessmentQuery> {
  constructor(private readonly loader: AssessmentDetailLoader) {}

  execute(query: GetAssessmentQuery) {
    return this.loader.load(query);
  }
}
