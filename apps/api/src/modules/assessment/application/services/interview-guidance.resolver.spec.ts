import { afterEach, describe, expect, it } from "@jest/globals";

import { InterviewGuidanceResolver } from "./interview-guidance.resolver.js";

describe("InterviewGuidanceResolver", () => {
  const original = process.env.INTERVIEW_GUIDANCE_VERSION;

  afterEach(() => {
    if (original === undefined) delete process.env.INTERVIEW_GUIDANCE_VERSION;
    else process.env.INTERVIEW_GUIDANCE_VERSION = original;
  });

  it("resolves an explicit configured version", () => {
    process.env.INTERVIEW_GUIDANCE_VERSION = "guidance-v3";
    expect(new InterviewGuidanceResolver().resolveActiveGuidanceVersion()).toBe(
      "guidance-v3",
    );
  });

  it("fails closed when configuration is absent", () => {
    delete process.env.INTERVIEW_GUIDANCE_VERSION;
    expect(() =>
      new InterviewGuidanceResolver().resolveActiveGuidanceVersion(),
    ).toThrow("INTERVIEW_GUIDANCE_VERSION must be explicitly configured");
  });
});
