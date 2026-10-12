import {
  COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES,
  type ComplianceRuleSetSubmitResult,
  type ComplianceRuleSetValidationFailure,
  type RuleSetPreparationRun,
} from "@lcsp/contracts/compliance-rule-set";
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
    legalSourceVersionId: string;
    executionState: PrismaAgentExecutionState;
  },
  ruleSetVersionId: string | null,
): RuleSetPreparationRun {
  return {
    preparationRunId: run.id,
    legalSourceVersionId: run.legalSourceVersionId,
    executionState: run.executionState,
    ruleSetVersionId,
  };
}

export function toSubmitResult(input: {
  runId: string;
  ruleSet: {
    id: string;
    version: string;
    lifecycleState: PrismaArtifactLifecycleState;
  };
  activationRecordId: string;
  failures: ComplianceRuleSetValidationFailure[];
  previousActiveRuleSetVersionId: string | null;
  replayed: boolean;
}): ComplianceRuleSetSubmitResult {
  return {
    preparationRunId: input.runId,
    ruleSetVersionId: input.ruleSet.id,
    version: input.ruleSet.version,
    lifecycleState: input.ruleSet.lifecycleState,
    validation: {
      outcome:
        input.failures.length === 0
          ? COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES.PASSED
          : COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES.FAILED,
      failures: input.failures,
    },
    activationRecordId: input.activationRecordId,
    previousActiveRuleSetVersionId: input.previousActiveRuleSetVersionId,
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
