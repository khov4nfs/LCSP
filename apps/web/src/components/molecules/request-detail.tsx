import Link from "next/link";
import { ExternalLinkIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { RequestStatusBadge } from "./request-status-badge";

/**
 * Business purpose: Render a shared information request detail view with status, question prompt, legal context, and optional assessment deep-link.
 * Business rules:
 * - Displays `RequestStatusBadge` so outstanding vs resolved state is unambiguous.
 * - Preserves `unresolvedFact`, `decisionImpact`, and `resolutionAttempts` behind a clear context block.
 * Execution flow:
 * 1. Render status badge and optional assessment context link.
 * 2. Render the question prompt.
 * 3. Render collapsible or structured legal context when present.
 * Failure cases:
 * - Empty context arrays/strings omit the context section cleanly.
 * Side effects:
 * - Pure presentational component shared across M05 (Frame 24) and M06 (Frames 21/83).
 */
export function RequestDetail({
  titleId,
  question,
  open,
  statusLabelOverride,
  assessmentName,
  assessmentHref,
  unresolvedFact,
  decisionImpact = [],
  resolutionAttempts = [],
  whyAskingLabel,
  unresolvedFactLabel,
  decisionImpactLabel,
  resolutionAttemptsLabel,
  defaultExpanded = false,
  className,
}: {
  titleId?: string;
  question: string;
  open: boolean;
  statusLabelOverride?: string;
  assessmentName?: string;
  assessmentHref?: string;
  unresolvedFact?: string | null;
  decisionImpact?: readonly string[];
  resolutionAttempts?: readonly string[];
  whyAskingLabel?: string;
  unresolvedFactLabel?: string;
  decisionImpactLabel?: string;
  resolutionAttemptsLabel?: string;
  defaultExpanded?: boolean;
  className?: string;
}) {
  const hasContext =
    Boolean(unresolvedFact) ||
    decisionImpact.length > 0 ||
    resolutionAttempts.length > 0;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <RequestStatusBadge open={open} labelOverride={statusLabelOverride} />
        {assessmentHref ? (
          <Button
            render={<Link href={assessmentHref} />}
            nativeButton={false}
            variant="ghost"
            size="sm"
            className="h-auto gap-1.5 px-2 py-1 text-xs text-brand-deep hover:text-brand"
          >
            <span>
              {assessmentName ??
                resolveAppMessage(
                  "pages.workspace.tracking.requestsOpenInAssessment",
                )}
            </span>
            <ExternalLinkIcon className="size-3" aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      <p
        id={titleId}
        className="whitespace-pre-wrap text-sm font-medium leading-relaxed text-foreground"
      >
        {question}
      </p>

      {hasContext ? (
        <details
          open={defaultExpanded}
          className="group rounded-lg border border-border bg-muted/30 px-3.5 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-foreground/85 select-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <span>
              {whyAskingLabel ??
                resolveAppMessage("pages.assessmentConversation.question.whyAsking")}
            </span>
            <span className="text-[10px] text-muted-foreground transition-transform group-open:rotate-180">
              ▼
            </span>
          </summary>
          <div className="mt-2.5 space-y-1.5 border-t border-border/50 pt-2">
            {unresolvedFact ? (
              <div>
                <span className="font-semibold text-foreground">
                  {unresolvedFactLabel ??
                    resolveAppMessage(
                      "pages.assessmentConversation.question.unresolvedFactLabel",
                    )}
                </span>{" "}
                <span>{unresolvedFact}</span>
              </div>
            ) : null}
            {decisionImpact.length > 0 ? (
              <div>
                <span className="font-semibold text-foreground">
                  {decisionImpactLabel ??
                    resolveAppMessage(
                      "pages.assessmentConversation.question.decisionImpactLabel",
                    )}
                </span>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {decisionImpact.map((impact) => (
                    <li key={impact}>{impact}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {resolutionAttempts.length > 0 ? (
              <div>
                <span className="font-semibold text-foreground">
                  {resolutionAttemptsLabel ??
                    resolveAppMessage(
                      "pages.assessmentConversation.question.resolutionAttemptsLabel",
                    )}
                </span>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {resolutionAttempts.map((attempt) => (
                    <li key={attempt}>{attempt}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
