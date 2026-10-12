import { RepositoryConnection } from "../../../domain/entities/repository-connection.entity.js";

export const REPOSITORY_CONNECTION_REPOSITORY = Symbol(
  "REPOSITORY_CONNECTION_REPOSITORY",
);

export interface RepositoryConnectionRepository {
  findById(id: string): Promise<RepositoryConnection | null>;
  linkToAssessment(id: string, assessmentId: string): Promise<boolean>;
}
