import type { AssessmentRepositoryProvider } from "@lcsp/contracts/assessment";

export type RepositoryHistory = {
  provider: string;
  repositoryFullName: string;
  commitSha: string;
};

export type GitProviderValue = AssessmentRepositoryProvider;
