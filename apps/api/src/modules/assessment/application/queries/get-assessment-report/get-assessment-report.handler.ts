import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { AssessmentReportLoader } from "../../../infrastructure/persistence/assessment-report.loader.js";
import { GetAssessmentReportQuery } from "./get-assessment-report.query.js";

@QueryHandler(GetAssessmentReportQuery)
export class GetAssessmentReportHandler implements IQueryHandler<GetAssessmentReportQuery> {
  constructor(private readonly loader: AssessmentReportLoader) {}
  execute(query: GetAssessmentReportQuery) {
    return this.loader.load(query);
  }
}
