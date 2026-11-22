export const ASSESSMENT_RUNTIME_ERASURE = Symbol("ASSESSMENT_RUNTIME_ERASURE");

/** Erases only the server-owned Root and its transport/sandbox state. */
export interface AssessmentRuntimeErasurePort {
  erase(input: {
    assessmentId: string;
    ownerId: string;
    threadId: string;
  }): Promise<void>;
}
