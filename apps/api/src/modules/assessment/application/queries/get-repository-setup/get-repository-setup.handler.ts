import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { AssessmentRepositorySetupLoader } from "../../../infrastructure/persistence/assessment-repository-setup.loader.js";
import { GetRepositorySetupQuery } from "./get-repository-setup.query.js";

@QueryHandler(GetRepositorySetupQuery)
export class GetRepositorySetupHandler implements IQueryHandler<GetRepositorySetupQuery> {
  constructor(private readonly loader: AssessmentRepositorySetupLoader) {}
  execute(query: GetRepositorySetupQuery) {
    return this.loader.load(query);
  }
}
