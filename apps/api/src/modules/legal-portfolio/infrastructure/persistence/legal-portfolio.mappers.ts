import {
  LEGAL_PORTFOLIO_VALIDATION_OUTCOMES,
  type LegalPortfolioSubmitResult,
  type LegalPortfolioValidationFailure,
  type LegalPreparationRun,
} from "@lcsp/contracts/legal-portfolio";
import {
  Prisma,
  type AgentExecutionState as PrismaAgentExecutionState,
  ArtifactLifecycleState as PrismaArtifactLifecycleState,
} from "@prisma/client";

const SERIALIZATION_FAILURE_CODES = new Set(["P2034", "40001"]);

export function contractChunkIds(contract: Prisma.JsonValue): string[] {
  const ids = (contract as { sourceChunkIds?: unknown } | null)?.sourceChunkIds;
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === "string")
    : [];
}

export function toRun(
  run: {
    id: string;
    legalCorpusVersionId: string;
    executionState: PrismaAgentExecutionState;
  },
  portfolioVersionId: string | null,
): LegalPreparationRun {
  return {
    preparationRunId: run.id,
    legalCorpusVersionId: run.legalCorpusVersionId,
    executionState: run.executionState,
    portfolioVersionId,
  };
}

export function toSubmitResult(input: {
  runId: string;
  portfolio: {
    id: string;
    version: string;
    lifecycleState: PrismaArtifactLifecycleState;
  };
  activationRecordId: string;
  failures: LegalPortfolioValidationFailure[];
  previousActivePortfolioVersionId: string | null;
  replayed: boolean;
}): LegalPortfolioSubmitResult {
  return {
    preparationRunId: input.runId,
    portfolioVersionId: input.portfolio.id,
    version: input.portfolio.version,
    lifecycleState: input.portfolio.lifecycleState,
    validation: {
      outcome:
        input.failures.length === 0
          ? LEGAL_PORTFOLIO_VALIDATION_OUTCOMES.PASSED
          : LEGAL_PORTFOLIO_VALIDATION_OUTCOMES.FAILED,
      failures: input.failures,
    },
    activationRecordId: input.activationRecordId,
    previousActivePortfolioVersionId: input.previousActivePortfolioVersionId,
    replayed: input.replayed,
  };
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export function isRetryable(error: unknown): boolean {
  const code = error as { code?: string; meta?: { code?: string } } | null;
  return (
    SERIALIZATION_FAILURE_CODES.has(code?.code ?? "") ||
    SERIALIZATION_FAILURE_CODES.has(code?.meta?.code ?? "")
  );
}
