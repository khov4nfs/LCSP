import { AGENTIC_TOOL_NAMES } from "@lcsp/contracts/evidence";

import { ResolveClassificationReviewCommand } from "../../../classification/application/commands/resolve-classification-review/resolve-classification-review.command.js";
import { SubmitClassificationReviewCommand } from "../../../classification/application/commands/submit-classification-review/submit-classification-review.command.js";
import { ReconcileProfileToVerifiedProfileCommand } from "../../../reconciliation/application/commands/reconcile-profile-to-verified-profile/reconcile-profile-to-verified-profile.command.js";
import {
  buildAgenticToolCommand,
  isAgenticToolCommand,
  reconcile_profile_to_verified_profile,
  resolve_independent_classification_review,
  submit_classification_for_independent_review,
} from "./agentic-tool-command-dispatcher.js";

const baseArgs = {
  assessmentId: "assessment-1",
  organizationId: "org-1",
  userId: "user-1",
  policyId: "policy-1",
  policyVersion: "version-1",
  correlationId: "correlation-1",
};

describe("agentic protected command dispatcher", () => {
  it("recognizes only protected canonical command tools", () => {
    expect(
      isAgenticToolCommand(
        AGENTIC_TOOL_NAMES.reconcileProfileToVerifiedProfile,
      ),
    ).toBe(true);
    expect(
      isAgenticToolCommand(
        AGENTIC_TOOL_NAMES.submitClassificationForIndependentReview,
      ),
    ).toBe(true);
    expect(
      isAgenticToolCommand(
        AGENTIC_TOOL_NAMES.resolveIndependentClassificationReview,
      ),
    ).toBe(true);
    expect(isAgenticToolCommand(AGENTIC_TOOL_NAMES.searchEvidence)).toBe(false);
  });

  it("maps reconcile_profile_to_verified_profile to its exact command", () => {
    const args = {
      ...baseArgs,
      toolName: AGENTIC_TOOL_NAMES.reconcileProfileToVerifiedProfile,
      input: {
        wizardProfileRef: "wizard:wizard-1",
        technicalEvidenceReportRef: "ter:report-1",
        aiUsageFlowRef: "flow:flow-1",
        reconciliationDecisionRefs: ["decision:conflict-1"],
        idempotencyKey: "reconcile-12345678",
      },
    };

    const direct = reconcile_profile_to_verified_profile(args);
    const routed = buildAgenticToolCommand(args);

    expect(direct).toBeInstanceOf(ReconcileProfileToVerifiedProfileCommand);
    expect(routed).toBeInstanceOf(ReconcileProfileToVerifiedProfileCommand);
    expect(direct.input).toEqual({
      assessmentId: "assessment-1",
      wizardProfileId: "wizard-1",
      technicalEvidenceReportId: "report-1",
      aiUsageFlowId: "flow-1",
      reconciliationDecisionRefs: ["decision:conflict-1"],
      idempotencyKey: "reconcile-12345678",
    });
  });

  it("maps review submission to SubmitClassificationReviewCommand with policy metadata", () => {
    const args = {
      ...baseArgs,
      toolName: AGENTIC_TOOL_NAMES.submitClassificationForIndependentReview,
      input: {
        baselineRef: "legal-match:baseline-1",
        proposedClass: "HIGH_RISK",
        rationaleCitationRefs: ["citation:1"],
        proposalGateRef: "proposal-gate:1",
        idempotencyKey: "submit-12345678",
      },
    };

    const direct = submit_classification_for_independent_review(args);
    const routed = buildAgenticToolCommand(args);

    expect(direct).toBeInstanceOf(SubmitClassificationReviewCommand);
    expect(routed).toBeInstanceOf(SubmitClassificationReviewCommand);
    expect(direct.policyId).toBe("policy-1");
    expect(direct.policyVersion).toBe("version-1");
  });

  it("maps independent review resolution to ResolveClassificationReviewCommand", () => {
    const args = {
      ...baseArgs,
      toolName: AGENTIC_TOOL_NAMES.resolveIndependentClassificationReview,
      input: {
        reviewRequestRef: "review-request:request-1",
        decision: "APPROVE",
        rationaleCode: "INDEPENDENT_REVIEW_CONFIRMED",
        idempotencyKey: "resolve-12345678",
      },
    };

    const direct = resolve_independent_classification_review(args);
    const routed = buildAgenticToolCommand(args);

    expect(direct).toBeInstanceOf(ResolveClassificationReviewCommand);
    expect(routed).toBeInstanceOf(ResolveClassificationReviewCommand);
    expect(direct.policyId).toBe("policy-1");
    expect(direct.policyVersion).toBe("version-1");
  });

  it("fails closed when protected review policy metadata is missing", () => {
    expect(() =>
      submit_classification_for_independent_review({
        ...baseArgs,
        policyId: null,
        toolName: AGENTIC_TOOL_NAMES.submitClassificationForIndependentReview,
        input: {},
      }),
    ).toThrow();
  });
});
