import { AGENTIC_TOOL_NAMES } from "@lcsp/contracts/evidence";

import { CaptureVerifiedAgentEpisodeCommand } from "../../application/commands/capture-verified-agent-episode/capture-verified-agent-episode.command.js";
import {
  buildAgenticToolCommand,
  isAgenticToolCommand,
  isAgenticToolProtectedCommand,
} from "./agentic-tool-command-dispatcher.js";

const baseArgs = {
  assessmentId: "assessment-1",
  userId: "user-1",
  policyId: "policy-1",
  policyVersion: "version-1",
  correlationId: "correlation-1",
};

const RETIRED_AGENTIC_COMMAND_TOOL_NAMES = {
  reconcileProfileToVerifiedProfile: "reconcile_profile_to_verified_profile",
  submitClassificationForIndependentReview:
    "submit_classification_for_independent_review",
  resolveIndependentClassificationReview:
    "resolve_independent_classification_review",
} as const;

describe("agentic protected command dispatcher", () => {
  it("does not expose retired verified-profile or classification-review commands", () => {
    expect(
      isAgenticToolCommand(
        RETIRED_AGENTIC_COMMAND_TOOL_NAMES.reconcileProfileToVerifiedProfile,
      ),
    ).toBe(false);
    expect(
      isAgenticToolCommand(
        RETIRED_AGENTIC_COMMAND_TOOL_NAMES.submitClassificationForIndependentReview,
      ),
    ).toBe(false);
    expect(
      isAgenticToolCommand(
        RETIRED_AGENTIC_COMMAND_TOOL_NAMES.resolveIndependentClassificationReview,
      ),
    ).toBe(false);
  });

  it("routes verified episode capture as an unprotected internal app command", () => {
    expect(
      isAgenticToolCommand(AGENTIC_TOOL_NAMES.captureVerifiedEpisode),
    ).toBe(true);
    expect(
      isAgenticToolProtectedCommand(AGENTIC_TOOL_NAMES.captureVerifiedEpisode),
    ).toBe(false);
    expect(
      buildAgenticToolCommand({
        ...baseArgs,
        toolName: AGENTIC_TOOL_NAMES.captureVerifiedEpisode,
        input: { record_id: "episode:1" },
      }),
    ).toBeInstanceOf(CaptureVerifiedAgentEpisodeCommand);
  });

  it("fails closed for retired command dispatch", () => {
    expect(() =>
      buildAgenticToolCommand({
        ...baseArgs,
        toolName:
          RETIRED_AGENTIC_COMMAND_TOOL_NAMES.reconcileProfileToVerifiedProfile,
        input: {},
      }),
    ).toThrow();
  });
});
