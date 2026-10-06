import { HttpStatus } from "@nestjs/common";
import {
  ASSESSMENT_CONTEXT_AUTHORITY_STATUSES,
  ASSESSMENT_INTERVIEW_INITIAL_PROBLEM_CODES,
  ASSESSMENT_INTERVIEW_READINESS_ERROR_CODES,
  CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES,
  type AssessmentInterviewRuntimeState,
} from "@lcsp/contracts/evidence";
import { asRecord } from "@lcsp/contracts/shared";

import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { missingInitialPlanningContextDimensions } from "./interview-minimum-planning-context.js";

/**
 * UC-M04-01 A1: zero new questions does not mean zero Customer authority.
 * Read only persisted context; a model's CONTEXT_READY proposal cannot mint facts,
 * respondent identities, confirmations or a synthetic Customer answer/revision.
 */
export function requireExistingInitialContext(
  assessmentId: string,
  state: AssessmentInterviewRuntimeState,
  expectedRevision: number,
  correlationId: string,
): Record<string, unknown> {
  const context = asRecord(state.confirmedContext);
  const statements = context?.statements;
  const nonEmpty = (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0;
  if (
    !context ||
    context.assessmentId !== assessmentId ||
    context.contextRevision !== expectedRevision ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision <= 0 ||
    context.authority !==
      CONFIRMED_STRUCTURED_BUSINESS_CONTEXT_AUTHORITIES.customerConfirmedConfirmedOnly ||
    state.contextAuthority ===
      ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.uncertain ||
    state.contextAuthority ===
      ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.conflicted ||
    state.contextAuthority ===
      ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.superseded ||
    !Array.isArray(statements) ||
    statements.length === 0 ||
    statements.some((value) => {
      const statement = asRecord(value);
      return (
        !statement ||
        statement.assessmentId !== assessmentId ||
        !nonEmpty(statement.statementId) ||
        !nonEmpty(statement.topic) ||
        !nonEmpty(statement.statement) ||
        !nonEmpty(statement.respondentRef) ||
        !nonEmpty(statement.createdAt) ||
        statement.source !==
          ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.customerConfirmed ||
        statement.resolutionState !==
          ASSESSMENT_CONTEXT_AUTHORITY_STATUSES.confirmed
      );
    })
  ) {
    throw problemException(
      ASSESSMENT_INTERVIEW_INITIAL_PROBLEM_CODES.authorityRequired,
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  }
  return context;
}

/** Same sufficiency policy as an answered Initial turn, not a minimum question count. */
export function assertExistingInitialContextSufficient(
  context: Record<string, unknown>,
  correlationId: string,
): void {
  const missing = missingInitialPlanningContextDimensions(context);
  if (missing.length > 0) {
    throw problemException(
      ASSESSMENT_INTERVIEW_READINESS_ERROR_CODES.minimumContextIncomplete,
      correlationId,
      {
        status: HttpStatus.CONFLICT,
        meta: {
          missingDimensionCount: missing.length,
          missingDimensions: missing.join(","),
        },
      },
    );
  }
}
