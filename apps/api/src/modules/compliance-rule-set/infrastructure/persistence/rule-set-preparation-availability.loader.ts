import {
  AGENT_EXECUTION_STATES,
  ARTIFACT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import {
  RULE_SET_PREPARATION_MAX_ATTEMPTS,
  RULE_SET_PREPARATION_REFUSAL_REASONS,
  type RuleSetPreparationAvailability,
} from "@lcsp/contracts/compliance-rule-set";
import { LEGAL_SOURCE_LIFECYCLE_STATUSES } from "@lcsp/contracts/legal-source";
import { LegalRetrievalIndexStatus, type Prisma } from "@prisma/client";

import { toPrismaLegalSourceLifecycleStatus } from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { toRun } from "./compliance-rule-set.mappers.js";

const inProgress = new Set<string>([
  AGENT_EXECUTION_STATES.QUEUED,
  AGENT_EXECUTION_STATES.RUNNING,
  AGENT_EXECUTION_STATES.INTERRUPTED,
  AGENT_EXECUTION_STATES.PAUSED,
]);

/** Fail closed on ambiguous/unactivated sources; never fall back to a draft or test generation. */
export async function loadRuleSetPreparationAvailability(
  tx: Prisma.TransactionClient,
): Promise<RuleSetPreparationAvailability> {
  const active = toPrismaLegalSourceLifecycleStatus(
    LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
  );
  const sources = await tx.legalSourceVersion.findMany({
    where: { status: active },
    take: 2,
    select: {
      id: true,
      version: true,
      integrityManifestRef: true,
      documents: { select: { _count: { select: { chunks: true } } } },
      activations: {
        where: { status: active },
        orderBy: { activatedAt: "desc" },
        take: 1,
        select: { integrityManifestRef: true, retrievalValidationRef: true },
      },
      retrievalIndexes: {
        where: {
          status: LegalRetrievalIndexStatus.VALID,
          validatedAt: { not: null },
        },
        select: { validationManifestRef: true },
      },
    },
  });
  const unavailable: RuleSetPreparationAvailability = {
    legalSourceVersionId: null,
    legalSourceVersion: null,
    canStart: false,
    refusalReason:
      RULE_SET_PREPARATION_REFUSAL_REASONS.SOURCE_VERSION_NOT_ELIGIBLE,
    currentRun: null,
  };
  if (sources.length !== 1) return unavailable;
  const source = sources[0];
  const activation = source.activations[0];
  if (
    !source.integrityManifestRef ||
    activation?.integrityManifestRef !== source.integrityManifestRef ||
    !activation.retrievalValidationRef ||
    !source.retrievalIndexes.some(
      (index) =>
        index.validationManifestRef === activation.retrievalValidationRef,
    ) ||
    source.documents.length === 0 ||
    source.documents.some((document) => document._count.chunks === 0)
  )
    return unavailable;

  const [ruleSet, run, attemptCount] = await Promise.all([
    tx.complianceRuleSetVersion.findFirst({
      where: {
        legalSourceVersionId: source.id,
        lifecycleState: ARTIFACT_LIFECYCLE_STATES.ACTIVE,
      },
      select: { id: true },
    }),
    tx.ruleSetPreparationRun.findFirst({
      where: { legalSourceVersionId: source.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { ruleSet: { select: { id: true } } },
    }),
    tx.ruleSetPreparationRun.count({
      where: { legalSourceVersionId: source.id },
    }),
  ]);
  const refusalReason = ruleSet
    ? RULE_SET_PREPARATION_REFUSAL_REASONS.ACTIVE_RULE_SET_EXISTS
    : run
      ? inProgress.has(run.executionState)
        ? RULE_SET_PREPARATION_REFUSAL_REASONS.PREPARATION_IN_PROGRESS
        : run.executionState === AGENT_EXECUTION_STATES.CANCELLED
          ? attemptCount < RULE_SET_PREPARATION_MAX_ATTEMPTS
            ? null
            : RULE_SET_PREPARATION_REFUSAL_REASONS.ATTEMPTS_EXHAUSTED
          : RULE_SET_PREPARATION_REFUSAL_REASONS.PREPARATION_ALREADY_STARTED
      : attemptCount < RULE_SET_PREPARATION_MAX_ATTEMPTS
        ? null
        : RULE_SET_PREPARATION_REFUSAL_REASONS.ATTEMPTS_EXHAUSTED;
  return {
    legalSourceVersionId: source.id,
    legalSourceVersion: source.version,
    canStart: refusalReason === null,
    refusalReason,
    currentRun: run ? toRun(run, run.ruleSet?.id ?? null) : null,
  };
}
