"use client";

import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import type { DiscoveryProgressSummary } from "../../utils/discovery-interaction";
import { copy } from "../../utils/conversation-copy";

/**
 * Business purpose: Display a high-contrast Discovery progress summary card matching Figma Frame 107.
 * Business rules:
 * - Reflects actual server-confirmed counts (`confirmedCount` of `totalChecks`) and explicit no-AI or interrupted-coverage states.
 * - Never fabricates 100% completion while questions remain pending, rejected, or unanswered.
 * Execution flow:
 * 1. Render confirmed-vs-total context check count and status indicators.
 * 2. Render an accessible progressbar reflecting `progressPercent`.
 * Failure cases:
 * - Zero checks with no-AI or interrupted gaps renders explicit status lines instead of silent completion.
 * Side effects:
 * - Pure presentational component.
 */
export function DiscoveryProgress({
  progress,
  candidateCount,
  knownGapCount,
  isRunning,
  isFailed,
}: {
  progress: DiscoveryProgressSummary;
  candidateCount: number;
  knownGapCount: number;
  isRunning: boolean;
  isFailed: boolean;
}) {
  const pendingOrRejected =
    progress.pendingCount + progress.rejectedCount + progress.unansweredCount;

  return (
    <section
      aria-label={copy("ruleAudit.discovery.progressTitle")}
      data-slot="discovery-progress"
      className="rounded-xl border border-primary/20 bg-primary p-5 text-primary-foreground shadow-sm"
    >
      <p className="text-sm font-medium text-primary-foreground/80">
        {copy("ruleAudit.discovery.progressTitle")}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
        {copy("ruleAudit.discovery.progressChecks", {
          confirmed: progress.confirmedCount,
          total: progress.totalChecks,
        })}
      </p>

      <ul className="mt-4 space-y-1.5 text-sm text-primary-foreground/90">
        <li className="flex items-center gap-2">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
          <span>
            {isRunning
              ? copy("ruleAudit.discovery.running")
              : isFailed
                ? copy("ruleAudit.discovery.failed")
                : copy("ruleAudit.discovery.progressRepoInspected")}
          </span>
        </li>
        <li className="flex items-center gap-2">
          {progress.isNoAi ? (
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
          )}
          <span>
            {progress.isNoAi
              ? copy("ruleAudit.discovery.progressNoAi")
              : copy("ruleAudit.discovery.progressScopeSuggested", {
                  count: candidateCount,
                })}
          </span>
        </li>
        <li className="flex items-center gap-2">
          {pendingOrRejected > 0 ? (
            <Clock className="size-4 shrink-0" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
          )}
          <span>
            {pendingOrRejected > 0
              ? copy("ruleAudit.discovery.progressPending", {
                  count: pendingOrRejected,
                })
              : copy("ruleAudit.discovery.progressAllConfirmed")}
          </span>
        </li>
        {progress.isInterrupted ? (
          <li className="flex items-center gap-2 text-amber-200">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            <span>
              {copy("ruleAudit.discovery.progressInterrupted", {
                gaps: knownGapCount,
              })}
            </span>
          </li>
        ) : null}
      </ul>

      <div
        role="progressbar"
        aria-label={copy("ruleAudit.discovery.progressTitle")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.progressPercent}
        className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-primary-foreground/20"
      >
        <div
          className="h-full rounded-full bg-emerald-300 transition-all"
          style={{ width: `${progress.progressPercent}%` }}
        />
      </div>
    </section>
  );
}
