import type {
  AssessmentRepositoryConnection,
  StartRepositoryAnalysisInput,
  StartRepositoryAnalysisResult,
} from "../../../lib/api/repository-analysis-client.ts";

type RepositoryReadinessAnalysisInput = {
  connection: AssessmentRepositoryConnection | null;
  repositoryUrl?: string;
};

type RepositoryReadinessAnalysisOperations = {
  connect: (repositoryUrl: string) => Promise<AssessmentRepositoryConnection>;
  analyze: (
    input: StartRepositoryAnalysisInput,
  ) => Promise<StartRepositoryAnalysisResult>;
  onConnected?: (connection: AssessmentRepositoryConnection) => void;
};

export async function runRepositoryReadinessAnalysis(
  input: RepositoryReadinessAnalysisInput,
  operations: RepositoryReadinessAnalysisOperations,
): Promise<StartRepositoryAnalysisResult> {
  const connection =
    input.connection ??
    (await operations.connect(requiredRepositoryUrl(input.repositoryUrl)));

  if (!input.connection) {
    operations.onConnected?.(connection);
  }

  return operations.analyze({
    connectionId: connection.connectionId,
    branch: connection.defaultBranch,
  });
}

function requiredRepositoryUrl(repositoryUrl: string | undefined): string {
  if (!repositoryUrl) {
    throw new Error("repository-url-required");
  }
  return repositoryUrl;
}
