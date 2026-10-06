import { ASSESSMENT_INTERVIEW_MUTATION_PROBLEM_CODES as CODES } from "@lcsp/contracts/evidence";

/** Carries only a safe code/status; never surface server internals or Customer text. */
export class InterviewMutationError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly definitive: boolean,
  ) {
    super(code);
    this.name = "InterviewMutationError";
  }
}

const STALE_CODES = new Set<string>([
  CODES.revisionStale,
  CODES.questionStale,
  CODES.provenanceStale,
  CODES.blockedActionNotAvailable,
]);

export function isInterviewMutationConflict(error: unknown): boolean {
  return error instanceof InterviewMutationError && STALE_CODES.has(error.code);
}

/** One immutable wire command per unresolved user action, scoped to the mounted Assessment. */
export function createInterviewMutationRetrier<Command extends { clientRequestId: string }>() {
  let pending: Command | undefined;
  let inFlight: Promise<unknown> | undefined;

  function sameRequest(left: Command, right: Command): boolean {
    const { clientRequestId: leftId, ...a } = left;
    const { clientRequestId: rightId, ...b } = right;
    void leftId;
    void rightId;
    return canonicalJson(a) === canonicalJson(b);
  }

  return {
    hasPending: () => pending !== undefined,
    async run<Result>(
      candidate: Command | undefined,
      send: (command: Command) => Promise<Result>,
    ): Promise<Result> {
      if (candidate && pending && !sameRequest(candidate, pending)) {
        // Do not silently send edited content or rebase it onto a newer question.
        throw new InterviewMutationError(CODES.requestPending, 0, false);
      }
      if (!pending && candidate) pending = structuredClone(candidate);
      const command = pending;
      if (!command) throw new InterviewMutationError(CODES.requestPending, 0, true);
      if (inFlight) return inFlight as Promise<Result>;
      const attempt = Promise.resolve().then(() => send(structuredClone(command)));
      inFlight = attempt;
      try {
        const result = await attempt;
        if (pending === command) pending = undefined;
        return result;
      } catch (error) {
        // A transport error, malformed response or 5xx leaves the result uncertain.
        if (error instanceof InterviewMutationError && error.definitive && pending === command) {
          pending = undefined;
        }
        throw error;
      } finally {
        if (inFlight === attempt) inFlight = undefined;
      }
    },
  };
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}
