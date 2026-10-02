import {
  ASSESSMENT_STAGE_LIFECYCLE_STATES,
  type AssessmentRuntimeEngineeringProgress,
  type AssessmentStageLifecycleEntry,
  type AssessmentStageLifecycleProjection,
} from "@lcsp/contracts/evidence";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";

/**
 * Stage lifecycle derived from durable artifacts, not from the activity log.
 *
 * Runtime events cannot answer "is this stage done": a later
 * repository-analyst dispatch posts scan-tagged bookkeeping under the same scan job,
 * and a boundary failure can arrive with no stage at all. Every state below is
 * therefore read from something that durably exists — the scan job, the accepted
 * evidence report, the interview thread's confirmed revision, and the durable
 * engineering progress — so the sidebar and the composer cannot disagree.
 */

const STATES = ASSESSMENT_STAGE_LIFECYCLE_STATES;

export type StageLifecycleScanJob = {
  assessmentId: string;
  status: string;
  updatedAt: string;
};

export type StageLifecycleEvidenceReport = {
  assessmentId: string;
  status: string;
};

export type StageLifecycleInterviewThread = {
  assessmentId: string;
  contextRevision: number;
  processedRevision: number;
  activeQuestionId: string | null;
};

export type StageLifecycleInput = {
  assessmentIds: Iterable<string>;
  scanJobs: readonly StageLifecycleScanJob[];
  evidenceReports: readonly StageLifecycleEvidenceReport[];
  interviewThreads: readonly StageLifecycleInterviewThread[];
  engineeringProgress: readonly AssessmentRuntimeEngineeringProgress[];
  /** Assessment ids whose newest dispatch is still live (heartbeat within window). */
  liveAssessmentIds?: ReadonlySet<string>;
};

const ACTIVE_SCAN_STATUSES = new Set<string>([
  REPOSITORY_SCAN_JOB_STATUSES.queued,
  REPOSITORY_SCAN_JOB_STATUSES.running,
  REPOSITORY_SCAN_JOB_STATUSES.waitingForCredits,
]);

function entry(
  state: AssessmentStageLifecycleEntry["state"],
  source: string,
  detail: string | null = null,
): AssessmentStageLifecycleEntry {
  return { state, source, detail };
}

/** One lifecycle per assessment, keyed for direct lookup by the web adapter. */
export function deriveStageLifecycles(
  input: StageLifecycleInput,
): AssessmentStageLifecycleProjection[] {
  const scanJobs = groupBy(input.scanJobs, (job) => job.assessmentId);
  const evidence = groupBy(input.evidenceReports, (item) => item.assessmentId);
  const threads = new Map(
    input.interviewThreads.map((thread) => [thread.assessmentId, thread]),
  );
  // Progress arrives newest run first; the newest run owns the assessment.
  const progress = new Map<string, AssessmentRuntimeEngineeringProgress>();
  for (const item of input.engineeringProgress) {
    if (!progress.has(item.assessmentId)) progress.set(item.assessmentId, item);
  }
  const live = input.liveAssessmentIds ?? new Set<string>();

  return [...new Set(input.assessmentIds)].map((assessmentId) => {
    const jobs = scanJobs.get(assessmentId) ?? [];
    const accepted = (evidence.get(assessmentId) ?? []).some(
      (report) => report.status === TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
    );
    const scanner = deriveScanner(jobs, accepted);
    const interview = deriveInterview(threads.get(assessmentId));
    const engineering = progress.get(assessmentId);
    const isLive = live.has(assessmentId);
    return {
      assessmentId,
      scanner,
      interview,
      ruleAnalysis: deriveRuleAnalysis(engineering, scanner, interview, isLive),
      gate: deriveGate(engineering),
    };
  });
}

/**
 * The scan job and the accepted evidence own this row.
 *
 * Downstream dispatches run under the same scan job and post SCAN-tagged
 * bookkeeping ("sandbox already hydrated", run heartbeats); those must never
 * make a finished scan look like it started again.
 */
function deriveScanner(
  jobs: readonly StageLifecycleScanJob[],
  accepted: boolean,
): AssessmentStageLifecycleEntry {
  const latest = [...jobs].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  )[0];
  if (latest && ACTIVE_SCAN_STATUSES.has(latest.status)) {
    return entry(
      latest.status === REPOSITORY_SCAN_JOB_STATUSES.running
        ? STATES.running
        : STATES.queued,
      "scanJob",
      latest.status,
    );
  }
  if (accepted) {
    return entry(STATES.done, "acceptedEvidence");
  }
  if (latest?.status === REPOSITORY_SCAN_JOB_STATUSES.failed) {
    return entry(STATES.failed, "scanJob", latest.status);
  }
  if (latest?.status === REPOSITORY_SCAN_JOB_STATUSES.completed) {
    // Completed without accepted evidence: usable, but not the full picture.
    return entry(STATES.partial, "scanJob", latest.status);
  }
  return entry(
    STATES.queued,
    latest ? "scanJob" : "noDurableArtifact",
    latest?.status ?? null,
  );
}

/** The thread's confirmed revision and open question own this row. */
function deriveInterview(
  thread: StageLifecycleInterviewThread | undefined,
): AssessmentStageLifecycleEntry {
  if (!thread) return entry(STATES.queued, "noDurableArtifact");
  if (thread.activeQuestionId) {
    return entry(STATES.waitingForCustomer, "interviewThread");
  }
  if (thread.processedRevision >= thread.contextRevision) {
    return entry(
      STATES.contextConfirmed,
      "confirmedContext",
      `revision ${thread.contextRevision}`,
    );
  }
  return entry(STATES.running, "interviewThread");
}

function pendingRules(progress: AssessmentRuntimeEngineeringProgress): number {
  return Math.max(
    progress.eligibleCount -
      progress.completed -
      progress.needsContext -
      progress.unresolved -
      progress.failed,
    0,
  );
}

/** Rule-analysis progress owns this row: complete only when no eligible rule is pending. */
function deriveRuleAnalysis(
  progress: AssessmentRuntimeEngineeringProgress | undefined,
  scanner: AssessmentStageLifecycleEntry,
  interview: AssessmentStageLifecycleEntry,
  isLive: boolean,
): AssessmentStageLifecycleEntry {
  if (!progress) {
    // `isLive` is assessment-scoped, not stage-scoped: it only says the newest
    // dispatch is still beating, which is true for every stage that has not
    // produced an artifact yet. Rule analysis cannot start before the scan has
    // produced evidence and the Interview has confirmed the customer context,
    // so until then this row stays queued however live the assessment is.
    if (
      (scanner.state !== STATES.done && scanner.state !== STATES.partial) ||
      interview.state !== STATES.contextConfirmed
    ) {
      return entry(STATES.queued, "noDurableArtifact");
    }
    return entry(isLive ? STATES.running : STATES.queued, "dispatch");
  }
  const pending = pendingRules(progress);
  const notEstablished = progress.unresolved + progress.failed;
  if (pending === 0 && progress.needsContext > 0) {
    // Rules that stopped for missing customer context are not finished: the
    // count is excluded from `pending`, so without this a run with one done rule
    // and many blocked ones reads as complete.
    return entry(
      STATES.needsContext,
      "ruleAnalysis",
      `${progress.completed} done, ${progress.needsContext} need context`,
    );
  }
  if (pending > 0) {
    return entry(
      isLive ? STATES.running : STATES.claimsPartial,
      "ruleAnalysis",
      `${progress.completed} done, ${pending} pending`,
    );
  }
  if (progress.completed > 0 || notEstablished > 0) {
    return entry(
      notEstablished > 0 ? STATES.claimsPartial : STATES.claimsComplete,
      "ruleAnalysis",
      `${progress.completed} done`,
    );
  }
  return entry(isLive ? STATES.running : STATES.queued, "dispatch");
}

function deriveGate(
  progress: AssessmentRuntimeEngineeringProgress | undefined,
): AssessmentStageLifecycleEntry {
  if (!progress) return entry(STATES.queued, "noDurableArtifact");
  if (
    pendingRules(progress) === 0 &&
    progress.needsContext === 0 &&
    progress.completed > 0
  ) {
    return entry(STATES.ready, "ruleAnalysis");
  }
  return entry(STATES.queued, "ruleAnalysis");
}

function groupBy<TItem>(
  items: readonly TItem[],
  key: (item: TItem) => string,
): Map<string, TItem[]> {
  const grouped = new Map<string, TItem[]>();
  for (const item of items) {
    const id = key(item);
    const bucket = grouped.get(id);
    if (bucket) bucket.push(item);
    else grouped.set(id, [item]);
  }
  return grouped;
}
