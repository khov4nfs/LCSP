import {
  AGENTIC_TOOL_NAMES,
  EVIDENCE_ERROR_CODES,
  type ResolveClassificationReviewInput,
  type SubmitClassificationReviewInput,
} from "@lcsp/contracts/evidence";
import { PBAC_ACTIONS, type PbacAction } from "@lcsp/contracts/pbac";
import { HttpStatus } from "@nestjs/common";

import { problemException } from "../../../../platform/problems/problem-factory.js";
import { ResolveClassificationReviewCommand } from "../../../classification/application/commands/resolve-classification-review/resolve-classification-review.command.js";
import { SubmitClassificationReviewCommand } from "../../../classification/application/commands/submit-classification-review/submit-classification-review.command.js";
import { ReconcileProfileToVerifiedProfileCommand } from "../../../reconciliation/application/commands/reconcile-profile-to-verified-profile/reconcile-profile-to-verified-profile.command.js";

export type AgenticToolCommandDispatchArgs = {
  toolName: string;
  assessmentId: string;
  organizationId: string;
  userId: string;
  policyId?: string | null;
  policyVersion?: string | null;
  correlationId: string;
  input: Record<string, unknown>;
};

const PROTECTED_COMMAND_ACTIONS: Readonly<Record<string, PbacAction>> = {
  [AGENTIC_TOOL_NAMES.reconcileProfileToVerifiedProfile]:
    PBAC_ACTIONS.verifiedProfilePersist,
  [AGENTIC_TOOL_NAMES.submitClassificationForIndependentReview]:
    PBAC_ACTIONS.classificationReviewSubmit,
  [AGENTIC_TOOL_NAMES.resolveIndependentClassificationReview]:
    PBAC_ACTIONS.classificationReviewResolve,
};

/** Return true only for centrally registered protected mutation tools. */
export function isAgenticToolCommand(toolName: string): boolean {
  return toolName in PROTECTED_COMMAND_ACTIONS;
}

/** Resolve the mandatory PBAC action for one protected canonical tool. */
export function agenticToolCommandPbacAction(toolName: string): PbacAction {
  const action = PROTECTED_COMMAND_ACTIONS[toolName];
  if (!action) {
    throw problemException(
      EVIDENCE_ERROR_CODES.notFound,
      "internal-agentic-dispatch",
      { status: HttpStatus.NOT_FOUND },
    );
  }
  return action;
}

/** Resolve one protected canonical name to the Nest command owning its mutation. */
export function buildAgenticToolCommand(args: AgenticToolCommandDispatchArgs) {
  switch (args.toolName) {
    case AGENTIC_TOOL_NAMES.reconcileProfileToVerifiedProfile:
      return reconcile_profile_to_verified_profile(args);
    case AGENTIC_TOOL_NAMES.submitClassificationForIndependentReview:
      return submit_classification_for_independent_review(args);
    case AGENTIC_TOOL_NAMES.resolveIndependentClassificationReview:
      return resolve_independent_classification_review(args);
    default:
      throw problemException(
        EVIDENCE_ERROR_CODES.notFound,
        args.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
  }
}

/** Canonical execution adapter for `reconcile_profile_to_verified_profile`. */
export function reconcile_profile_to_verified_profile(
  args: AgenticToolCommandDispatchArgs,
) {
  const { input } = args;
  return new ReconcileProfileToVerifiedProfileCommand(
    {
      assessmentId: args.assessmentId,
      wizardProfileId: stripRef(
        requiredString(input.wizardProfileRef, args.correlationId),
        "wizard:",
        args.correlationId,
      ),
      technicalEvidenceReportId: stripRef(
        requiredString(input.technicalEvidenceReportRef, args.correlationId),
        "ter:",
        args.correlationId,
      ),
      aiUsageFlowId: stripRef(
        requiredString(input.aiUsageFlowRef, args.correlationId),
        "flow:",
        args.correlationId,
      ),
      reconciliationDecisionRefs: stringArray(
        input.reconciliationDecisionRefs,
        args.correlationId,
      ),
      idempotencyKey: requiredString(input.idempotencyKey, args.correlationId),
    },
    args.organizationId,
    args.correlationId,
  );
}

/** Canonical execution adapter for `submit_classification_for_independent_review`. */
export function submit_classification_for_independent_review(
  args: AgenticToolCommandDispatchArgs,
) {
  return new SubmitClassificationReviewCommand(
    args.assessmentId,
    args.organizationId,
    args.input as SubmitClassificationReviewInput,
    args.userId,
    requiredPolicy(args.policyId, args.correlationId),
    requiredPolicy(args.policyVersion, args.correlationId),
    args.correlationId,
  );
}

/** Canonical execution adapter for `resolve_independent_classification_review`. */
export function resolve_independent_classification_review(
  args: AgenticToolCommandDispatchArgs,
) {
  return new ResolveClassificationReviewCommand(
    args.assessmentId,
    args.organizationId,
    args.input as ResolveClassificationReviewInput,
    args.userId,
    requiredPolicy(args.policyId, args.correlationId),
    requiredPolicy(args.policyVersion, args.correlationId),
    args.correlationId,
  );
}

function requiredString(value: unknown, correlationId: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalid(correlationId);
  }
  return value.trim();
}

function stringArray(value: unknown, correlationId: string): string[] {
  if (!Array.isArray(value)) {
    invalid(correlationId);
  }
  const values = value.map((item) => requiredString(item, correlationId));
  if (new Set(values).size !== values.length) {
    invalid(correlationId);
  }
  return values;
}

function requiredPolicy(
  value: string | null | undefined,
  correlationId: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalid(correlationId);
  }
  return value.trim();
}

function stripRef(
  value: string,
  prefix: string,
  correlationId: string,
): string {
  if (!value.startsWith(prefix) || value.length <= prefix.length) {
    invalid(correlationId);
  }
  return value.slice(prefix.length);
}

function invalid(correlationId: string): never {
  throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}
