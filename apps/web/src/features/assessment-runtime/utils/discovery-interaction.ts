import {
  ASSESSMENT_DISCOVERY_RUN_STATUSES,
  DISCOVERY_INTERVIEW_PROPOSAL_STATUSES,
  DISCOVERY_RULE_CANDIDATE_STATES,
  type AssessmentDiscoveryRunView,
  type DiscoveryInterviewProposal,
} from "@lcsp/contracts/assessment-domain";

export const DISCOVERY_CONTINUATION_STATES = {
  ready: "READY_TO_CONTINUE",
  blockedPendingReview: "BLOCKED_PENDING_REVIEW",
  blockedUnanswered: "BLOCKED_UNANSWERED",
  blockedRunning: "BLOCKED_RUNNING",
  blockedFailed: "BLOCKED_FAILED",
  blockedNotStarted: "BLOCKED_NOT_STARTED",
} as const;

export type DiscoveryContinuationState =
  (typeof DISCOVERY_CONTINUATION_STATES)[keyof typeof DISCOVERY_CONTINUATION_STATES];

export const SUGGESTED_RULE_BADGE_KINDS = {
  confirmed: "CONFIRMED",
  review: "REVIEW",
  needsContext: "NEEDS_CONTEXT",
  suggested: "SUGGESTED",
} as const;

export type SuggestedRuleBadgeKind =
  (typeof SUGGESTED_RULE_BADGE_KINDS)[keyof typeof SUGGESTED_RULE_BADGE_KINDS];

export type DiscoveryProvenanceItem = {
  rangeId: string;
  path: string;
  startLine: number;
  endLine: number;
  symbol: string | null;
  evidenceStrength: string;
  explanation: string;
  snippet?: string | null;
};

export type DiscoveryProgressSummary = {
  totalChecks: number;
  confirmedCount: number;
  pendingCount: number;
  rejectedCount: number;
  unansweredCount: number;
  progressPercent: number;
  isNoAi: boolean;
  isInterrupted: boolean;
  continuationState: DiscoveryContinuationState;
  canContinue: boolean;
};

type DiscoveryPreview = NonNullable<
  Extract<
    AssessmentDiscoveryRunView["discovery"],
    { available: true }
  >["discovery"]
>["preview"];

type DiscoverySummary = Extract<
  AssessmentDiscoveryRunView["discovery"],
  { available: true }
>["discovery"];

/**
 * Business purpose: Derive deterministic Discovery progress and continuation eligibility from actual server-confirmed state.
 * Business rules:
 * - Continuation is permitted only when the discovery run is COMPLETED, all interview pages are loaded, and zero questions remain pending, rejected, or unanswered.
 * - Zero AI use cases (`isNoAi`) is an explicit completed outcome that still allows manual rule selection without inferring non-applicability.
 * - Known gaps or truncated coverage mark the discovery as interrupted/incomplete without fabricating missing checks.
 * Execution flow:
 * 1. Inspect run status (`QUEUED`, `RUNNING`, `FAILED`, `COMPLETED`) and question proposal statuses.
 * 2. Count confirmed, pending, rejected, and unanswered context checks and compute bounded percentage.
 * 3. Derive `continuationState` and `canContinue` strictly from those confirmed counts.
 * Failure cases:
 * - Missing run, active scan, failed scan, or incomplete interview ledger all block continuation.
 * Side effects:
 * - Pure computation; no network or state mutations.
 */
export function computeDiscoveryProgress({
  run,
  summary,
  questionKeys,
  latestByQuestion,
  interviewLoaded,
}: {
  run: AssessmentDiscoveryRunView | null;
  summary: DiscoverySummary | null;
  questionKeys: string[];
  latestByQuestion: Map<string, DiscoveryInterviewProposal>;
  interviewLoaded: boolean;
}): DiscoveryProgressSummary {
  const totalChecks = questionKeys.length;
  let confirmedCount = 0;
  let pendingCount = 0;
  let rejectedCount = 0;
  let unansweredCount = 0;

  for (const key of questionKeys) {
    const proposal = latestByQuestion.get(key);
    if (!proposal) {
      unansweredCount += 1;
    } else if (
      proposal.status === DISCOVERY_INTERVIEW_PROPOSAL_STATUSES.accepted
    ) {
      confirmedCount += 1;
    } else if (
      proposal.status === DISCOVERY_INTERVIEW_PROPOSAL_STATUSES.pendingReview
    ) {
      pendingCount += 1;
    } else if (
      proposal.status === DISCOVERY_INTERVIEW_PROPOSAL_STATUSES.rejected
    ) {
      rejectedCount += 1;
    }
  }

  const isNoAi = Boolean(summary && summary.aiUseCaseCount === 0);
  const isInterrupted = Boolean(
    summary &&
      (summary.knownGapCount > 0 || summary.coverageImpact.truncated),
  );

  let continuationState: DiscoveryContinuationState =
    DISCOVERY_CONTINUATION_STATES.blockedNotStarted;
  if (!run) {
    continuationState = DISCOVERY_CONTINUATION_STATES.blockedNotStarted;
  } else if (
    run.status === ASSESSMENT_DISCOVERY_RUN_STATUSES.queued ||
    run.status === ASSESSMENT_DISCOVERY_RUN_STATUSES.running
  ) {
    continuationState = DISCOVERY_CONTINUATION_STATES.blockedRunning;
  } else if (run.status === ASSESSMENT_DISCOVERY_RUN_STATUSES.failed) {
    continuationState = DISCOVERY_CONTINUATION_STATES.blockedFailed;
  } else if (run.status === ASSESSMENT_DISCOVERY_RUN_STATUSES.completed) {
    if (!interviewLoaded && totalChecks > 0) {
      continuationState = DISCOVERY_CONTINUATION_STATES.blockedPendingReview;
    } else if (pendingCount > 0 || rejectedCount > 0) {
      continuationState = DISCOVERY_CONTINUATION_STATES.blockedPendingReview;
    } else if (unansweredCount > 0) {
      continuationState = DISCOVERY_CONTINUATION_STATES.blockedUnanswered;
    } else {
      continuationState = DISCOVERY_CONTINUATION_STATES.ready;
    }
  }

  const progressPercent =
    totalChecks > 0
      ? Math.round((confirmedCount / totalChecks) * 100)
      : run?.status === ASSESSMENT_DISCOVERY_RUN_STATUSES.completed
        ? 100
        : 0;

  return {
    totalChecks,
    confirmedCount,
    pendingCount,
    rejectedCount,
    unansweredCount,
    progressPercent,
    isNoAi,
    isInterrupted,
    continuationState,
    canContinue: continuationState === DISCOVERY_CONTINUATION_STATES.ready,
  };
}

/**
 * Business purpose: Resolve source-range evidence provenance with exact code snippets for a Discovery question or candidate rule without fabricating missing paths.
 * Business rules:
 * - Only ranges present in the pinned discovery preview are returned; missing range IDs are never guessed.
 * - Extracts exact code snippets from matched source ranges when available.
 * Execution flow:
 * 1. Index preview ranges by `rangeId`.
 * 2. Map requested `rangeIds` to existing provenance items in order, including source snippet text.
 * Failure cases:
 * - Unmatched range IDs or absent discovery previews return an empty list without throwing so callers render a provenance-unavailable notice.
 * Side effects:
 * - Pure read-only transformation.
 */
export function resolveEvidenceProvenance(
  rangeIds: readonly string[],
  previewRanges: DiscoveryPreview["ranges"] | undefined,
): DiscoveryProvenanceItem[] {
  if (!previewRanges || previewRanges.length === 0 || rangeIds.length === 0) {
    return [];
  }
  const byId = new Map(previewRanges.map((range) => [range.rangeId, range]));
  const resolved: DiscoveryProvenanceItem[] = [];
  for (const rangeId of rangeIds) {
    const match = byId.get(rangeId);
    if (match) {
      resolved.push({
        rangeId: match.rangeId,
        path: match.path,
        startLine: match.startLine,
        endLine: match.endLine,
        symbol: match.symbol,
        evidenceStrength: match.evidenceStrength,
        explanation: match.explanation,
        snippet: (match as { snippet?: string | null }).snippet ?? null,
      });
    }
  }
  return resolved;
}

/**
 * Business purpose: Map a Discovery candidate rule's state and linked context to a display badge kind without implying legal applicability.
 * Business rules:
 * - Candidate states remain investigative suggestions; even `CONFIRMED` means context/facts exist, never legal compliance or selection.
 * Execution flow:
 * 1. Check whether the candidate still needs context or has unresolved conditions.
 * 2. Check whether supporting confirmed facts exist or if review is needed.
 * Failure cases:
 * - Defaults to `SUGGESTED` when no special context condition applies.
 * Side effects:
 * - Pure mapping function.
 */
export function resolveSuggestedRuleBadgeKind({
  candidateState,
  supportingFactCount,
  unresolvedConditionCount,
  hasRejectedContext,
}: {
  candidateState: string;
  supportingFactCount: number;
  unresolvedConditionCount: number;
  hasRejectedContext: boolean;
}): SuggestedRuleBadgeKind {
  if (hasRejectedContext) {
    return SUGGESTED_RULE_BADGE_KINDS.review;
  }
  if (
    candidateState === DISCOVERY_RULE_CANDIDATE_STATES.needsContext ||
    unresolvedConditionCount > 0
  ) {
    return SUGGESTED_RULE_BADGE_KINDS.needsContext;
  }
  if (supportingFactCount > 0) {
    return SUGGESTED_RULE_BADGE_KINDS.confirmed;
  }
  return SUGGESTED_RULE_BADGE_KINDS.suggested;
}
