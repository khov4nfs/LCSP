import { describe, expect, it } from "@jest/globals";
import { INTERVIEW_GUIDANCE_VERSION } from "@lcsp/contracts/assessment";

import { InterviewGuidanceResolver } from "./interview-guidance.resolver.js";

describe("InterviewGuidanceResolver", () => {
  it("resolves the contract constant without any environment variable", () => {
    delete process.env.INTERVIEW_GUIDANCE_VERSION;
    expect(new InterviewGuidanceResolver().resolveActiveGuidanceVersion()).toBe(
      INTERVIEW_GUIDANCE_VERSION,
    );
  });
});
