/** Resolves the authoritative guidance version for newly-created Interview threads. */
export class InterviewGuidanceResolver {
  resolveActiveGuidanceVersion(): string {
    const version = process.env.INTERVIEW_GUIDANCE_VERSION?.trim();
    if (!version) {
      throw new Error(
        "INTERVIEW_GUIDANCE_VERSION must be explicitly configured before starting an Interview session",
      );
    }
    return version;
  }
}
