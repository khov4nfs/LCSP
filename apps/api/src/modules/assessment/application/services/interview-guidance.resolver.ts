import { INTERVIEW_GUIDANCE_VERSION } from "@lcsp/contracts/assessment";

/** Resolves the authoritative guidance version for newly-created Interview threads. */
export class InterviewGuidanceResolver {
  resolveActiveGuidanceVersion(): string {
    return INTERVIEW_GUIDANCE_VERSION;
  }
}
