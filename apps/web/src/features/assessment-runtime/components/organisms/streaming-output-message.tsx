import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import { appLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

import {
  OriginalLegalExcerpt,
  type OriginalLegalExcerptProps,
} from "../molecules/original-legal-excerpt";

export const ACTIVITY_STAGE_STATES = {
  done: "done",
  inProgress: "in_progress",
  pending: "pending",
} as const;

export type ActivityStageState =
  (typeof ACTIVITY_STAGE_STATES)[keyof typeof ACTIVITY_STAGE_STATES];

export interface ActivityTimelineStage {
  id: string;
  label: string;
  state: ActivityStageState;
}

/**
 * Business purpose: Render the `Run activity` stage rail matching Figma AI output preview (`1807:13266`) driven strictly by runtime props/events.
 * Business rules:
 * - Never fabricates completed stages; renders each stage status (`Done`, `In progress`, `Pending`) from `stages`.
 * Execution flow:
 * 1. Render active rule heading and `{ready} of {total} results ready` counter.
 * 2. Render each stage card with semantic status text.
 * 3. Note that previous results remain available.
 * Failure cases:
 * - Empty `stages` renders only the activity header and retention notice.
 * Side effects:
 * - Pure presentational component.
 */
export function ActivityTimeline({
  activeRuleTitle,
  readyCount,
  totalCount,
  stages,
  className,
}: {
  activeRuleTitle: string;
  readyCount: number;
  totalCount: number;
  stages: readonly ActivityTimelineStage[];
  className?: string;
}) {
  const readyLabel = resolveAppMessage(
    "pages.assessmentWorkspace.selectedAudit.resultsReadySummary",
  )
    .replace("{ready}", readyCount.toLocaleString(appLocale))
    .replace("{total}", totalCount.toLocaleString(appLocale));

  return (
    <aside
      aria-label={resolveAppMessage(
        "pages.assessmentWorkspace.selectedAudit.activityTitle",
      )}
      className={cn(
        "flex flex-col justify-between gap-4 rounded-2xl border border-border bg-muted/40 p-4",
        className,
      )}
    >
      <div className="space-y-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {resolveAppMessage(
              "pages.assessmentWorkspace.selectedAudit.activityTitle",
            )}
          </h3>
          <p className="mt-1 text-sm font-medium text-foreground">
            {activeRuleTitle}
          </p>
          <p className="text-xs text-muted-foreground">{readyLabel}</p>
        </div>

        <ul className="space-y-2.5">
          {stages.map((stage) => {
            const stateLabel =
              stage.state === ACTIVITY_STAGE_STATES.done
                ? resolveAppMessage(
                    "pages.assessmentWorkspace.selectedAudit.stageDone",
                  )
                : stage.state === ACTIVITY_STAGE_STATES.inProgress
                  ? resolveAppMessage(
                      "pages.assessmentWorkspace.selectedAudit.stageInProgress",
                    )
                  : resolveAppMessage(
                      "pages.assessmentWorkspace.selectedAudit.stagePending",
                    );

            return (
              <li
                key={stage.id}
                className={cn(
                  "rounded-xl border px-3.5 py-2.5",
                  stage.state === ACTIVITY_STAGE_STATES.inProgress
                    ? "border-status-info-border bg-card"
                    : "border-border bg-card/70",
                )}
              >
                <p className="text-sm font-medium text-foreground">
                  {stage.label}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {stateLabel}
                </p>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="text-xs text-muted-foreground">
        {resolveAppMessage(
          "pages.assessmentWorkspace.selectedAudit.previousResultsRetained",
        )}
      </p>
    </aside>
  );
}

/**
 * Business purpose: Render the streaming AI output panel matching Figma preview states (`1807:13205`, `1807:13294`, `1807:13390`).
 * Business rules:
 * - Clearly distinguishes simulated preview mode (`isSimulated`) from actual runtime output so users never mistake simulated text for a live model/repository call.
 * - Uses reduced-motion-safe styling (`motion-reduce:animate-none`) and authentic `OriginalLegalExcerpt` when provided.
 * Execution flow:
 * 1. Render optional simulated preview banner when `isSimulated` is true.
 * 2. Render `ActivityTimeline` rail + right AI output card with header, optional `OriginalLegalExcerpt`, streamed text, and `View current findings` action.
 * Failure cases:
 * - Empty `streamedText` renders without error.
 * Side effects:
 * - Invokes `onViewCurrentFindings` when clicked.
 */
export function StreamingOutputMessage({
  heading,
  ruleContext,
  streamedText,
  isSimulated = false,
  legalExcerpt,
  timeline,
  onViewCurrentFindings,
}: {
  heading: string;
  ruleContext: string;
  streamedText: string;
  isSimulated?: boolean;
  legalExcerpt?: OriginalLegalExcerptProps | null;
  timeline?: {
    activeRuleTitle: string;
    readyCount: number;
    totalCount: number;
    stages: readonly ActivityTimelineStage[];
  };
  onViewCurrentFindings?: () => void;
}) {
  return (
    <div className="space-y-3" data-component="StreamingOutputMessage">
      {isSimulated ? (
        <div
          role="status"
          className="flex items-center justify-between gap-2 rounded-lg border border-status-info-border bg-status-info-bg px-3.5 py-2 text-xs font-medium text-status-info"
        >
          <span>
            {resolveAppMessage(
              "pages.assessmentWorkspace.selectedAudit.simulatedBannerTitle",
            )}
          </span>
          <Badge
            variant="outline"
            className="border-status-info-border text-status-info"
          >
            Preview
          </Badge>
        </div>
      ) : null}

      <div
        className={cn(
          "grid gap-4",
          timeline && "lg:grid-cols-[320px_minmax(0,1fr)]",
        )}
      >
        {timeline ? (
          <ActivityTimeline
            activeRuleTitle={timeline.activeRuleTitle}
            readyCount={timeline.readyCount}
            totalCount={timeline.totalCount}
            stages={timeline.stages}
          />
        ) : null}

        <section className="flex flex-col justify-between overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
          <div>
            <div className="bg-primary px-5 py-4 text-primary-foreground">
              <h3 className="text-lg font-semibold">{heading}</h3>
              <p className="mt-1 text-xs text-primary-foreground/80">
                {ruleContext}
              </p>
            </div>

            <div className="space-y-4 p-5">
              {legalExcerpt ? <OriginalLegalExcerpt {...legalExcerpt} /> : null}

              {streamedText ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground transition-opacity duration-300 motion-reduce:transition-none">
                  {streamedText}
                </p>
              ) : null}
            </div>
          </div>

          {onViewCurrentFindings ? (
            <div className="border-t border-border px-5 py-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onViewCurrentFindings}
              >
                {resolveAppMessage(
                  "pages.assessmentWorkspace.selectedAudit.viewCurrentFindings",
                )}
              </Button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
