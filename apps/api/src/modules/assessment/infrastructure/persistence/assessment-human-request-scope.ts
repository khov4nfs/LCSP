import { ASSESSMENT_DOMAIN_ERROR_CODES } from "@lcsp/contracts/assessment-domain";
import { HttpStatus } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { humanRequestDependenciesOf } from "./assessment-human-request-dependencies.js";

/**
 * Business purpose: Bind human-request work to the immutable rules of the current selected audit.
 * Business rules:
 * - A null audit request is the explicit legacy full-assessment path.
 * - Selected membership must belong to this assessment and contain at least one rule; historical coverage grants no authority.
 * Execution flow:
 * 1. Preserve the legacy scope when no audit request is active.
 * 2. Read exact request membership under the caller's transaction and reject missing or foreign membership.
 * Failure cases:
 * - Empty or cross-assessment membership rejects with REQUEST_INVALID before human-request side effects.
 * Side effects:
 * - Reads membership only; changes no requests, answers, coverage or audit state.
 */
export async function loadHumanRequestRuleScopeInTx(
  tx: Prisma.TransactionClient,
  input: {
    assessmentId: string;
    auditRequestId: string | null | undefined;
    correlationId: string;
  },
): Promise<readonly string[] | null> {
  if (!input.auditRequestId) return null;
  const members = await tx.assessmentRuleAuditItem.findMany({
    where: {
      requestId: input.auditRequestId,
      request: { assessmentId: input.assessmentId },
    },
    select: { assessmentRuleId: true },
  });
  if (members.length === 0)
    throw problemException(
      ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
      input.correlationId,
      { status: HttpStatus.FORBIDDEN },
    );
  return members.map((member) => member.assessmentRuleId);
}

/**
 * Business purpose: Restrict pending human blockers and checkpoint updates to the active audit's dependencies.
 * Business rules:
 * - A shared request participates when its primary rule or any normalized dependency belongs to the selected scope.
 * - Legacy full assessments retain their assessment-wide request set; an empty selected set matches no requests.
 * Execution flow:
 * 1. Bind every predicate to the assessment.
 * 2. Add primary/dependency membership predicates for selected audits.
 * Failure cases:
 * - Empty selected membership produces an empty match rather than widening to the full assessment.
 * Side effects:
 * - Pure query construction; the caller controls reads or updates under its existing transaction.
 */
export function humanRequestScopeWhere(
  assessmentId: string,
  ruleIds: readonly string[] | null,
): Prisma.AssessmentHumanRequestWhereInput {
  return {
    assessmentId,
    ...(ruleIds === null
      ? {}
      : {
          OR: [
            { assessmentRuleId: { in: [...ruleIds] } },
            {
              dependencies: {
                some: { assessmentRuleId: { in: [...ruleIds] } },
              },
            },
          ],
        }),
  };
}

/**
 * Business purpose: Project only human requests with a dependency in the current audit scope.
 * Business rules:
 * - Legacy full scope includes every assessment-owned request; selected scope includes only explicit matching dependencies.
 * Execution flow:
 * 1. Normalize the primary and shared dependencies.
 * 2. Test their rule identities against the immutable selected membership.
 * Failure cases:
 * - Empty membership or no matching dependency returns false without creating authority.
 * Side effects:
 * - Pure predicate; no request, fact or coverage state is changed.
 */
export function humanRequestHasRuleInScope(
  request: Parameters<typeof humanRequestDependenciesOf>[0],
  ruleIds: readonly string[] | null,
): boolean {
  return (
    ruleIds === null ||
    humanRequestDependenciesOf(request).some((dependency) =>
      ruleIds.includes(dependency.assessmentRuleId),
    )
  );
}
